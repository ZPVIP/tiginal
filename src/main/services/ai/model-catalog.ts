import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { app } from 'electron';
import type {
  CatalogNpmPackage,
  CatalogProvider,
  ModelCatalogUpdateResult,
  ModelConfig,
} from '../../../shared/ai-provider';
import {
  apiFormatForCatalogPackage,
  isCatalogNpmPackage,
} from '../../../shared/ai-provider';
import { getDatabase } from '../../../services/database/database';
import { parseModelListPayload } from './model-metadata';

export const MODEL_CATALOG_URL = 'https://models.dev/api.json';
export const MODEL_CATALOG_FILENAME = 'api.json';
export const GLOBAL_MODEL_CATALOG_URL = 'https://models.dev/models.json';
export const GLOBAL_MODEL_CATALOG_FILENAME = 'models.json';
export const PROVIDER_CATALOG_FILENAME = 'providers.json';
export const PROVIDER_MODELS_DIRECTORY = 'models';

const OPENAI_COMPATIBLE: CatalogNpmPackage = '@ai-sdk/openai-compatible';

export const BUILTIN_PROVIDER_PRESETS = [
  {
    id: 'google',
    name: 'Google AI',
    api: 'https://generativelanguage.googleapis.com/v1beta/openai',
    npm: OPENAI_COMPATIBLE,
  },
  {
    id: 'llamafile',
    name: 'Llamafile',
    api: 'http://127.0.0.1:8080/v1',
    npm: OPENAI_COMPATIBLE,
  },
  {
    id: 'llamacpp',
    name: 'LLaMa.cpp',
    api: 'http://127.0.0.1:8080/v1',
    npm: OPENAI_COMPATIBLE,
  },
  {
    id: 'lmstudio',
    name: 'LM Studio',
    api: 'http://127.0.0.1:1234/v1',
    npm: OPENAI_COMPATIBLE,
  },
  {
    id: 'ollama-local',
    name: 'Ollama (Local)',
    api: 'http://127.0.0.1:11434/v1',
    npm: OPENAI_COMPATIBLE,
  },
] satisfies readonly CatalogProvider[];

export const SPECIAL_PROVIDER_PRESETS = [
  {
    id: 'openai',
    name: 'OpenAI',
    api: 'https://api.openai.com/v1',
    npm: OPENAI_COMPATIBLE,
  },
  {
    id: 'aihubmix',
    name: 'AIHubMix',
    api: 'https://aihubmix.com/v1',
    npm: OPENAI_COMPATIBLE,
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    api: 'https://api.anthropic.com/v1',
    npm: '@ai-sdk/anthropic',
  },
  {
    id: 'cerebras',
    name: 'Cerebras',
    api: 'https://api.cerebras.ai/v1',
    npm: OPENAI_COMPATIBLE,
  },
  {
    id: 'groq',
    name: 'Groq',
    api: 'https://api.groq.com/openai/v1',
    npm: OPENAI_COMPATIBLE,
  },
  {
    id: 'mistral',
    name: 'Mistral',
    api: 'https://api.mistral.ai/v1',
    npm: OPENAI_COMPATIBLE,
  },
  {
    id: 'xai',
    name: 'xAI',
    api: 'https://api.x.ai/v1',
    npm: OPENAI_COMPATIBLE,
  },
] satisfies readonly CatalogProvider[];

const specialProvidersById = new Map(
  SPECIAL_PROVIDER_PRESETS.map(provider => [provider.id, provider]),
);

type ProviderModels = Record<string, unknown>;

export interface ParsedModelsDevCatalog {
  providers: CatalogProvider[];
  modelsByProvider: Record<string, ProviderModels>;
}

interface ProviderCatalogCache {
  filePath: string;
  modifiedAt: number;
  providers: CatalogProvider[];
}

interface ModelCatalogCache {
  filePath: string;
  modifiedAt: number;
  models: ProviderModels;
}

let providerCatalogCache: ProviderCatalogCache | undefined;
const modelCatalogCache = new Map<string, ModelCatalogCache>();
let globalModelCatalogCache: ModelCatalogCache | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function isSafeProviderId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);
}

function isCatalogApi(value: unknown): value is string {
  return typeof value === 'string' && (
    value.startsWith('https://') || value.startsWith('http://127.0.0.1')
  );
}

function isModelsDevApi(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('https://');
}

function compareProviders(left: CatalogProvider, right: CatalogProvider): number {
  return left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
}

