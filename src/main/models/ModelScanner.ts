import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type {
  DownloadedModel,
  ModelCapability,
  ModelFile,
  ModelFormat,
  ModelSource,
  ModelEngineId,
} from '../../shared/models/types';

const MAX_SCAN_DEPTH = 6;
const MAX_SCANNED_FILES = 25_000;
const MODEL_FILE_EXTENSIONS = new Set(['.gguf', '.safetensors', '.bin', '.pt', '.pth', '.npz']);

export interface ScanDirectoryInput {
  path: string;
  kind: 'managed' | 'user' | 'huggingface-cache';
}

interface ModelIdentity {
  source: ModelSource;
  repoId: string | null;
  revision: string | null;
}

interface ScanState {
  scannedFiles: number;
  modelRoots: Set<string>;
}

function isModelFile(filePath: string): boolean {
  return MODEL_FILE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function collectModelRoots(directory: string, depth: number, state: ScanState): void {
  if (depth > MAX_SCAN_DEPTH || state.scannedFiles >= MAX_SCANNED_FILES) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }

  let containsModel = false;
  for (const entry of entries) {
    if (state.scannedFiles >= MAX_SCANNED_FILES) break;
    if (!entry.isFile()) continue;
    state.scannedFiles += 1;
    if (isModelFile(entry.name) || entry.name.endsWith('.partial')) containsModel = true;
  }
  if (containsModel) state.modelRoots.add(directory);

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'blobs') continue;
    collectModelRoots(path.join(directory, entry.name), depth + 1, state);
  }
}

function listFiles(directory: string): ModelFile[] {
  const files: ModelFile[] = [];
  const queue = [directory];
  while (queue.length > 0 && files.length < MAX_SCANNED_FILES) {
    const current = queue.shift();
    if (!current) break;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        if (entry.name !== '.git' && entry.name !== 'blobs') queue.push(absolutePath);
        continue;
      }
      if (!entry.isFile() && !entry.isSymbolicLink()) continue;
      let sizeBytes: number | null = null;
      try {
        sizeBytes = fs.statSync(absolutePath).size;
      } catch {
        // Broken cache links stay visible with an unknown size.
      }
      files.push({ path: path.relative(directory, absolutePath), sizeBytes });
      if (files.length >= MAX_SCANNED_FILES) break;
    }
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function modelFormat(files: readonly ModelFile[], modelPath: string): ModelFormat {
  if (files.some(file => file.path.toLowerCase().endsWith('.gguf'))) return 'gguf';
  if (files.some(file => file.path.toLowerCase().endsWith('.safetensors'))) return 'safetensors';
  if (files.some(file => file.path.toLowerCase().endsWith('.npz')) || modelPath.toLowerCase().includes('mlx')) {
    return 'mlx';
  }
  return 'other';
}

function modelCapabilities(name: string, format: ModelFormat): ModelCapability[] {
  const normalized = name.toLowerCase();
  if (normalized.includes('confucius4-r2t2') || normalized.includes('r2t2')) {
    return ['speech-recognition', 'microphone-stream', 'file-stream'];
  }
  if (normalized.includes('confucius4-t3po') || normalized.includes('t3po')) {
    return ['text-generation', 'translation', 'simultaneous-translation'];
  }
  if (normalized.includes('whisper')) return ['speech-recognition', 'file-batch'];
  if (format === 'gguf' || format === 'safetensors' || format === 'mlx') return ['text-generation'];
  return [];
}

function compatibleEngines(
  name: string,
  format: ModelFormat,
  capabilities: readonly ModelCapability[],
): ModelEngineId[] {
  const normalized = name.toLowerCase();
  if (normalized.includes('r2t2')) {
    return format === 'gguf'
      ? ['r2t2-runtime', 'llama.cpp']
      : ['r2t2-runtime', 'vllm'];
  }
  if (capabilities.includes('speech-recognition')) {
    return format === 'mlx' ? ['mlx-audio'] : ['whisper.cpp'];
  }
  if (format === 'gguf') return ['llama.cpp'];
  if (format === 'safetensors') return ['vllm'];
  if (format === 'mlx') return ['mlx-lm'];
  return [];
}

