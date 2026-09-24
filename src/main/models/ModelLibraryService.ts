import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Worker } from 'worker_threads';
import type Database from 'better-sqlite3';
import type {
  DownloadedModel,
  MarketModel,
  MarketModelDetails,
  ModelCapability,
  ModelDirectory,
  ModelDownload,
  ModelDownloadRequest,
  ModelFile,
  ModelFormat,
  ModelMarketQuery,
  ModelEngineId,
  ModelSource,
} from '../../shared/models/types';
import type { ScanDirectoryInput } from './ModelScanner';

const REQUEST_TIMEOUT_MS = 20_000;
const DOWNLOAD_PROGRESS_INTERVAL_MS = 250;

const CURATED_MODELS: readonly MarketModel[] = [
  {
    id: 'huggingface:netease-youdao/Confucius4-R2T2:main',
    name: 'Confucius4-R2T2',
    author: 'netease-youdao',
    source: 'huggingface',
    repoId: 'netease-youdao/Confucius4-R2T2',
    revision: 'main',
    updatedAt: null,
    downloads: null,
    likes: null,
    license: null,
    formats: ['safetensors'],
    capabilities: ['speech-recognition', 'microphone-stream', 'file-stream'],
    favorite: false,
    featured: true,
    sourceUrl: 'https://huggingface.co/netease-youdao/Confucius4-R2T2',
  },
  {
    id: 'huggingface:netease-youdao/Confucius4-T3PO:main',
    name: 'Confucius4-T3PO',
    author: 'netease-youdao',
    source: 'huggingface',
    repoId: 'netease-youdao/Confucius4-T3PO',
    revision: 'main',
    updatedAt: null,
    downloads: null,
    likes: null,
    license: null,
    formats: ['safetensors'],
    capabilities: ['text-generation', 'translation', 'simultaneous-translation'],
    favorite: false,
    featured: true,
    sourceUrl: 'https://huggingface.co/netease-youdao/Confucius4-T3PO',
  },
];

interface FavoriteRow {
  source: string;
  repo_id: string;
  revision: string;
  metadata_json: string;
}

interface DownloadRow {
  id: string;
  source: string;
  repo_id: string;
  revision: string;
  file_path: string | null;
  target_path: string;
  status: string;
  downloaded_bytes: number;
  total_bytes: number | null;
  error: string | null;
}

interface WorkerSuccess {
  ok: true;
  models: DownloadedModel[];
}

interface WorkerFailure {
  ok: false;
  error: string;
}

type WorkerResult = WorkerSuccess | WorkerFailure;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function modelCapabilityValue(value: unknown): ModelCapability | null {
  if (value === 'text-generation' || value === 'translation' || value === 'speech-recognition'
    || value === 'speech-synthesis' || value === 'microphone-stream' || value === 'file-stream'
    || value === 'file-batch' || value === 'simultaneous-translation') return value;
  return null;
}

function modelFormatValue(value: unknown): ModelFormat | null {
  if (value === 'gguf' || value === 'safetensors' || value === 'mlx' || value === 'other') return value;
  return null;
}

function modelEngineIdValue(value: unknown): ModelEngineId | null {
  if (value === 'llama.cpp' || value === 'whisper.cpp' || value === 'vllm'
    || value === 'mlx-lm' || value === 'mlx-audio' || value === 'r2t2-runtime') return value;
  return null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function modelFormatFromNames(names: readonly string[], tags: readonly string[]): ModelFormat[] {
  const normalizedTags = tags.map(tag => tag.toLowerCase());
  const formats = new Set<ModelFormat>();
  if (names.some(name => name.toLowerCase().endsWith('.gguf')) || normalizedTags.includes('gguf')) {
    formats.add('gguf');
  }
  if (names.some(name => name.toLowerCase().endsWith('.safetensors'))
    || normalizedTags.includes('safetensors')) {
    formats.add('safetensors');
  }
  if (normalizedTags.includes('mlx') || normalizedTags.includes('library:mlx')) formats.add('mlx');
  if (formats.size === 0) formats.add('other');
  return [...formats];
}

function capabilitiesFor(repoId: string, tags: readonly string[]): ModelCapability[] {
  const normalized = `${repoId} ${tags.join(' ')}`.toLowerCase();
  if (normalized.includes('r2t2')) return ['speech-recognition', 'microphone-stream', 'file-stream'];
  if (normalized.includes('t3po')) return ['text-generation', 'translation', 'simultaneous-translation'];
  if (normalized.includes('automatic-speech-recognition') || normalized.includes('whisper')) {
    return ['speech-recognition', 'file-batch'];
  }
  if (normalized.includes('text-to-speech')) return ['speech-synthesis'];
  return ['text-generation'];
}

function licenseFromTags(tags: readonly string[]): string | null {
  const value = tags.find(tag => tag.toLowerCase().startsWith('license:'));
  return value ? value.slice('license:'.length) : null;
}

function marketIdentity(source: Exclude<ModelSource, 'local'>, repoId: string, revision: string): string {
  return `${source}:${repoId}:${revision}`;
}

function safePathSegment(value: string): string {
  const normalized = value.replace(/[^a-zA-Z0-9._-]+/g, '--').replace(/^[-.]+|[-.]+$/g, '');
  if (!normalized) throw new Error('Model path segment is invalid');
  return normalized;
}

function safeTargetPath(root: string, relativePath: string): string {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, relativePath);
  if (target !== resolvedRoot && !target.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error('Model file path escapes the download directory');
  }
  return target;
}