function parseProvider(value: unknown): { provider: CatalogProvider; models: ProviderModels } | null {
  if (!isRecord(value)) return null;

  const id = value.id;
  if (!isSafeProviderId(id)) return null;
  const specialProvider = specialProvidersById.get(id);
  if (specialProvider) {
    return {
      provider: specialProvider,
      models: isRecord(value.models) ? value.models : {},
    };
  }

  const name = nonEmptyString(value.name);
  const api = value.api;
  const npm = value.npm;
  if (!name || !isModelsDevApi(api) || !isCatalogNpmPackage(npm)) {
    return null;
  }

  return {
    provider: { id, name, api, npm },
    models: isRecord(value.models) ? value.models : {},
  };
}

export function parseModelsDevCatalog(payload: unknown): ParsedModelsDevCatalog {
  if (!isRecord(payload)) throw new Error('models.dev catalog must be a JSON object');

  const providersById = new Map<string, CatalogProvider>();
  const modelEntries: Array<[string, ProviderModels]> = [];
  for (const value of Object.values(payload)) {
    const parsed = parseProvider(value);
    if (!parsed) continue;
    providersById.set(parsed.provider.id, parsed.provider);
    modelEntries.push([parsed.provider.id, parsed.models]);
  }

  return {
    providers: [...providersById.values()].sort(compareProviders),
    modelsByProvider: Object.fromEntries(modelEntries),
  };
}

export function catalogProviders(dynamicProviders: readonly CatalogProvider[]): CatalogProvider[] {
  const providersById = new Map(dynamicProviders.map(provider => [provider.id, provider]));
  for (const provider of SPECIAL_PROVIDER_PRESETS) providersById.set(provider.id, provider);
  for (const provider of BUILTIN_PROVIDER_PRESETS) providersById.set(provider.id, provider);
  return [...providersById.values()].sort(compareProviders);
}

function parseProviderCatalog(payload: unknown): CatalogProvider[] {
  if (!Array.isArray(payload)) throw new Error('Provider catalog must be a JSON array');

  const providers = payload.flatMap(value => {
    if (!isRecord(value)) return [];
    const id = value.id;
    const name = nonEmptyString(value.name);
    const api = value.api;
    const npm = value.npm;
    if (!isSafeProviderId(id) || !name || !isCatalogApi(api) || !isCatalogNpmPackage(npm)) return [];
    return [{ id, name, api, npm }];
  });
  if (providers.length === 0) throw new Error('Provider catalog contains no valid providers');
  return catalogProviders(providers);
}

export function catalogDataDirectory(): string {
  return path.dirname(getDatabase().getDbPath());
}

export function providerCatalogPath(dataDirectory: string = catalogDataDirectory()): string {
  return path.join(dataDirectory, PROVIDER_CATALOG_FILENAME);
}

export function modelCatalogPath(
  providerId: string,
  dataDirectory: string = catalogDataDirectory(),
): string {
  if (!isSafeProviderId(providerId)) throw new Error('Invalid catalog provider id');
  return path.join(dataDirectory, PROVIDER_MODELS_DIRECTORY, providerId + '.json');
}

export function loadProviderCatalog(dataDirectory: string = catalogDataDirectory()): CatalogProvider[] {
  const filePath = providerCatalogPath(dataDirectory);
  try {
    const modifiedAt = fs.statSync(filePath).mtimeMs;
    if (providerCatalogCache?.filePath === filePath && providerCatalogCache.modifiedAt === modifiedAt) {
      return providerCatalogCache.providers;
    }
    const payload: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const providers = parseProviderCatalog(payload);
    providerCatalogCache = { filePath, modifiedAt, providers };
    return providers;
  } catch (error) {
    console.error('[ModelCatalog] Could not load providers.json:', error);
    return catalogProviders([]);
  }
}

export function loadModelCatalog(
  providerId: string | undefined,
  dataDirectory: string = catalogDataDirectory(),
): ProviderModels {
  if (!providerId) return {};

  try {
    const filePath = modelCatalogPath(providerId, dataDirectory);
    if (!fs.existsSync(filePath)) return {};
    const modifiedAt = fs.statSync(filePath).mtimeMs;
    const cached = modelCatalogCache.get(providerId);
    if (cached?.filePath === filePath && cached.modifiedAt === modifiedAt) return cached.models;

    const payload: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!isRecord(payload)) throw new Error('Provider model catalog must be a JSON object');
    modelCatalogCache.set(providerId, { filePath, modifiedAt, models: payload });
    return payload;
  } catch (error) {
    console.error('[ModelCatalog] Could not load model metadata for ' + providerId + ':', error);
    return {};
  }
}

