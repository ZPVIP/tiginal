export const MODEL_ENGINE_IDS = [
  'llama.cpp',
  'whisper.cpp',
  'vllm',
  'mlx-lm',
  'mlx-audio',
  'r2t2-runtime',
] as const;

export type ModelEngineId = typeof MODEL_ENGINE_IDS[number];
export type ModelEngineCategory = 'text-inference' | 'speech';
export type SupportedPlatform = 'darwin' | 'linux' | 'win32';
export type SupportedArchitecture = 'arm64' | 'x64';

export const MODEL_CAPABILITIES = [
  'text-generation',
  'translation',
  'speech-recognition',
  'speech-synthesis',
  'microphone-stream',
  'file-stream',
  'file-batch',
  'simultaneous-translation',
] as const;

export type ModelCapability = typeof MODEL_CAPABILITIES[number];

export type EngineProbeStatus =
  | {
      kind: 'available';
      executablePath: string;
      version: string | null;
      detail: string | null;
    }
  | {
      kind: 'missing';
      reason: string;
    }
  | {
      kind: 'unsupported';
      reason: string;
    }
  | {
      kind: 'misconfigured';
      reason: string;
      executablePath: string | null;
    };

export type EngineParameterDefinition =
  | {
      kind: 'text';
      key: string;
      label: string;
      defaultValue: string;
      placeholder?: string;
    }
  | {
      kind: 'integer';
      key: string;
      label: string;
      defaultValue: number;
      min: number;
      max: number;
    }
  | {
      kind: 'number';
      key: string;
      label: string;
      defaultValue: number;
      min: number;
      max: number;
      step: number;
    }
  | {
      kind: 'boolean';
      key: string;
      label: string;
      defaultValue: boolean;
    }
  | {
      kind: 'select';
      key: string;
      label: string;
      defaultValue: string;
      options: readonly { value: string; label: string }[];
    }
  | {
      kind: 'optional-integer';
      key: string;
      label: string;
      defaultValue: number | null;
      min: number;
      max: number;
      placeholder: string;
    };

export type EngineParameterValue = string | number | boolean | null;
export type EngineParameters = Record<string, EngineParameterValue>;

export interface ModelEngineView {
  id: ModelEngineId;
  name: string;
  description: string;
  categories: readonly ModelEngineCategory[];
  capabilities: readonly ModelCapability[];
  installHints: readonly string[];
  parameters: readonly EngineParameterDefinition[];
  status: EngineProbeStatus;
  runningInstances: number;
}

export interface SystemToolView {
  id: 'ffmpeg' | 'ffprobe';
  name: string;
  description: string;
  installHints: readonly string[];
  status: EngineProbeStatus;
}

export type ModelSource = 'huggingface' | 'modelscope' | 'local';
export type ModelFormat = 'gguf' | 'safetensors' | 'mlx' | 'other';

export interface ModelFile {
  path: string;
  sizeBytes: number | null;
}

export interface DownloadedModel {
  id: string;
  name: string;
  defaultName: string;
  author: string | null;
  source: ModelSource;
  repoId: string | null;
  revision: string | null;
  path: string;
  storagePath: string;
  format: ModelFormat;
  sizeBytes: number;
  files: readonly ModelFile[];
  capabilities: readonly ModelCapability[];
  compatibleEngineIds: readonly ModelEngineId[];
  complete: boolean;
  favorite: boolean;
  modifiedAt: number;
}

export interface ModelDirectory {
  path: string;
  kind: 'managed' | 'user' | 'huggingface-cache';
  enabled: boolean;
  removable: boolean;
}

export interface ModelMarketQuery {
  source: Exclude<ModelSource, 'local'>;
  search: string;
  capability?: ModelCapability;
  format?: ModelFormat;
  sort?: 'downloads' | 'updated';
}