function encodeRepoPath(filePath: string): string {
  return filePath.split('/').map(segment => encodeURIComponent(segment)).join('/');
}

function workerResult(value: unknown): WorkerResult {
  if (!isRecord(value) || typeof value.ok !== 'boolean') throw new Error('Model scanner returned invalid data');
  if (value.ok === false) {
    return { ok: false, error: stringValue(value.error) ?? 'Model scan failed' };
  }
  if (!Array.isArray(value.models)) throw new Error('Model scanner returned an invalid model list');
  return { ok: true, models: value.models.map(parseDownloadedModel) };
}

function parseDownloadedModel(value: unknown): DownloadedModel {
  if (!isRecord(value)) throw new Error('Model scanner returned an invalid model');
  const source = value.source;
  if (source !== 'huggingface' && source !== 'modelscope' && source !== 'local') {
    throw new Error('Model scanner returned an invalid source');
  }
  const format = modelFormatValue(value.format);
  if (!format || !Array.isArray(value.files)) throw new Error('Model scanner returned invalid model metadata');
  const files = value.files.map(file => {
    if (!isRecord(file) || typeof file.path !== 'string') throw new Error('Model scanner returned an invalid file');
    return { path: file.path, sizeBytes: numberValue(file.sizeBytes) };
  });
  const capabilities = Array.isArray(value.capabilities)
    ? value.capabilities.flatMap(candidate => {
        const parsed = modelCapabilityValue(candidate);
        return parsed ? [parsed] : [];
      })
    : [];
  const compatibleEngineIds = Array.isArray(value.compatibleEngineIds)
    ? value.compatibleEngineIds.flatMap(candidate => {
        const parsed = modelEngineIdValue(candidate);
        return parsed ? [parsed] : [];
      })
    : [];
  const id = stringValue(value.id);
  const name = stringValue(value.name);
  const defaultName = stringValue(value.defaultName) ?? name;
  const modelPath = stringValue(value.path);
  const storagePath = stringValue(value.storagePath);
  if (!id || !name || !defaultName || !modelPath || !storagePath) {
    throw new Error('Model scanner returned an incomplete model');
  }
  return {
    id,
    name,
    defaultName,
    author: stringValue(value.author),
    source,
    repoId: stringValue(value.repoId),
    revision: stringValue(value.revision),
    path: modelPath,
    storagePath,
    format,
    sizeBytes: numberValue(value.sizeBytes) ?? 0,
    files,
    capabilities,
    compatibleEngineIds,
    complete: value.complete === true,
    favorite: value.favorite === true,
    modifiedAt: numberValue(value.modifiedAt) ?? 0,
  };
}

function parseFavoriteRow(value: unknown): FavoriteRow | null {
  if (!isRecord(value) || typeof value.source !== 'string' || typeof value.repo_id !== 'string'
    || typeof value.revision !== 'string' || typeof value.metadata_json !== 'string') return null;
  return {
    source: value.source,
    repo_id: value.repo_id,
    revision: value.revision,
    metadata_json: value.metadata_json,
  };
}

function parseDownloadDatabaseRow(value: unknown): DownloadRow | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.source !== 'string'
    || typeof value.repo_id !== 'string' || typeof value.revision !== 'string'
    || typeof value.target_path !== 'string' || typeof value.status !== 'string'
    || typeof value.downloaded_bytes !== 'number') return null;
  return {
    id: value.id,
    source: value.source,
    repo_id: value.repo_id,
    revision: value.revision,
    file_path: typeof value.file_path === 'string' ? value.file_path : null,
    target_path: value.target_path,
    status: value.status,
    downloaded_bytes: value.downloaded_bytes,
    total_bytes: numberValue(value.total_bytes),
    error: typeof value.error === 'string' ? value.error : null,
  };
}