function huggingFaceIdentity(modelPath: string): ModelIdentity | null {
  const parts = modelPath.split(path.sep);
  const modelIndex = parts.findIndex(part => part.startsWith('models--'));
  const snapshotIndex = parts.lastIndexOf('snapshots');
  if (modelIndex < 0 || snapshotIndex < 0 || snapshotIndex + 1 >= parts.length) return null;
  const encodedRepo = parts[modelIndex].slice('models--'.length);
  const repoId = encodedRepo.split('--').join('/');
  return { source: 'huggingface', repoId, revision: parts[snapshotIndex + 1] };
}

function identityFor(modelPath: string, directory: ScanDirectoryInput): ModelIdentity {
  if (directory.kind === 'huggingface-cache') {
    return huggingFaceIdentity(modelPath) ?? { source: 'local', repoId: null, revision: null };
  }
  return { source: 'local', repoId: null, revision: null };
}

function displayName(modelPath: string, identity: ModelIdentity): string {
  if (identity.repoId) return identity.repoId.split('/').at(-1) ?? identity.repoId;
  return path.basename(modelPath);
}

function modelId(modelPath: string, identity: ModelIdentity): string {
  return crypto.createHash('sha256')
    .update(`${identity.source}\0${identity.repoId ?? ''}\0${identity.revision ?? ''}\0${modelPath}`)
    .digest('hex');
}

function toDownloadedModel(modelPath: string, directory: ScanDirectoryInput): DownloadedModel {
  const files = listFiles(modelPath);
  const identity = identityFor(modelPath, directory);
  const name = displayName(modelPath, identity);
  const format = modelFormat(files, modelPath);
  const capabilities = modelCapabilities(identity.repoId ?? name, format);
  const preferredModelFile = files
    .filter(file => (
      format === 'gguf'
        ? file.path.toLowerCase().endsWith('.gguf')
        : capabilities.includes('speech-recognition')
          && /\.(bin|ggml)$/i.test(file.path)
    ))
    .sort((left, right) => (right.sizeBytes ?? 0) - (left.sizeBytes ?? 0))[0];
  const launchPath = preferredModelFile ? path.join(modelPath, preferredModelFile.path) : modelPath;
  let modifiedAt = 0;
  try {
    modifiedAt = fs.statSync(modelPath).mtimeMs;
  } catch {
    // Keep a deterministic zero for paths that disappear during a scan.
  }
  return {
    id: modelId(modelPath, identity),
    name,
    defaultName: name,
    author: identity.repoId?.split('/')[0] ?? null,
    source: identity.source,
    repoId: identity.repoId,
    revision: identity.revision,
    path: launchPath,
    storagePath: modelPath,
    format,
    sizeBytes: files.reduce((total, file) => total + (file.sizeBytes ?? 0), 0),
    files,
    capabilities,
    compatibleEngineIds: compatibleEngines(identity.repoId ?? name, format, capabilities),
    complete: !files.some(file => file.path.endsWith('.partial')),
    favorite: false,
    modifiedAt,
  };
}

export function scanModelDirectories(directories: readonly ScanDirectoryInput[]): DownloadedModel[] {
  const models = new Map<string, DownloadedModel>();
  for (const directory of directories) {
    const state: ScanState = { scannedFiles: 0, modelRoots: new Set() };
    collectModelRoots(directory.path, 0, state);
    for (const modelPath of state.modelRoots) {
      const model = toDownloadedModel(modelPath, directory);
      models.set(model.id, model);
    }
  }
  return [...models.values()].sort((left, right) => right.modifiedAt - left.modifiedAt);
}