export function loadGlobalModelCatalog(
  dataDirectory: string = catalogDataDirectory(),
): ProviderModels {
  const filePath = path.join(dataDirectory, GLOBAL_MODEL_CATALOG_FILENAME);
  try {
    if (!fs.existsSync(filePath)) return {};
    const modifiedAt = fs.statSync(filePath).mtimeMs;
    if (
      globalModelCatalogCache?.filePath === filePath
      && globalModelCatalogCache.modifiedAt === modifiedAt
    ) {
      return globalModelCatalogCache.models;
    }

    const payload: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!isRecord(payload)) throw new Error('Global model catalog must be a JSON object');
    globalModelCatalogCache = { filePath, modifiedAt, models: payload };
    return payload;
  } catch (error) {
    console.error('[ModelCatalog] Could not load models.json:', error);
    return {};
  }
}

function compactValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    const items = value.map(compactValue).filter((item): item is string => item !== undefined);
    return items.length > 0 ? items.slice(0, 6).join(', ') : undefined;
  }
  if (isRecord(value)) {
    const items = Object.entries(value).flatMap(([key, item]) => {
      const compact = compactValue(item);
      return compact ? [key + ': ' + compact] : [];
    });
    return items.length > 0 ? items.slice(0, 6).join(', ') : undefined;
  }
  return undefined;
}

function catalogDetails(value: unknown): string[] {
  if (!isRecord(value)) return [];
  const details: string[] = [];
  const fields: Array<[string, string]> = [
    ['description', 'Description'],
    ['family', 'Family'],
    ['release_date', 'Released'],
    ['last_updated', 'Updated'],
    ['open_weights', 'Open weights'],
    ['cost', 'Cost'],
  ];
  for (const [key, label] of fields) {
    const detail = compactValue(value[key]);
    if (detail) details.push(label + ': ' + detail);
  }
  return details;
}

export function enrichModelsWithCatalog(
  models: readonly ModelConfig[],
  catalogModels: ProviderModels,
): ModelConfig[] {
  return models.map(model => {
    const rawMetadata = catalogModels[model.id];
    return enrichModelWithMetadata(model, rawMetadata);
  });
}

function enrichModelWithMetadata(model: ModelConfig, rawMetadata: unknown): ModelConfig {
  if (!isRecord(rawMetadata)) return model;

  const catalog = parseModelListPayload([rawMetadata])[0];
  if (!catalog) return model;

  return {
    ...catalog,
    ...model,
    contextWindow: model.contextWindow ?? catalog.contextWindow,
    maxOutputTokens: model.maxOutputTokens ?? catalog.maxOutputTokens,
    supportsImages: model.supportsImages || catalog.supportsImages || undefined,
    supportsPdf: model.supportsPdf || catalog.supportsPdf || undefined,
    supportsAudio: model.supportsAudio || catalog.supportsAudio || undefined,
    supportsVideo: model.supportsVideo || catalog.supportsVideo || undefined,
    supportsReasoning: model.supportsReasoning || catalog.supportsReasoning || undefined,
    supportsToolCalls: model.supportsToolCalls || catalog.supportsToolCalls || undefined,
    supportsStructuredOutput: model.supportsStructuredOutput || catalog.supportsStructuredOutput || undefined,
    catalogDetails: catalogDetails(rawMetadata),
  };
}

export function enrichModelsFromLocalCatalog(
  models: readonly ModelConfig[],
  preferredProviderId?: string,
  dataDirectory: string = catalogDataDirectory(),
): ModelConfig[] {
  const preferredModels = loadModelCatalog(preferredProviderId, dataDirectory);
  const globalModels = loadGlobalModelCatalog(dataDirectory);
  const prefixedCatalogs = new Map<string, ProviderModels>();

  return models.map(model => {
    const preferredMetadata = preferredModels[model.id];
    if (isRecord(preferredMetadata)) return enrichModelWithMetadata(model, preferredMetadata);

    const separator = model.id.indexOf('/');
    if (separator > 0 && separator < model.id.length - 1) {
      const providerId = model.id.slice(0, separator);
      const providerModelId = model.id.slice(separator + 1);
      if (isSafeProviderId(providerId)) {
        let providerModels = prefixedCatalogs.get(providerId);
        if (!providerModels) {
          providerModels = loadModelCatalog(providerId, dataDirectory);
          prefixedCatalogs.set(providerId, providerModels);
        }
        const providerMetadata = providerModels[model.id] ?? providerModels[providerModelId];
        if (isRecord(providerMetadata)) return enrichModelWithMetadata(model, providerMetadata);
      }
    }

    const globalMetadata = globalModels[model.id]
      ?? (preferredProviderId ? globalModels[preferredProviderId + '/' + model.id] : undefined);
    return enrichModelWithMetadata(model, globalMetadata);
  });
}