function parsedFavorite(value: string): MarketModel | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed)) return null;
    const source = parsed.source;
    const repoId = stringValue(parsed.repoId);
    const revision = stringValue(parsed.revision);
    if ((source !== 'huggingface' && source !== 'modelscope') || !repoId || !revision) return null;
    const storedFormats = stringArray(parsed.formats).flatMap(candidate => {
      const format = modelFormatValue(candidate);
      return format ? [format] : [];
    });
    const storedCapabilities = stringArray(parsed.capabilities).flatMap(candidate => {
      const capability = modelCapabilityValue(candidate);
      return capability ? [capability] : [];
    });
    return {
      id: marketIdentity(source, repoId, revision),
      name: stringValue(parsed.name) ?? repoId.split('/').at(-1) ?? repoId,
      author: stringValue(parsed.author),
      source,
      repoId,
      revision,
      updatedAt: stringValue(parsed.updatedAt),
      downloads: numberValue(parsed.downloads),
      likes: numberValue(parsed.likes),
      license: stringValue(parsed.license),
      formats: storedFormats.length > 0 ? storedFormats : ['other'],
      capabilities: storedCapabilities.length > 0 ? storedCapabilities : capabilitiesFor(repoId, []),
      favorite: true,
      featured: parsed.featured === true,
      sourceUrl: stringValue(parsed.sourceUrl)
        ?? (source === 'huggingface'
          ? `https://huggingface.co/${repoId}`
          : `https://modelscope.cn/models/${repoId}`),
    };
  } catch {
    return null;
  }
}

function parseDownloadRow(row: DownloadRow): ModelDownload {
  const source = row.source === 'modelscope' ? 'modelscope' : 'huggingface';
  const status = row.status === 'queued' || row.status === 'downloading'
    || row.status === 'completed' || row.status === 'failed' || row.status === 'cancelled'
    ? row.status
    : 'failed';
  return {
    id: row.id,
    source,
    repoId: row.repo_id,
    revision: row.revision,
    filePath: row.file_path,
    targetPath: row.target_path,
    status,
    downloadedBytes: row.downloaded_bytes,
    totalBytes: row.total_bytes,
    error: row.error,
  };
}

function parseHuggingFaceModel(value: unknown, favorites: ReadonlySet<string>): MarketModel | null {
  if (!isRecord(value)) return null;
  const repoId = stringValue(value.id) ?? stringValue(value.modelId);
  if (!repoId || value.private === true || Boolean(value.gated)) return null;
  const tags = stringArray(value.tags);
  const siblings = Array.isArray(value.siblings) ? value.siblings : [];
  const names = siblings.flatMap(sibling => {
    if (!isRecord(sibling)) return [];
    const name = stringValue(sibling.rfilename);
    return name ? [name] : [];
  });
  const revision = stringValue(value.sha) ?? 'main';
  const id = marketIdentity('huggingface', repoId, revision);
  return {
    id,
    name: repoId.split('/').at(-1) ?? repoId,
    author: stringValue(value.author) ?? repoId.split('/')[0] ?? null,
    source: 'huggingface',
    repoId,
    revision,
    updatedAt: stringValue(value.lastModified),
    downloads: numberValue(value.downloads),
    likes: numberValue(value.likes),
    license: licenseFromTags(tags),
    formats: modelFormatFromNames(names, tags),
    capabilities: capabilitiesFor(repoId, [...tags, stringValue(value.pipeline_tag) ?? '']),
    favorite: favorites.has(id),
    featured: false,
    sourceUrl: `https://huggingface.co/${repoId}`,
  };
}

function parseModelScopeModel(value: unknown, favorites: ReadonlySet<string>): MarketModel | null {
  if (!isRecord(value)) return null;
  const repoId = stringValue(value.id);
  if (!repoId) return null;
  const revision = 'master';
  const id = marketIdentity('modelscope', repoId, revision);
  const tags = stringArray(value.tags);
  const tasks = stringArray(value.tasks);
  return {
    id,
    name: stringValue(value.display_name) ?? repoId.split('/').at(-1) ?? repoId,
    author: repoId.split('/')[0] ?? null,
    source: 'modelscope',
    repoId,
    revision,
    updatedAt: stringValue(value.last_modified),
    downloads: numberValue(value.downloads),
    likes: numberValue(value.likes),
    license: stringValue(value.license),
    formats: modelFormatFromNames([], tags),
    capabilities: capabilitiesFor(repoId, [...tags, ...tasks]),
    favorite: favorites.has(id),
    featured: false,
    sourceUrl: `https://modelscope.cn/models/${repoId}`,
  };
}

