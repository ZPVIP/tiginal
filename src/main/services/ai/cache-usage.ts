import type { CacheStatus } from '../../../shared/token-tooltips';

export interface NormalizedUsage {
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  cacheStatus: CacheStatus;
}

interface AnthropicRequestOptions {
  model: string;
  messages: any[];
  tools?: Array<{ name: string; description: string; input_schema: object }>;
  maxTokens?: number;
  temperature?: number;
}

type ToolDefinition = { name: string; description: string; input_schema: object };

const hasOwn = (value: unknown, key: string): boolean => (
  typeof value === 'object' && value !== null && Object.prototype.hasOwnProperty.call(value, key)
);

const numberOrZero = (value: unknown): number => (
  typeof value === 'number' && Number.isFinite(value) ? value : 0
);

const compareStrings = (left: string, right: string): number => (
  left < right ? -1 : left > right ? 1 : 0
);

function canonicalizeJson<T>(value: T): T {
  if (Array.isArray(value)) return value.map(item => canonicalizeJson(item)) as T;
  if (typeof value !== 'object' || value === null) return value;

  const sorted = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => compareStrings(left, right))
    .reduce<Record<string, unknown>>((result, [key, item]) => {
      result[key] = canonicalizeJson(item);
      return result;
    }, {});
  return sorted as T;
}

export function canonicalizeToolDefinitions(tools: ToolDefinition[]): ToolDefinition[] {
  return [...tools]
    .sort((left, right) => compareStrings(left.name, right.name))
    .map(tool => ({ ...tool, input_schema: canonicalizeJson(tool.input_schema) }));
}

export function normalizeOpenAIUsage(usage: any): NormalizedUsage {
  const promptTokens = numberOrZero(usage?.prompt_tokens);
  const completionTokens = numberOrZero(usage?.completion_tokens);
  const cachedTokens = numberOrZero(usage?.prompt_tokens_details?.cached_tokens);
  const cacheTelemetryAvailable = hasOwn(usage?.prompt_tokens_details, 'cached_tokens');

  return {
    promptTokens,
    completionTokens,
    reasoningTokens: numberOrZero(usage?.completion_tokens_details?.reasoning_tokens),
    cachedTokens,
    cacheWriteTokens: 0,
    totalTokens: numberOrZero(usage?.total_tokens) || promptTokens + completionTokens,
    cacheStatus: cacheTelemetryAvailable ? (cachedTokens > 0 ? 'hit' : 'miss') : 'unknown',
  };
}

export function normalizeAnthropicUsage(usage: any): NormalizedUsage {
  const uncachedInputTokens = numberOrZero(usage?.input_tokens);
  const cachedTokens = numberOrZero(usage?.cache_read_input_tokens);
  const cacheWriteTokens = numberOrZero(usage?.cache_creation_input_tokens);
  const completionTokens = numberOrZero(usage?.output_tokens);
  const promptTokens = uncachedInputTokens + cachedTokens + cacheWriteTokens;
  const cacheTelemetryAvailable = hasOwn(usage, 'cache_read_input_tokens');

  return {
    promptTokens,
    completionTokens,
    reasoningTokens: 0,
    cachedTokens,
    cacheWriteTokens,
    totalTokens: promptTokens + completionTokens,
    cacheStatus: cacheTelemetryAvailable ? (cachedTokens > 0 ? 'hit' : 'miss') : 'unknown',
  };
}

export function aggregateCacheUsage(usages: NormalizedUsage[]): NormalizedUsage {
  const totals = usages.reduce<NormalizedUsage>((acc, usage) => ({
    promptTokens: acc.promptTokens + usage.promptTokens,
    completionTokens: acc.completionTokens + usage.completionTokens,
    reasoningTokens: acc.reasoningTokens + usage.reasoningTokens,
    cachedTokens: acc.cachedTokens + usage.cachedTokens,
    cacheWriteTokens: acc.cacheWriteTokens + usage.cacheWriteTokens,
    totalTokens: acc.totalTokens + usage.totalTokens,
    cacheStatus: 'unknown',
  }), {
    promptTokens: 0,
    completionTokens: 0,
    reasoningTokens: 0,
    cachedTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    cacheStatus: 'unknown',
  });

  if (usages.length > 0 && usages.every(usage => usage.cacheStatus !== 'unknown')) {
    totals.cacheStatus = totals.cachedTokens > 0 ? 'hit' : 'miss';
  }

  return totals;
}

export function summarizeAgentUsage(usages: NormalizedUsage[]): {
  currentRequest: NormalizedUsage;
  consumed: NormalizedUsage;
} {
  const consumed = aggregateCacheUsage(usages);
  const currentRequest = usages.length > 0
    ? usages[usages.length - 1]
    : aggregateCacheUsage([]);

  return { currentRequest, consumed };
}

export function isAnthropicEndpoint(endpoint: string): boolean {
  try {
    return new URL(endpoint).hostname.toLowerCase() === 'api.anthropic.com';
  } catch {
    return false;
  }
}

function parseDataUrl(url: string): { mediaType: string; data: string } | null {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(url);
  return match ? { mediaType: match[1], data: match[2] } : null;
}

function toAnthropicContent(content: any): any {
  if (!Array.isArray(content)) return content;

  return content.map(part => {
    if (part?.type === 'text') return { type: 'text', text: part.text || '' };
    if (part?.type === 'image_url') {
      const parsed = parseDataUrl(part.image_url?.url || '');
      if (parsed) {
        return {
          type: 'image',
          source: { type: 'base64', media_type: parsed.mediaType, data: parsed.data },
        };
      }
    }
    return part;
  }).filter(Boolean);
}

function safeJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function toAnthropicMessage(message: any): any {
  if (message.role === 'tool') {
    return {
      role: 'user',
      content: [{
        type: 'tool_result',
        tool_use_id: message.tool_call_id,
        content: String(message.content ?? ''),
      }],
    };
  }

  const content = toAnthropicContent(message.content);
  if (message.role === 'assistant' && Array.isArray(message.tool_calls)) {
    const blocks = Array.isArray(content)
      ? [...content]
      : content
        ? [{ type: 'text', text: String(content) }]
        : [];

    for (const toolCall of message.tool_calls) {
      blocks.push({
        type: 'tool_use',
        id: toolCall.id,
        name: toolCall.function?.name || '',
        input: safeJsonObject(toolCall.function?.arguments || '{}'),
      });
    }
    return { role: 'assistant', content: blocks };
  }

  return { role: message.role, content };
}

export function buildAnthropicRequest(options: AnthropicRequestOptions): any {
  const system = options.messages
    .filter(message => message.role === 'system')
    .map(message => ({ type: 'text', text: String(message.content || '') }))
    .filter(block => block.text.length > 0);

  return {
    model: options.model,
    max_tokens: options.maxTokens ?? 4000,
    temperature: options.temperature ?? 0.7,
    stream: true,
    system,
    messages: options.messages
      .filter(message => message.role !== 'system')
      .map(toAnthropicMessage),
    ...(options.tools && options.tools.length > 0 ? { tools: options.tools } : {}),
    cache_control: { type: 'ephemeral' },
  };
}