async function validateJsonFile(filePath: string): Promise<void> {
  JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function installStagedCatalog(stageDirectory: string, dataDirectory: string): Promise<void> {
  const backupDirectory = path.join(
    dataDirectory,
    '.model-catalog-backup-' + process.pid + '-' + randomUUID(),
  );
  await fs.promises.mkdir(backupDirectory, { recursive: true });

  const names = [
    MODEL_CATALOG_FILENAME,
    GLOBAL_MODEL_CATALOG_FILENAME,
    PROVIDER_MODELS_DIRECTORY,
    PROVIDER_CATALOG_FILENAME,
  ];
  const backedUp: string[] = [];
  const installed: string[] = [];

  try {
    for (const name of names) {
      const target = path.join(dataDirectory, name);
      if (!await pathExists(target)) continue;
      await fs.promises.rename(target, path.join(backupDirectory, name));
      backedUp.push(name);
    }

    for (const name of names) {
      await fs.promises.rename(path.join(stageDirectory, name), path.join(dataDirectory, name));
      installed.push(name);
    }
  } catch (error) {
    for (const name of installed.reverse()) {
      await fs.promises.rm(path.join(dataDirectory, name), { recursive: true, force: true });
    }
    for (const name of backedUp) {
      const backup = path.join(backupDirectory, name);
      if (await pathExists(backup)) {
        await fs.promises.rename(backup, path.join(dataDirectory, name));
      }
    }
    throw error;
  } finally {
    await fs.promises.rm(stageDirectory, { recursive: true, force: true });
    await fs.promises.rm(backupDirectory, { recursive: true, force: true });
  }
}

interface RebuildCatalogSources {
  apiSource: string;
  globalModelsSource: string;
  dataDirectory?: string;
}

function modelsForProvider(
  providerId: string,
  providerModels: ProviderModels | undefined,
  globalModels: ProviderModels,
): ProviderModels {
  const prefix = providerId + '/';
  const globalProviderModels: ProviderModels = {};
  for (const [modelId, metadata] of Object.entries(globalModels)) {
    if (modelId.startsWith(prefix) && modelId.length > prefix.length) {
      globalProviderModels[modelId.slice(prefix.length)] = metadata;
    }
  }
  return {
    ...globalProviderModels,
    ...providerModels,
  };
}

export async function rebuildCatalogFromSource({
  apiSource,
  globalModelsSource,
  dataDirectory = catalogDataDirectory(),
}: RebuildCatalogSources): Promise<ModelCatalogUpdateResult & { success: true }> {
  const payload: unknown = JSON.parse(apiSource);
  const parsed = parseModelsDevCatalog(payload);
  if (parsed.providers.length === 0) throw new Error('models.dev catalog contains no supported providers');
  const globalModelsPayload: unknown = JSON.parse(globalModelsSource);
  if (!isRecord(globalModelsPayload)) {
    throw new Error('models.dev global model catalog must be a JSON object');
  }

  const providers = catalogProviders(parsed.providers);
  const stageDirectory = path.join(
    dataDirectory,
    '.model-catalog-stage-' + process.pid + '-' + randomUUID(),
  );
  const stageModelsDirectory = path.join(stageDirectory, PROVIDER_MODELS_DIRECTORY);

  await fs.promises.mkdir(stageModelsDirectory, { recursive: true });
  try {
    await fs.promises.writeFile(
      path.join(stageDirectory, MODEL_CATALOG_FILENAME),
      apiSource,
      'utf8',
    );
    await fs.promises.writeFile(
      path.join(stageDirectory, GLOBAL_MODEL_CATALOG_FILENAME),
      globalModelsSource,
      'utf8',
    );
    await fs.promises.writeFile(
      path.join(stageDirectory, PROVIDER_CATALOG_FILENAME),
      JSON.stringify(providers, null, 2) + '\n',
      'utf8',
    );

    for (const provider of providers) {
      const models = modelsForProvider(
        provider.id,
        parsed.modelsByProvider[provider.id],
        globalModelsPayload,
      );
      await fs.promises.writeFile(
        path.join(stageModelsDirectory, provider.id + '.json'),
        JSON.stringify(models, null, 2) + '\n',
        'utf8',
      );
    }

    await validateJsonFile(path.join(stageDirectory, MODEL_CATALOG_FILENAME));
    await validateJsonFile(path.join(stageDirectory, GLOBAL_MODEL_CATALOG_FILENAME));
    await validateJsonFile(path.join(stageDirectory, PROVIDER_CATALOG_FILENAME));
    for (const provider of providers) {
      await validateJsonFile(path.join(stageModelsDirectory, provider.id + '.json'));
    }

    await fs.promises.mkdir(dataDirectory, { recursive: true });
    await installStagedCatalog(stageDirectory, dataDirectory);
  } catch (error) {
    await fs.promises.rm(stageDirectory, { recursive: true, force: true });
    throw error;
  }

  providerCatalogCache = undefined;
  modelCatalogCache.clear();
  globalModelCatalogCache = undefined;
  const modelCount = Object.values(parsed.modelsByProvider)
    .reduce((count, models) => count + Object.keys(models).length, 0);
  return {
    success: true,
    modelCount,
    providerCount: providers.length,
    updatedAt: Date.now(),
  };
}

async function downloadCatalog(url: string, filename: string): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(filename + ' server returned ' + response.status);
    return await response.text();
  } finally {
    clearTimeout(timeoutId);
  }
}

