import { getDatabase } from '../../services/database/database';
import { getCrypto } from '../../services/ssh/CryptoService';
import { getCopilotToken } from './ai/CopilotAuthService';
import { parseStoredModels } from './ai/model-metadata';

/**
 * Work out how many tokens a provider/model pair can hold.
 *
 * There is no field for this in the OpenAI API, so every server puts it
 * somewhere different -- or, like a plain llama.cpp wrapper, nowhere at all.
 * We probe the shapes we know and otherwise fall back to a value the user set
 * by hand, because for a local server the limit lives in how it was launched
 * (`--ctx-size`), not in the model.
 *
 * Everything here reads real server metadata. Nothing is inferred from the
 * model's name: the same weights behind `-c 16384` and `-c 131072` are two
 * different windows, and a confident wrong number is worse than none.
 */

const OVERRIDE_PREFIX = 'contextWindow:';
const PROBE_TIMEOUT_MS = 4000;

export type ContextWindowSource =
  | 'manual'    // typed in by the user
  | 'props'     // llama.cpp /props
  | 'models'    // context field on /v1/models (OpenRouter, Groq, vLLM, LM Studio)
  | 'ollama'    // Ollama /api/show
  | 'gemini'    // Google generativelanguage inputTokenLimit
  | 'copilot'   // GitHub Copilot /models capability limits
  | 'unknown';

export interface ContextWindow {
  tokens: number | null;
  source: ContextWindowSource;
}

/** Field names different servers use for the context length in /v1/models. */
const MODEL_FIELDS = ['context_length', 'max_model_len', 'max_context_length', 'context_window', 'n_ctx'];

const cache = new Map<string, ContextWindow>();

function key(providerId: string, modelId: string): string {
  return `${providerId}::${modelId}`;
}

function overrideKey(providerId: string, modelId: string): string {
  return `${OVERRIDE_PREFIX}${providerId}::${modelId}`;
}

interface FetchOptions {
  headers?: Record<string, string>;
  method?: string;
  body?: any;
}

async function fetchJson(url: string, options: FetchOptions = {}): Promise<any | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: options.method || 'GET',
      headers: options.headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function positiveInt(value: any): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

/** Drop a trailing /v1 (or /v1beta/openai) to reach a server's native API root. */
function nativeRoot(endpoint: string): string {
  return endpoint.replace(/\/+$/, '').replace(/\/(v1beta\/openai|openai|v1)$/, '');
}

function hostOf(endpoint: string): string {
  try {
    return new URL(endpoint).hostname;
  } catch {
    return '';
  }
}

// ------------------------------------------------------------------- probes

/** llama.cpp serves /props next to /v1, so try both spellings. */
async function probeProps(endpoint: string, headers: Record<string, string>): Promise<number | null> {
  const base = endpoint.replace(/\/+$/, '');
  for (const url of [`${base}/props`, `${nativeRoot(base)}/props`]) {
    const props = await fetchJson(url, { headers });
    const n = positiveInt(props?.default_generation_settings?.n_ctx ?? props?.n_ctx);
    if (n) return n;
  }
  return null;
}

/**
 * Ollama keeps the window in its native API, not the OpenAI-compatible one.
 * `model_info` is keyed by architecture, e.g. `qwen3.context_length`.
 */
async function probeOllama(endpoint: string, headers: Record<string, string>, modelId: string): Promise<number | null> {
  const data = await fetchJson(`${nativeRoot(endpoint)}/api/show`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: { model: modelId },
  });
  const info = data?.model_info;
  if (!info || typeof info !== 'object') return null;

  const arch = data?.details?.family || info['general.architecture'];
  const preferred = arch ? positiveInt(info[`${arch}.context_length`]) : null;
  if (preferred) return preferred;

  for (const [k, v] of Object.entries(info)) {
    if (k.endsWith('.context_length')) {
      const n = positiveInt(v);
      if (n) return n;
    }
  }
  return null;
}

/** Google's native model resource reports inputTokenLimit; the OpenAI shim does not. */
async function probeGemini(endpoint: string, apiKey: string | null, modelId: string): Promise<number | null> {
  const root = nativeRoot(endpoint);
  const base = /\/v1beta$/.test(root) ? root : `${root}/v1beta`;
  const name = modelId.startsWith('models/') ? modelId : `models/${modelId}`;
  const data = await fetchJson(`${base}/${name}`, {
    headers: apiKey ? { 'x-goog-api-key': apiKey } : {},
  });
  return positiveInt(data?.inputTokenLimit);
}