export function defaultManagedModelDirectory(): string {
  return path.join(os.homedir(), '.cache', 'tiginal', 'models');
}

export class ModelLibraryService {
  private downloadedModels: DownloadedModel[] = [];
  private readonly downloadControllers = new Map<string, AbortController>();

  constructor(private readonly db: Database.Database) {
    fs.mkdirSync(defaultManagedModelDirectory(), { recursive: true });
    this.db.prepare(`
      UPDATE model_downloads
      SET status = 'failed', error = 'Tiginal exited before the download completed', updated_at = ?
      WHERE status IN ('queued', 'downloading')
    `).run(Date.now());
  }

  listDirectories(): ModelDirectory[] {
    const directories: ModelDirectory[] = [{
      path: defaultManagedModelDirectory(),
      kind: 'managed',
      enabled: true,
      removable: false,
    }];
    const configuredRows: unknown[] = this.db.prepare(`
      SELECT path, enabled FROM model_directories ORDER BY created_at
    `).all();
    for (const row of configuredRows) {
      if (!isRecord(row) || typeof row.path !== 'string' || typeof row.enabled !== 'number') continue;
      directories.push({ path: row.path, kind: 'user', enabled: row.enabled === 1, removable: true });
    }
    const environmentDirectories = [
      process.env.HUGGINGFACE_HUB_CACHE,
      process.env.HF_HOME ? path.join(process.env.HF_HOME, 'hub') : null,
      path.join(os.homedir(), '.cache', 'huggingface', 'hub'),
    ];
    for (const directoryPath of environmentDirectories) {
      if (!directoryPath) continue;
      directories.push({
        path: directoryPath,
        kind: 'huggingface-cache',
        enabled: true,
        removable: false,
      });
    }
    const unique = new Map<string, ModelDirectory>();
    for (const directory of directories) {
      const normalized = path.resolve(directory.path);
      if (!unique.has(normalized)) unique.set(normalized, { ...directory, path: normalized });
    }
    const order: Record<ModelDirectory['kind'], number> = {
      managed: 0,
      'huggingface-cache': 1,
      user: 2,
    };
    return [...unique.values()].sort((left, right) => order[left.kind] - order[right.kind]);
  }

  homeDirectory(): string {
    return os.homedir();
  }

  addDirectory(rawPath: string): ModelDirectory[] {
    const directoryPath = path.resolve(rawPath.trim());
    if (!directoryPath || !fs.existsSync(directoryPath) || !fs.statSync(directoryPath).isDirectory()) {
      throw new Error('Model directory must be an existing directory');
    }
    this.db.prepare(`
      INSERT INTO model_directories (path, kind, enabled, created_at)
      VALUES (?, 'user', 1, ?)
      ON CONFLICT(path) DO UPDATE SET enabled = 1
    `).run(directoryPath, Date.now());
    return this.listDirectories();
  }

  removeDirectory(rawPath: string): ModelDirectory[] {
    this.db.prepare(`DELETE FROM model_directories WHERE path = ?`).run(path.resolve(rawPath));
    return this.listDirectories();
  }