function packagedCatalogPath(filename: string): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'model-catalog', filename);
  }
  return path.join(app.getAppPath(), 'resources', 'model-catalog', filename);
}

async function readCatalogSource(candidates: readonly string[]): Promise<string | undefined> {
  for (const candidate of [...new Set(candidates)]) {
    if (!await pathExists(candidate)) continue;
    try {
      const source = await fs.promises.readFile(candidate, 'utf8');
      const payload: unknown = JSON.parse(source);
      if (!isRecord(payload)) throw new Error('Catalog must be a JSON object');
      return source;
    } catch (error) {
      console.error('[ModelCatalog] Could not read ' + candidate + ':', error);
    }
  }
  return undefined;
}

export async function ensureModelCatalogInitialized(): Promise<ModelCatalogUpdateResult> {
  const dataDirectory = catalogDataDirectory();
  const localGlobalModelsPath = path.join(dataDirectory, GLOBAL_MODEL_CATALOG_FILENAME);
  const hasSpecialProviderModels = (
    await Promise.all(SPECIAL_PROVIDER_PRESETS.map(provider => (
      pathExists(modelCatalogPath(provider.id, dataDirectory))
    )))
  ).every(Boolean);
  if (
    await pathExists(providerCatalogPath(dataDirectory))
    && await pathExists(localGlobalModelsPath)
    && hasSpecialProviderModels
  ) {
    return { success: true };
  }

  const localApiPath = path.join(dataDirectory, MODEL_CATALOG_FILENAME);
  const apiSource = await readCatalogSource([
    localApiPath,
    packagedCatalogPath(MODEL_CATALOG_FILENAME),
  ]);
  const globalModelsSource = await readCatalogSource([
    localGlobalModelsPath,
    packagedCatalogPath(GLOBAL_MODEL_CATALOG_FILENAME),
  ]);

  try {
    return await rebuildCatalogFromSource({
      apiSource: apiSource ?? await downloadCatalog(MODEL_CATALOG_URL, MODEL_CATALOG_FILENAME),
      globalModelsSource: globalModelsSource ?? await downloadCatalog(
        GLOBAL_MODEL_CATALOG_URL,
        GLOBAL_MODEL_CATALOG_FILENAME,
      ),
      dataDirectory,
    });
  } catch (error) {
    console.error('[ModelCatalog] Initial catalog generation failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Could not initialize model catalog',
    };
  }
}

export async function updateModelCatalog(): Promise<ModelCatalogUpdateResult> {
  try {
    const [apiSource, globalModelsSource] = await Promise.all([
      downloadCatalog(MODEL_CATALOG_URL, MODEL_CATALOG_FILENAME),
      downloadCatalog(GLOBAL_MODEL_CATALOG_URL, GLOBAL_MODEL_CATALOG_FILENAME),
    ]);
    return await rebuildCatalogFromSource({ apiSource, globalModelsSource });
  } catch (error) {
    console.error('[ModelCatalog] Catalog update failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Could not update model catalog',
    };
  }
}

export function apiFormatForCatalogProvider(provider: CatalogProvider) {
  return apiFormatForCatalogPackage(provider.npm);
}
