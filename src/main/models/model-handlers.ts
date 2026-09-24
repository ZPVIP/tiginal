import { ipcMain } from 'electron';
import { getDatabase } from '../../services/database/database';
import type {
  DefaultEngineCandidate,
  DefaultEngineKind,
  DefaultEngineSelection,
  EngineParameters,
  MarketModel,
  ModelCapability,
  ModelEngineId,
  ModelFile,
  ModelFormat,
  StartModelInput,
} from '../../shared/models/types';
import { EngineDetector } from './EngineDetector';
import { ModelLibraryService } from './ModelLibraryService';
import { ModelRuntimeSupervisor } from './ModelRuntimeSupervisor';

interface ModelServices {
  detector: EngineDetector;
  library: ModelLibraryService;
  supervisor: ModelRuntimeSupervisor;
}

let services: ModelServices | null = null;

function modelServices(): ModelServices {
  if (services) return services;
  const db = getDatabase().getDb();
  let detector: EngineDetector;
  const supervisor = new ModelRuntimeSupervisor(db, async () => (await detector.list()).engines);
  detector = new EngineDetector(engineId => supervisor.runningCount(engineId));
  const library = new ModelLibraryService(db);
  services = { detector, library, supervisor };
  void library.scanDownloadedModels().catch(() => undefined);
  return services;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${key} is required`);
  return value.trim();
}

function modelEngineId(value: unknown): ModelEngineId {
  if (value === 'llama.cpp' || value === 'whisper.cpp' || value === 'vllm'
    || value === 'mlx-lm' || value === 'mlx-audio' || value === 'r2t2-runtime') return value;
  throw new Error('Unsupported model engine');
}

function defaultEngineKind(value: unknown): DefaultEngineKind {
  if (value === 'language-model' || value === 'speech-recognition' || value === 'speech-synthesis') {
    return value;
  }
  throw new Error('Unsupported default engine kind');
}

function modelFormat(value: unknown): ModelFormat | undefined {
  if (value === 'gguf' || value === 'safetensors' || value === 'mlx' || value === 'other') return value;
  return undefined;
}

function modelCapability(value: unknown): ModelCapability | undefined {
  if (value === 'text-generation' || value === 'translation' || value === 'speech-recognition'
    || value === 'speech-synthesis' || value === 'microphone-stream' || value === 'file-stream'
    || value === 'file-batch' || value === 'simultaneous-translation') return value;
  return undefined;
}

function parseEngineParameters(value: unknown): EngineParameters {
  if (!isRecord(value)) throw new Error('Model engine parameters must be an object');
  const parameters: EngineParameters = {};
  for (const [key, candidate] of Object.entries(value)) {
    if (typeof candidate === 'string' || typeof candidate === 'boolean' || candidate === null) {
      parameters[key] = candidate;
    } else if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      parameters[key] = candidate;
    } else {
      throw new Error(`Invalid model engine parameter: ${key}`);
    }
  }
  return parameters;
}

function parseStartModelInput(value: unknown): StartModelInput {
  if (!isRecord(value)) throw new Error('Start model input must be an object');
  return {
    engineId: modelEngineId(value.engineId),
    modelPath: requiredString(value, 'modelPath'),
    displayName: requiredString(value, 'displayName'),
    parameters: parseEngineParameters(value.parameters),
  };
}

function parseMarketModel(value: unknown): MarketModel {
  if (!isRecord(value)) throw new Error('Market model must be an object');
  const source = value.source;
  if (source !== 'huggingface' && source !== 'modelscope') throw new Error('Unsupported model source');
  const revision = requiredString(value, 'revision');
  const repoId = requiredString(value, 'repoId');
  const formats = Array.isArray(value.formats)
    ? value.formats.flatMap(item => {
        const parsed = modelFormat(item);
        return parsed ? [parsed] : [];
      })
    : [];
  const capabilities = Array.isArray(value.capabilities)
    ? value.capabilities.flatMap(item => {
        const parsed = modelCapability(item);
        return parsed ? [parsed] : [];
      })
    : [];
  return {
    id: `${source}:${repoId}:${revision}`,
    name: requiredString(value, 'name'),
    author: typeof value.author === 'string' ? value.author : null,
    source,
    repoId,
    revision,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : null,
    downloads: typeof value.downloads === 'number' ? value.downloads : null,
    likes: typeof value.likes === 'number' ? value.likes : null,
    license: typeof value.license === 'string' ? value.license : null,
    formats,
    capabilities,
    favorite: value.favorite === true,
    featured: value.featured === true,
    sourceUrl: requiredString(value, 'sourceUrl'),
  };
}

function parseModelFile(value: unknown): ModelFile {
  if (!isRecord(value)) throw new Error('Model file must be an object');
  const sizeBytes = value.sizeBytes;
  if (sizeBytes !== null && (typeof sizeBytes !== 'number' || !Number.isFinite(sizeBytes) || sizeBytes < 0)) {
    throw new Error('Model file size must be a non-negative number or null');
  }
  return {
    path: requiredString(value, 'path'),
    sizeBytes,
  };
}

function settingKey(kind: DefaultEngineKind): string {
  if (kind === 'language-model') return 'default_language_model_target';
  if (kind === 'speech-recognition') return 'default_speech_recognition_target';
  return 'default_speech_synthesis_target';
}

function remoteLanguageCandidates(): DefaultEngineCandidate[] {
  const rows: unknown[] = getDatabase().getDb().prepare(`
    SELECT id, name, model FROM ai_providers ORDER BY name COLLATE NOCASE
  `).all();
  return rows.flatMap(row => {
    if (!isRecord(row) || typeof row.id !== 'string' || typeof row.name !== 'string') return [];
    const model = typeof row.model === 'string' ? row.model : '';
    const candidate: DefaultEngineCandidate = {
      id: `remote-ai:${row.id}:${model}`,
      label: model ? `${row.name} / ${model}` : row.name,
      description: 'Remote language model provider',
      source: 'remote',
      capabilities: ['text-generation'],
    };
    return [candidate];
  });
}

function defaultRemoteLanguageTarget(): string | null {
  const row: unknown = getDatabase().getDb().prepare(`
    SELECT id, model FROM ai_providers WHERE is_default = 1 LIMIT 1
  `).get();
  if (!isRecord(row) || typeof row.id !== 'string') return null;
  const model = typeof row.model === 'string' ? row.model : '';
  return `remote-ai:${row.id}:${model}`;
}

function remoteSpeechCandidates(): DefaultEngineCandidate[] {
  const rows: unknown[] = getDatabase().getDb().prepare(`
    SELECT id, name, protocol FROM speech_providers WHERE enabled = 1 ORDER BY name COLLATE NOCASE
  `).all();
  return rows.flatMap(row => {
    if (!isRecord(row) || typeof row.id !== 'string' || typeof row.name !== 'string') return [];
    const candidate: DefaultEngineCandidate = {
      id: `remote-speech:${row.id}`,
      label: row.name,
      description: typeof row.protocol === 'string' ? row.protocol : 'Remote speech provider',
      source: 'remote',
      capabilities: ['speech-recognition', 'microphone-stream'],
    };
    return [candidate];
  });
}

function localCandidates(requiredCapability: ModelCapability): DefaultEngineCandidate[] {
  const current = modelServices();
  const downloadedByPath = new Map(current.library.listDownloadedModels().map(model => [model.path, model]));
  return current.supervisor.list().flatMap(instance => {
    if (instance.status !== 'running') return [];
    const model = downloadedByPath.get(instance.modelPath);
    if (!model || !model.capabilities.includes(requiredCapability)) return [];
    const candidate: DefaultEngineCandidate = {
      id: `local-model:${instance.id}`,
      label: instance.displayName,
      description: `${instance.engineId} / ${model.name}`,
      source: 'local',
      capabilities: model.capabilities,
    };
    return [candidate];
  });
}

function defaultEngineSelections(): DefaultEngineSelection[] {
  const languageCandidates = [...remoteLanguageCandidates(), ...localCandidates('text-generation')];
  const speechCandidates = [...remoteSpeechCandidates(), ...localCandidates('speech-recognition')];
  const synthesisCandidates = localCandidates('speech-synthesis');
  const storedLanguageTarget = getDatabase().getSetting(settingKey('language-model'));
  const languageTarget = storedLanguageTarget?.startsWith('local-model:')
    ? storedLanguageTarget
    : defaultRemoteLanguageTarget();
  return [
    {
      kind: 'language-model',
      targetId: languageTarget,
      candidates: languageCandidates,
    },
    {
      kind: 'speech-recognition',
      targetId: getDatabase().getSetting(settingKey('speech-recognition')),
      candidates: speechCandidates,
    },
    {
      kind: 'speech-synthesis',
      targetId: getDatabase().getSetting(settingKey('speech-synthesis')),
      candidates: synthesisCandidates,
    },
  ];
}

export function getModelRuntimeSupervisor(): ModelRuntimeSupervisor {
  return modelServices().supervisor;
}

export function disposeModelServicesNow(): void {
  if (!services) return;
  services.library.dispose();
  services.supervisor.disposeAllNow();
}

export function setupModelHandlers(): void {
  ipcMain.handle('models:list-engines', async () => modelServices().detector.list());
  ipcMain.handle('models:refresh-engines', async () => modelServices().detector.list(true));
  ipcMain.handle('models:list-directories', () => modelServices().library.listDirectories());
  ipcMain.handle('models:get-home-directory', () => modelServices().library.homeDirectory());
  ipcMain.handle('models:add-directory', (_event, value: unknown) => (
    modelServices().library.addDirectory(requiredString({ path: value }, 'path'))
  ));
  ipcMain.handle('models:remove-directory', (_event, value: unknown) => (
    modelServices().library.removeDirectory(requiredString({ path: value }, 'path'))
  ));
  ipcMain.handle('models:scan-downloaded', () => modelServices().library.scanDownloadedModels());
  ipcMain.handle('models:list-downloaded', () => modelServices().library.listDownloadedModels());
  ipcMain.handle('models:rename-downloaded', (_event, value: unknown) => {
    if (!isRecord(value)) throw new Error('Rename downloaded model input must be an object');
    return modelServices().library.renameDownloadedModel(
      requiredString(value, 'id'),
      requiredString(value, 'name'),
    );
  });
  ipcMain.handle('models:delete-downloaded', (_event, value: unknown) => (
    modelServices().library.deleteDownloadedModel(
      requiredString({ id: value }, 'id'),
      modelServices().supervisor.list()
        .filter(instance => instance.status === 'running' || instance.status === 'starting' || instance.status === 'stopping')
        .map(instance => instance.modelPath),
    )
  ));
  ipcMain.handle('models:search-market', (_event, value: unknown) => {
    if (!isRecord(value)) throw new Error('Model market query must be an object');
    const source = value.source === 'modelscope' ? 'modelscope' : 'huggingface';
    const capability = modelCapability(value.capability);
    const format = modelFormat(value.format);
    return modelServices().library.searchMarket({
      source,
      search: typeof value.search === 'string' ? value.search : '',
      ...(capability ? { capability } : {}),
      ...(format ? { format } : {}),
      sort: value.sort === 'updated' ? 'updated' : 'downloads',
    });
  });
  ipcMain.handle('models:get-market-details', (_event, value: unknown) => (
    modelServices().library.getDetails(parseMarketModel(value))
  ));
  ipcMain.handle('models:set-favorite', (_event, value: unknown) => {
    if (!isRecord(value)) throw new Error('Favorite input must be an object');
    modelServices().library.setFavorite(parseMarketModel(value.model), value.favorite === true);
  });
  ipcMain.handle('models:list-favorites', () => modelServices().library.listFavorites());
  ipcMain.handle('models:start-download', (_event, value: unknown) => {
    if (!isRecord(value)) throw new Error('Model download request must be an object');
    return modelServices().library.startDownload({
      model: parseMarketModel(value.model),
      file: parseModelFile(value.file),
    });
  });
  ipcMain.handle('models:cancel-download', (_event, value: unknown) => (
    modelServices().library.cancelDownload(requiredString({ id: value }, 'id'))
  ));
  ipcMain.handle('models:list-downloads', () => modelServices().library.listDownloads());
  ipcMain.handle('models:list-instances', () => modelServices().supervisor.list());
  ipcMain.handle('models:start', (_event, value: unknown) => (
    modelServices().supervisor.start(parseStartModelInput(value))
  ));
  ipcMain.handle('models:restart', (_event, value: unknown) => {
    if (!isRecord(value)) throw new Error('Restart model input must be an object');
    return modelServices().supervisor.restart(
      requiredString(value, 'id'),
      parseStartModelInput(value.input),
    );
  });
  ipcMain.handle('models:stop', (_event, value: unknown) => (
    modelServices().supervisor.stop(requiredString({ id: value }, 'id'))
  ));
  ipcMain.handle('models:delete-service', (_event, value: unknown) => {
    modelServices().supervisor.delete(requiredString({ id: value }, 'id'));
  });
  ipcMain.handle('models:logs', (_event, value: unknown) => (
    modelServices().supervisor.logs(requiredString({ id: value }, 'id'))
  ));
  ipcMain.handle('models:list-defaults', () => defaultEngineSelections());
  ipcMain.handle('models:set-default', (_event, value: unknown) => {
    if (!isRecord(value)) throw new Error('Default engine input must be an object');
    const kind = defaultEngineKind(value.kind);
    const targetId = typeof value.targetId === 'string' && value.targetId ? value.targetId : null;
    if (kind === 'language-model' && (!targetId || targetId.startsWith('remote-ai:'))) {
      const db = getDatabase().getDb();
      const providers: unknown[] = db.prepare(`SELECT id, model FROM ai_providers`).all();
      const selected = targetId
        ? providers.find(row => (
            isRecord(row)
            && typeof row.id === 'string'
            && `remote-ai:${row.id}:${typeof row.model === 'string' ? row.model : ''}` === targetId
          ))
        : undefined;
      if (targetId && (!isRecord(selected) || typeof selected.id !== 'string')) {
        throw new Error('Default language model provider was not found');
      }
      const updateDefault = db.transaction(() => {
        db.prepare(`UPDATE ai_providers SET is_default = 0`).run();
        if (isRecord(selected) && typeof selected.id === 'string') {
          db.prepare(`UPDATE ai_providers SET is_default = 1, updated_at = ? WHERE id = ?`)
            .run(Date.now(), selected.id);
        }
      });
      updateDefault();
    }
    getDatabase().setSetting(settingKey(kind), targetId ?? '');
  });
}