  async scanDownloadedModels(): Promise<DownloadedModel[]> {
    const directories: ScanDirectoryInput[] = this.listDirectories()
      .filter(directory => directory.enabled && fs.existsSync(directory.path))
      .map(directory => ({ path: directory.path, kind: directory.kind }));
    const models = await new Promise<DownloadedModel[]>((resolve, reject) => {
      const worker = new Worker(path.join(__dirname, 'ModelScannerWorker.js'));
      worker.once('message', (value: unknown) => {
        try {
          const result = workerResult(value);
          if (result.ok) resolve(result.models);
          else reject(new Error(result.error));
        } catch (error) {
          reject(error);
        } finally {
          void worker.terminate();
        }
      });
      worker.once('error', reject);
      worker.postMessage(directories);
    });
    const favorites = this.favoriteIdentitySet();
    const completedDownloads = this.listDownloads().filter(download => download.status === 'completed');
    const aliases = this.modelAliasMap();
    this.downloadedModels = models.map(model => {
      const modelPath = path.resolve(model.path);
      const download = completedDownloads.find(candidate => {
        const targetPath = path.resolve(candidate.targetPath);
        return modelPath === targetPath || modelPath.startsWith(`${targetPath}${path.sep}`);
      });
      const source = download?.source ?? model.source;
      const repoId = download?.repoId ?? model.repoId;
      const revision = download?.revision ?? model.revision;
      const remoteSource = source === 'modelscope' ? 'modelscope' : 'huggingface';
      const defaultName = repoId?.split('/').at(-1) ?? model.defaultName;
      return {
        ...model,
        id: repoId ? marketIdentity(remoteSource, repoId, revision ?? 'main') : model.id,
        name: aliases.get(path.resolve(model.storagePath)) ?? defaultName,
        defaultName,
        author: repoId?.split('/')[0] ?? model.author,
        source,
        repoId,
        revision,
        favorite: repoId !== null && favorites.has(
          marketIdentity(
            remoteSource,
            repoId,
            revision ?? 'main',
          ),
        ),
      };
    });
    return this.downloadedModels;
  }

  listDownloadedModels(): DownloadedModel[] {
    return this.downloadedModels;
  }

  renameDownloadedModel(id: string, rawName: string): DownloadedModel[] {
    const model = this.downloadedModels.find(candidate => candidate.id === id);
    if (!model) throw new Error('Downloaded model was not found');
    const name = rawName.trim();
    if (!name) throw new Error('Model name is required');
    if (name.length > 120) throw new Error('Model name must be 120 characters or fewer');
    const storagePath = path.resolve(model.storagePath);
    this.db.prepare(`
      INSERT INTO model_aliases (storage_path, display_name, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(storage_path) DO UPDATE SET
        display_name = excluded.display_name,
        updated_at = excluded.updated_at
    `).run(storagePath, name, Date.now());
    this.downloadedModels = this.downloadedModels.map(candidate => (
      candidate.id === id ? { ...candidate, name } : candidate
    ));
    return this.downloadedModels;
  }

  async deleteDownloadedModel(id: string, activeModelPaths: readonly string[] = []): Promise<DownloadedModel[]> {
    const model = this.downloadedModels.find(candidate => candidate.id === id);
    if (!model) throw new Error('Downloaded model was not found');
    const target = path.resolve(model.storagePath);
    const roots = this.listDirectories()
      .filter(directory => directory.enabled)
      .map(directory => path.resolve(directory.path));
    const containingRoot = roots.find(root => target.startsWith(`${root}${path.sep}`));
    if (!containingRoot || target === containingRoot) {
      throw new Error('The model directory cannot be deleted safely');
    }
    const realRoot = fs.realpathSync(containingRoot);
    const realTarget = fs.realpathSync(target);
    if (!realTarget.startsWith(`${realRoot}${path.sep}`)) {
      throw new Error('The model directory resolves outside its configured scan directory');
    }
    if (activeModelPaths.some(modelPath => {
      const activePath = path.resolve(modelPath);
      return activePath === target || activePath.startsWith(`${target}${path.sep}`);
    })) {
      throw new Error('Stop services that use this model before deleting it');
    }
    fs.rmSync(target, { recursive: true, force: false });
    this.db.prepare(`DELETE FROM model_downloads WHERE target_path = ?`).run(target);
    this.db.prepare(`DELETE FROM model_aliases WHERE storage_path = ?`).run(target);
    return this.scanDownloadedModels();
  }

  async searchMarket(query: ModelMarketQuery): Promise<MarketModel[]> {
    const favorites = this.favoriteIdentitySet();
    if (!query.search.trim()) {
      return CURATED_MODELS
        .filter(model => model.source === query.source)
        .filter(model => !query.capability || model.capabilities.includes(query.capability))
        .filter(model => !query.format || model.formats.includes(query.format))
        .map(model => ({ ...model, favorite: favorites.has(model.id) }));
    }
    return query.source === 'huggingface'
      ? this.searchHuggingFace(query, favorites)
      : this.searchModelScope(query, favorites);
  }

