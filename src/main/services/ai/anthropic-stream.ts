import { fetchWithLocalhostFallback } from '../../utils/NetworkUtils';
import {
  buildAnthropicRequest,
  normalizeAnthropicUsage,
  NormalizedUsage,
} from './cache-usage';

interface AnthropicToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface AnthropicStreamState {
  usage: Record<string, number>;
  toolCalls: AnthropicToolCall[];
  toolInputJson: Record<number, string>;
  toolCallIndexes: Record<number, number>;
}

interface StreamAnthropicOptions {
  endpoint: string;
  apiKey: string | null;
  model: string;
  messages: any[];
  customHeaders?: Record<string, string>;
  tools?: Array<{ name: string; description: string; input_schema: object }>;
  onChunk: (data: { content?: string; reasoning?: string }) => void;
  onToolCall?: (data: AnthropicToolCall) => void | Promise<void>;
  abortSignal?: AbortSignal;
}

export function createAnthropicStreamState(): AnthropicStreamState {
  return {
    usage: {},
    toolCalls: [],
    toolInputJson: {},
    toolCallIndexes: {},
  };
}

function updateToolInput(state: AnthropicStreamState, blockIndex: number): void {
  const toolCallIndex = state.toolCallIndexes[blockIndex];
  if (toolCallIndex === undefined) return;

  const raw = state.toolInputJson[blockIndex];
  if (!raw) return;

  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      state.toolCalls[toolCallIndex].input = parsed;
    }
  } catch {
    // Partial JSON is expected until the content block is complete.
  }
}

export function processAnthropicEvent(
  state: AnthropicStreamState,
  data: any,
  onChunk: (data: { content?: string; reasoning?: string }) => void,
): void {
  if (data?.type === 'message_start' && data.message?.usage) {
    state.usage = { ...state.usage, ...data.message.usage };
    return;
  }

  if (data?.type === 'message_delta' && data.usage) {
    state.usage = { ...state.usage, ...data.usage };
    return;
  }

  if (data?.type === 'content_block_start') {
    const block = data.content_block;
    if (block?.type === 'text' && block.text) onChunk({ content: block.text });
    if (block?.type === 'thinking' && block.thinking) onChunk({ reasoning: block.thinking });
    if (block?.type === 'tool_use') {
      const toolCallIndex = state.toolCalls.length;
      state.toolCallIndexes[data.index] = toolCallIndex;
      state.toolInputJson[data.index] = '';
      state.toolCalls.push({
        id: block.id || '',
        name: block.name || '',
        input: typeof block.input === 'object' && block.input !== null ? block.input : {},
      });
    }
    return;
  }

  if (data?.type !== 'content_block_delta') return;

  const delta = data.delta;
  if (delta?.type === 'text_delta' && delta.text) onChunk({ content: delta.text });
  if (delta?.type === 'thinking_delta' && delta.thinking) onChunk({ reasoning: delta.thinking });
  if (delta?.type === 'input_json_delta') {
    state.toolInputJson[data.index] = (state.toolInputJson[data.index] || '') + (delta.partial_json || '');
    updateToolInput(state, data.index);
  }
}

export function anthropicMessagesUrl(endpoint: string): string {
  const normalized = endpoint.replace(/\/+$/, '');
  const parsed = new URL(normalized);
  if (!parsed.pathname || parsed.pathname === '/') return `${parsed.origin}/v1/messages`;
  return normalized.endsWith('/messages') ? normalized : `${normalized}/messages`;
}

export async function streamAnthropicAPI(options: StreamAnthropicOptions): Promise<{ usage: NormalizedUsage }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
    ...(options.customHeaders || {}),
  };
  if (options.apiKey) headers['x-api-key'] = options.apiKey;

  let response: Response;
  try {
    response = await fetchWithLocalhostFallback(anthropicMessagesUrl(options.endpoint), {
      method: 'POST',
      headers,
      body: JSON.stringify(buildAnthropicRequest({
        model: options.model,
        messages: options.messages,
        tools: options.tools,
      })),
      signal: options.abortSignal,
    });
  } catch (error: any) {
    if (error.name === 'AbortError') {
      options.onChunk({ content: '\n\n*[Generation stopped]*' });
      return { usage: normalizeAnthropicUsage(undefined) };
    }
    throw error;
  }

  if (!response.ok) {
    const errorText = await response.text();
    let message = errorText;
    try {
      const parsed = JSON.parse(errorText);
      message = parsed.error?.message || errorText;
    } catch {
      // Use the response text.
    }
    options.onChunk({ content: `> **Anthropic API Error (${response.status})**\n>\n> ${message}` });
    return { usage: normalizeAnthropicUsage(undefined) };
  }

  if (!response.body) throw new Error('No response body for Anthropic stream');

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  const state = createAnthropicStreamState();
  let buffer = '';

  while (true) {
    if (options.abortSignal?.aborted) {
      await reader.cancel();
      options.onChunk({ content: '\n\n*[Generation stopped]*' });
      break;
    }

    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      try {
        processAnthropicEvent(state, JSON.parse(trimmed.slice(5).trim()), options.onChunk);
      } catch (error) {
        console.warn('Failed to parse Anthropic SSE line', trimmed, error);
      }
    }
  }

  if (buffer.trim().startsWith('data:')) {
    try {
      processAnthropicEvent(state, JSON.parse(buffer.trim().slice(5).trim()), options.onChunk);
    } catch (error) {
      console.warn('Failed to parse final Anthropic SSE line', buffer.trim(), error);
    }
  }

  if (options.onToolCall && !options.abortSignal?.aborted) {
    for (const toolCall of state.toolCalls) await options.onToolCall(toolCall);
  }

  return { usage: normalizeAnthropicUsage(state.usage) };
}