/** Copilot advertises per-model limits, but only to an exchanged Copilot token. */
async function probeCopilot(apiKey: string | null, modelId: string): Promise<number | null> {
  if (!apiKey) return null;
  let token: string;
  try {
    token = await getCopilotToken(apiKey);
  } catch {
    return null;
  }

  const data = await fetchJson('https://api.githubcopilot.com/models', {
    headers: {
      Authorization: `Bearer ${token}`,
      'Copilot-Integration-Id': 'vscode-chat',
      'Editor-Version': 'vscode/1.107.0',
      'Editor-Plugin-Version': 'copilot-chat/0.35.0',
      'User-Agent': 'GitHubCopilotChat/0.35.0',
    },
  });
  const entry = (data?.data || []).find((m: any) => m?.id === modelId);
  return positiveInt(entry?.capabilities?.limits?.max_context_window_tokens);
}

/** OpenRouter, Groq, vLLM and LM Studio all carry it on the model listing. */
async function probeModelsList(endpoint: string, headers: Record<string, string>, modelId: string): Promise<number | null> {
  const models = await fetchJson(`${endpoint.replace(/\/+$/, '')}/models`, { headers });
  const list: any[] = models?.data || models?.models || [];
  const entry = list.find(m => m?.id === modelId) || list.find(m => m?.name === modelId);
  for (const field of MODEL_FIELDS) {
    const n = positiveInt(entry?.[field] ?? entry?.top_provider?.[field]);
    if (n) return n;
  }
  return null;
}

// -------------------------------------------------------------------- public

export function setOverride(providerId: string, modelId: string, tokens: number | null): void {
  const db = getDatabase();
  if (tokens && tokens > 0) {
    db.setSetting(overrideKey(providerId, modelId), String(Math.floor(tokens)));
  } else {
    db.getDb().prepare('DELETE FROM app_settings WHERE key = ?').run(overrideKey(providerId, modelId));
  }
  cache.delete(key(providerId, modelId));
}

export function invalidateProviderContextWindows(providerId: string): void {
  const prefix = `${providerId}::`;
  for (const cacheKey of cache.keys()) {
    if (cacheKey.startsWith(prefix)) cache.delete(cacheKey);
  }
}

export async function getContextWindow(providerId: string, modelId: string): Promise<ContextWindow> {
  if (!providerId || !modelId) return { tokens: null, source: 'unknown' };

  const manual = positiveInt(getDatabase().getSetting(overrideKey(providerId, modelId)));
  if (manual) return { tokens: manual, source: 'manual' };

  const cached = cache.get(key(providerId, modelId));
  if (cached) return cached;

  const provider = getDatabase().getDb()
    .prepare('SELECT * FROM ai_providers WHERE id = ?').get(providerId) as any;
  if (!provider) return { tokens: null, source: 'unknown' };

  const storedModel = parseStoredModels(provider.available_models || null)
    ?.find(model => model.id === modelId);
  if (storedModel?.contextWindow) {
    const result: ContextWindow = { tokens: storedModel.contextWindow, source: 'models' };
    cache.set(key(providerId, modelId), result);
    return result;
  }

  const endpoint = (provider.endpoint || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const host = hostOf(endpoint);

  let apiKey: string | null = null;
  if (provider.api_key_encrypted && getCrypto().isUnlocked()) {
    try {
      apiKey = getCrypto().decrypt(provider.api_key_encrypted);
    } catch {
      /* locked or corrupt; probe unauthenticated */
    }
  }

  const headers: Record<string, string> = {
    ...(provider.custom_headers ? JSON.parse(provider.custom_headers) : {}),
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  // Ordered cheapest/most specific first; each returns null when it does not apply.
  const probes: Array<[ContextWindowSource, () => Promise<number | null>]> = [];

  if (provider.type === 'copilot' || host === 'api.githubcopilot.com') {
    probes.push(['copilot', () => probeCopilot(apiKey, modelId)]);
  }
  if (host.includes('generativelanguage.googleapis.com')) {
    probes.push(['gemini', () => probeGemini(endpoint, apiKey, modelId)]);
  }
  probes.push(['props', () => probeProps(endpoint, headers)]);
  probes.push(['models', () => probeModelsList(endpoint, headers, modelId)]);
  // Last: it is a POST, and only Ollama answers it
  probes.push(['ollama', () => probeOllama(endpoint, headers, modelId)]);

  let result: ContextWindow = { tokens: null, source: 'unknown' };
  for (const [source, probe] of probes) {
    const tokens = await probe();
    if (tokens) {
      result = { tokens, source };
      break;
    }
  }

  cache.set(key(providerId, modelId), result);
  return result;
}