  async getDetails(model: MarketModel): Promise<MarketModelDetails> {
    const files = model.source === 'huggingface'
      ? await this.huggingFaceFiles(model.repoId, model.revision)
      : await this.modelScopeFiles(model.repoId, model.revision);
    const compatibleEngineIds = new Set<ModelEngineId>();
    for (const format of model.formats) {
      if (model.capabilities.includes('speech-recognition')) {
        if (model.repoId.toLowerCase().includes('r2t2')) {
          compatibleEngineIds.add('r2t2-runtime');
          compatibleEngineIds.add(format === 'gguf' ? 'llama.cpp' : 'vllm');
          continue;
        }
        compatibleEngineIds.add(format === 'mlx' ? 'mlx-audio' : 'whisper.cpp');
        continue;
      }
      if (format === 'gguf') compatibleEngineIds.add('llama.cpp');
      if (format === 'safetensors') compatibleEngineIds.add('vllm');
      if (format === 'mlx') compatibleEngineIds.add('mlx-lm');
    }
    return {
      ...model,
      files,
      totalSizeBytes: files.reduce((total, file) => total + (file.sizeBytes ?? 0), 0),
      compatibleEngineIds: [...compatibleEngineIds],
    };
  }

  setFavorite(model: MarketModel, favorite: boolean): void {
    if (favorite) {
      this.db.prepare(`
        INSERT INTO model_favorites (source, repo_id, revision, metadata_json, created_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(source, repo_id, revision)
        DO UPDATE SET metadata_json = excluded.metadata_json
      `).run(model.source, model.repoId, model.revision, JSON.stringify(model), Date.now());
    } else {
      this.db.prepare(`
        DELETE FROM model_favorites WHERE source = ? AND repo_id = ? AND revision = ?
      `).run(model.source, model.repoId, model.revision);
    }
  }

  listFavorites(): MarketModel[] {
    const rawRows: unknown[] = this.db.prepare(`
      SELECT source, repo_id, revision, metadata_json FROM model_favorites ORDER BY created_at DESC
    `).all();
    const rows = rawRows.flatMap(value => {
      const row = parseFavoriteRow(value);
      return row ? [row] : [];
    });
    return rows.flatMap(row => {
      const model = parsedFavorite(row.metadata_json);
      return model ? [model] : [];
    });
  }