export interface MarketModel {
  id: string;
  name: string;
  author: string | null;
  source: Exclude<ModelSource, 'local'>;
  repoId: string;
  revision: string;
  updatedAt: string | null;
  downloads: number | null;
  likes: number | null;
  license: string | null;
  formats: readonly ModelFormat[];
  capabilities: readonly ModelCapability[];
  favorite: boolean;
  featured: boolean;
  sourceUrl: string;
}

export interface MarketModelDetails extends MarketModel {
  files: readonly ModelFile[];
  totalSizeBytes: number;
  compatibleEngineIds: readonly ModelEngineId[];
}

export interface ModelDownloadRequest {
  model: MarketModel;
  file: ModelFile;
}

export type ModelDownloadStatus = 'queued' | 'downloading' | 'completed' | 'failed' | 'cancelled';

export interface ModelDownload {
  id: string;
  source: Exclude<ModelSource, 'local'>;
  repoId: string;
  revision: string;
  filePath: string | null;
  targetPath: string;
  status: ModelDownloadStatus;
  downloadedBytes: number;
  totalBytes: number | null;
  error: string | null;
}

export interface StartModelInput {
  engineId: ModelEngineId;
  modelPath: string;
  displayName: string;
  parameters: EngineParameters;
}

export type ModelInstanceStatus = 'starting' | 'running' | 'stopping' | 'stopped' | 'error';

export interface ModelInstance {
  id: string;
  engineId: ModelEngineId;
  modelPath: string;
  displayName: string;
  parameters: EngineParameters;
  commandLine: string | null;
  status: ModelInstanceStatus;
  pid: number | null;
  endpoint: string | null;
  startedAt: number | null;
  exitCode: number | null;
  error: string | null;
}

export type DefaultEngineKind = 'language-model' | 'speech-recognition' | 'speech-synthesis';

export interface DefaultEngineCandidate {
  id: string;
  label: string;
  description: string;
  source: 'remote' | 'local';
  capabilities: readonly ModelCapability[];
}

export interface DefaultEngineSelection {
  kind: DefaultEngineKind;
  targetId: string | null;
  candidates: readonly DefaultEngineCandidate[];
}

export interface ModelsRendererApi {
  listEngines(): Promise<{ engines: ModelEngineView[]; systemTools: SystemToolView[] }>;
  refreshEngines(): Promise<{ engines: ModelEngineView[]; systemTools: SystemToolView[] }>;
  listModelDirectories(): Promise<ModelDirectory[]>;
  addModelDirectory(path: string): Promise<ModelDirectory[]>;
  removeModelDirectory(path: string): Promise<ModelDirectory[]>;
  getHomeDirectory(): Promise<string>;
  scanDownloadedModels(): Promise<DownloadedModel[]>;
  listDownloadedModels(): Promise<DownloadedModel[]>;
  renameDownloadedModel(id: string, name: string): Promise<DownloadedModel[]>;
  deleteDownloadedModel(id: string): Promise<DownloadedModel[]>;
  searchModelMarket(query: ModelMarketQuery): Promise<MarketModel[]>;
  getMarketModelDetails(model: MarketModel): Promise<MarketModelDetails>;
  setModelFavorite(model: MarketModel, favorite: boolean): Promise<void>;
  listFavoriteModels(): Promise<MarketModel[]>;
  startModelDownload(request: ModelDownloadRequest): Promise<ModelDownload>;
  cancelModelDownload(id: string): Promise<void>;
  listModelDownloads(): Promise<ModelDownload[]>;
  listModelInstances(): Promise<ModelInstance[]>;
  startModel(input: StartModelInput): Promise<ModelInstance>;
  restartModel(id: string, input: StartModelInput): Promise<ModelInstance>;
  stopModel(id: string): Promise<ModelInstance>;
  deleteModelService(id: string): Promise<void>;
  getModelLogs(id: string): Promise<string[]>;
  listDefaultEngineSelections(): Promise<DefaultEngineSelection[]>;
  setDefaultEngine(kind: DefaultEngineKind, targetId: string | null): Promise<void>;
}