  async startDownload({ model, file }: ModelDownloadRequest): Promise<ModelDownload> {
    const existing = this.listDownloads().find(download => (
      download.source === model.source
      && download.repoId === model.repoId
      && download.revision === model.revision
      && download.filePath === file.path
      && (download.status === 'queued' || download.status === 'downloading')
    ));
    if (existing) return existing;

    const id = crypto.randomUUID();
    const targetPath = path.join(
      defaultManagedModelDirectory(),
      `${model.source}--${safePathSegment(model.repoId)}--${safePathSegment(model.revision)}`,
    );
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO model_downloads (
        id, source, repo_id, revision, file_path, target_path, status,
        downloaded_bytes, total_bytes, error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'queued', 0, ?, NULL, ?, ?)
    `).run(id, model.source, model.repoId, model.revision, file.path, targetPath, file.sizeBytes, now, now);
    const controller = new AbortController();
    this.downloadControllers.set(id, controller);
    void this.downloadFile(id, model, file, targetPath, controller.signal);
    return this.requireDownload(id);
  }

  cancelDownload(id: string): void {
    this.downloadControllers.get(id)?.abort();
    this.db.prepare(`
      UPDATE model_downloads SET status = 'cancelled', error = NULL, updated_at = ? WHERE id = ?
    `).run(Date.now(), id);
  }

  listDownloads(): ModelDownload[] {
    const rawRows: unknown[] = this.db.prepare(`
      SELECT id, source, repo_id, revision, target_path, status,
             file_path, downloaded_bytes, total_bytes, error
      FROM model_downloads ORDER BY updated_at DESC
    `).all();
    const rows = rawRows.flatMap(value => {
      const row = parseDownloadDatabaseRow(value);
      return row ? [row] : [];
    });
    return rows.map(parseDownloadRow);
  }

  dispose(): void {
    for (const controller of this.downloadControllers.values()) controller.abort();
    this.downloadControllers.clear();
  }

  private favoriteIdentitySet(): Set<string> {
    const rawRows: unknown[] = this.db.prepare(`
      SELECT source, repo_id, revision FROM model_favorites
    `).all();
    return new Set(rawRows.flatMap(row => {
      if (!isRecord(row) || typeof row.repo_id !== 'string' || typeof row.revision !== 'string') return [];
      return [marketIdentity(
        row.source === 'modelscope' ? 'modelscope' : 'huggingface',
        row.repo_id,
        row.revision,
      )];
    }));
  }

  private modelAliasMap(): Map<string, string> {
    const rows: unknown[] = this.db.prepare(`
      SELECT storage_path, display_name FROM model_aliases
    `).all();
    const aliases = new Map<string, string>();
    for (const row of rows) {
      if (!isRecord(row) || typeof row.storage_path !== 'string'
        || typeof row.display_name !== 'string' || !row.display_name.trim()) continue;
      aliases.set(path.resolve(row.storage_path), row.display_name.trim());
    }
    return aliases;
  }

  private async searchHuggingFace(
    query: ModelMarketQuery,
    favorites: ReadonlySet<string>,
  ): Promise<MarketModel[]> {
    const url = new URL('https://huggingface.co/api/models');
    url.searchParams.set('search', query.search.trim());
    url.searchParams.set('limit', '30');
    url.searchParams.set('sort', query.sort === 'updated' ? 'lastModified' : 'downloads');
    url.searchParams.set('direction', '-1');
    url.searchParams.set('full', 'true');
    if (query.format && query.format !== 'other') url.searchParams.append('filter', query.format);
    const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`Hugging Face search failed with status ${response.status}`);
    const value: unknown = await response.json();
    if (!Array.isArray(value)) throw new Error('Hugging Face returned an invalid model list');
    return value.flatMap(item => {
      const model = parseHuggingFaceModel(item, favorites);
      if (!model) return [];
      if (query.format && !model.formats.includes(query.format)) return [];
      if (query.capability && !model.capabilities.includes(query.capability)) return [];
      return [model];
    });
  }

  private async searchModelScope(
    query: ModelMarketQuery,
    favorites: ReadonlySet<string>,
  ): Promise<MarketModel[]> {
    const url = new URL('https://modelscope.cn/openapi/v1/models');
    const search = query.format && query.format !== 'other'
      ? `${query.search.trim()} ${query.format}`
      : query.search.trim();
    url.searchParams.set('search', search);
    url.searchParams.set('page', '1');
    url.searchParams.set('page_size', '30');
    const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`ModelScope search failed with status ${response.status}`);
    const value: unknown = await response.json();
    if (!isRecord(value) || !isRecord(value.data) || !Array.isArray(value.data.models)) {
      throw new Error('ModelScope returned an invalid model list');
    }
    return value.data.models.flatMap(item => {
      const model = parseModelScopeModel(item, favorites);
      if (!model) return [];
      if (query.format && !model.formats.includes(query.format)) return [];
      if (query.capability && !model.capabilities.includes(query.capability)) return [];
      return [model];
    });
  }

  private async huggingFaceFiles(repoId: string, revision: string): Promise<ModelFile[]> {
    const url = `https://huggingface.co/api/models/${repoId}/tree/${encodeURIComponent(revision)}?recursive=true&blobs=true`;
    const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`Hugging Face file listing failed with status ${response.status}`);
    const value: unknown = await response.json();
    if (!Array.isArray(value)) throw new Error('Hugging Face returned an invalid file list');
    return value.flatMap(item => {
      if (!isRecord(item) || item.type !== 'file') return [];
      const filePath = stringValue(item.path);
      if (!filePath) return [];
      const lfsSize = isRecord(item.lfs) ? numberValue(item.lfs.size) : null;
      return [{ path: filePath, sizeBytes: lfsSize ?? numberValue(item.size) }];
    });
  }

  private async modelScopeFiles(repoId: string, revision: string): Promise<ModelFile[]> {
    const [owner, ...nameParts] = repoId.split('/');
    const name = nameParts.join('/');
    if (!owner || !name) throw new Error('ModelScope repository ID must contain an owner and name');
    const url = new URL(`https://modelscope.cn/api/v1/models/${owner}/${name}/repo/files`);
    url.searchParams.set('Revision', revision);
    url.searchParams.set('Recursive', 'true');
    const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`ModelScope file listing failed with status ${response.status}`);
    const value: unknown = await response.json();
    const data = isRecord(value) ? value.Data : null;
    const files = isRecord(data) ? data.Files : null;
    if (!Array.isArray(files)) throw new Error('ModelScope returned an invalid file list');
    return files.flatMap(item => {
      if (!isRecord(item)) return [];
      const filePath = stringValue(item.Path);
      return filePath ? [{ path: filePath, sizeBytes: numberValue(item.Size) }] : [];
    });
  }

  private fileUrl(model: MarketModel, filePath: string): string {
    const encodedPath = encodeRepoPath(filePath);
    return model.source === 'huggingface'
      ? `https://huggingface.co/${model.repoId}/resolve/${encodeURIComponent(model.revision)}/${encodedPath}`
      : `https://modelscope.cn/models/${model.repoId}/resolve/${encodeURIComponent(model.revision)}/${encodedPath}`;
  }

  private requireDownload(id: string): ModelDownload {
    const rawRow: unknown = this.db.prepare(`
      SELECT id, source, repo_id, revision, target_path, status,
             file_path, downloaded_bytes, total_bytes, error
      FROM model_downloads WHERE id = ?
    `).get(id);
    const row = parseDownloadDatabaseRow(rawRow);
    if (!row) throw new Error('Model download not found');
    return parseDownloadRow(row);
  }

  private async downloadFile(
    id: string,
    model: MarketModel,
    file: ModelFile,
    targetPath: string,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      const totalBytes = file.sizeBytes;
      if (totalBytes !== null) {
        const disk = fs.statfsSync(path.dirname(defaultManagedModelDirectory()));
        const availableBytes = disk.bavail * disk.bsize;
        if (availableBytes < totalBytes) throw new Error('Not enough free disk space for this file');
      }
      fs.mkdirSync(targetPath, { recursive: true });
      this.db.prepare(`
        UPDATE model_downloads
        SET status = 'downloading', total_bytes = ?, error = NULL, updated_at = ?
        WHERE id = ?
      `).run(totalBytes, Date.now(), id);

      let lastProgressUpdate = 0;
      if (signal.aborted) throw new DOMException('Download cancelled', 'AbortError');
      const destination = safeTargetPath(targetPath, file.path);
      const partialPath = `${destination}.partial`;
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      if (fs.existsSync(destination) && file.sizeBytes !== null
        && fs.statSync(destination).size === file.sizeBytes) {
        this.db.prepare(`
          UPDATE model_downloads
          SET status = 'completed', downloaded_bytes = ?, error = NULL, updated_at = ?
          WHERE id = ?
        `).run(file.sizeBytes, Date.now(), id);
        await this.scanDownloadedModels();
        return;
      }
      const partialSize = fs.existsSync(partialPath) ? fs.statSync(partialPath).size : 0;
      const headers = partialSize > 0 ? { Range: `bytes=${partialSize}-` } : undefined;
      const response = await fetch(this.fileUrl(model, file.path), { headers, signal });
      if (!response.ok && response.status !== 206) {
        throw new Error(`Download failed for ${file.path} with status ${response.status}`);
      }
      if (!response.body) throw new Error(`Download returned no data for ${file.path}`);
      const append = partialSize > 0 && response.status === 206;
      const stream = fs.createWriteStream(partialPath, { flags: append ? 'a' : 'w' });
      let downloadedBytes = append ? partialSize : 0;
      const reader = response.body.getReader();
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        if (signal.aborted) throw new DOMException('Download cancelled', 'AbortError');
        const buffer = Buffer.from(result.value);
        if (!stream.write(buffer)) {
          await new Promise<void>(resolve => stream.once('drain', resolve));
        }
        downloadedBytes += buffer.byteLength;
        const now = Date.now();
        if (now - lastProgressUpdate >= DOWNLOAD_PROGRESS_INTERVAL_MS) {
          this.db.prepare(`
            UPDATE model_downloads SET downloaded_bytes = ?, updated_at = ? WHERE id = ?
          `).run(downloadedBytes, now, id);
          lastProgressUpdate = now;
        }
      }
      await new Promise<void>((resolve, reject) => {
        stream.once('error', reject);
        stream.end(resolve);
      });
      if (file.sizeBytes !== null && downloadedBytes !== file.sizeBytes) {
        throw new Error(`Downloaded size does not match ${file.path}`);
      }
      fs.renameSync(partialPath, destination);
      this.db.prepare(`
        UPDATE model_downloads
        SET status = 'completed', downloaded_bytes = ?, error = NULL, updated_at = ?
        WHERE id = ?
      `).run(downloadedBytes, Date.now(), id);
      await this.scanDownloadedModels();
    } catch (error) {
      const cancelled = signal.aborted || (error instanceof DOMException && error.name === 'AbortError');
      this.db.prepare(`
        UPDATE model_downloads SET status = ?, error = ?, updated_at = ? WHERE id = ?
      `).run(
        cancelled ? 'cancelled' : 'failed',
        cancelled ? null : error instanceof Error ? error.message : String(error),
        Date.now(),
        id,
      );
    } finally {
      this.downloadControllers.delete(id);
    }
  }
}
