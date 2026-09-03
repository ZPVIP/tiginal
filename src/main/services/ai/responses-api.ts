import { fetchWithLocalhostFallback } from '../../utils/NetworkUtils';
import { normalizeResponsesUsage, NormalizedUsage } from './cache-usage';
import type { ReasoningEffort } from '../../../shared/ai-provider';

type ToolDefinition = { name: string; description: string; input_schema: object };

interface ResponsesOptions {
  endpoint: string;
  apiKey: string | null;
  model: string;
  messages: unknown[];
  customHeaders?: Record<string, string>;
  tools?: ToolDefinition[];
  maxOutputTokens?: number;
  reasoningEffort?: ReasoningEffort;
  onChunk: (data: { content?: string; reasoning?: string }) => void;
  onToolCall?: (data: { id: string; name: string; input: Record<string, unknown> }) => void | Promise<void>;
  abortSignal?: AbortSignal;
}

interface PendingFunctionCall {
  id: string;
  name: string;
  arguments: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function contentForResponses(content: unknown, role: unknown): unknown {
  if (!Array.isArray(content)) return content;
  return content.flatMap(part => {
    if (!isRecord(part)) return [];
    if (part.type === 'text' && typeof part.text === 'string') {
      return [{ type: role === 'assistant' ? 'output_text' : 'input_text', text: part.text }];
    }
    if (part.type === 'image_url' && isRecord(part.image_url) && typeof part.image_url.url === 'string') {
      return [{ type: 'input_image', image_url: part.image_url.url }];
    }
    return [part];
  });
}

export function buildResponsesInput(messages: unknown[]): unknown[] {
  const input: unknown[] = [];
  for (const message of messages) {
    if (!isRecord(message)) continue;

    if (message.role === 'tool') {
      input.push({
        type: 'function_call_output',
        call_id: typeof message.tool_call_id === 'string' ? message.tool_call_id : '',
        output: String(message.content ?? ''),
      });
      continue;
    }

    if (typeof message.role === 'string' && message.content !== undefined && message.content !== '') {
      input.push({
        role: message.role,
        content: contentForResponses(message.content, message.role),
      });
    }

    if (message.role === 'assistant' && Array.isArray(message.tool_calls)) {
      for (const toolCall of message.tool_calls) {
        if (!isRecord(toolCall) || !isRecord(toolCall.function)) continue;
        input.push({
          type: 'function_call',
          call_id: typeof toolCall.id === 'string' ? toolCall.id : '',
          name: typeof toolCall.function.name === 'string' ? toolCall.function.name : '',
          arguments: typeof toolCall.function.arguments === 'string' ? toolCall.function.arguments : '{}',
        });
      }
    }
  }
  return input;
}

export function responsesUrl(endpoint: string): string {
  const normalized = endpoint.replace(/\/+$/, '');
  return normalized.endsWith('/responses') ? normalized : `${normalized}/responses`;
}

export function buildResponsesRequest(options: {
  model: string;
  messages: unknown[];
  tools?: ToolDefinition[];
  stream: boolean;
  maxOutputTokens?: number;
  reasoningEffort?: ReasoningEffort;
}): Record<string, unknown> {
  return {
    model: options.model,
    input: buildResponsesInput(options.messages),
    stream: options.stream,
    ...(options.maxOutputTokens ? { max_output_tokens: options.maxOutputTokens } : {}),
    ...(options.reasoningEffort ? { reasoning: { effort: options.reasoningEffort } } : {}),
    ...(options.tools && options.tools.length > 0 ? {
      tools: options.tools.map(tool => ({
        type: 'function',
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema,
      })),
      tool_choice: 'auto',
    } : {}),
  };
}

export function parseResponsesOutput(value: unknown): { content: string | null; usage: unknown } {
  if (!isRecord(value)) return { content: null, usage: undefined };
  if (typeof value.output_text === 'string') {
    return { content: value.output_text || null, usage: value.usage };
  }

  const content: string[] = [];
  if (Array.isArray(value.output)) {
    for (const item of value.output) {
      if (!isRecord(item) || !Array.isArray(item.content)) continue;
      for (const part of item.content) {
        if (isRecord(part) && part.type === 'output_text' && typeof part.text === 'string') {
          content.push(part.text);
        }
      }
    }
  }
  return { content: content.join('') || null, usage: value.usage };
}

function functionCallKey(event: Record<string, unknown>): string {
  if (typeof event.item_id === 'string') return event.item_id;
  if (typeof event.output_index === 'number') return String(event.output_index);
  return '0';
}

function updateFunctionCall(
  calls: Map<string, PendingFunctionCall>,
  event: Record<string, unknown>,
): void {
  const item = isRecord(event.item) ? event.item : undefined;
  if (item?.type !== 'function_call') return;
  const key = typeof item.id === 'string' ? item.id : functionCallKey(event);
  calls.set(key, {
    id: typeof item.call_id === 'string' ? item.call_id : key,
    name: typeof item.name === 'string' ? item.name : '',
    arguments: typeof item.arguments === 'string' ? item.arguments : '',
  });
}

export async function streamResponsesAPI(options: ResponsesOptions): Promise<{ usage: NormalizedUsage }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.customHeaders || {}),
  };
  if (options.apiKey) headers.Authorization = `Bearer ${options.apiKey}`;

  let response: Response;
  try {
    response = await fetchWithLocalhostFallback(responsesUrl(options.endpoint), {
      method: 'POST',
      headers,
      body: JSON.stringify(buildResponsesRequest({
        model: options.model,
        messages: options.messages,
        tools: options.tools,
        stream: true,
        maxOutputTokens: options.maxOutputTokens,
        reasoningEffort: options.reasoningEffort,
      })),
      signal: options.abortSignal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      options.onChunk({ content: '\n\n*[Generation stopped]*' });
      return { usage: normalizeResponsesUsage(undefined) };
    }
    throw error;
  }

  if (!response.ok) {
    const errorText = await response.text();
    let message = errorText;
    try {
      const parsed: unknown = JSON.parse(errorText);
      if (isRecord(parsed) && isRecord(parsed.error) && typeof parsed.error.message === 'string') {
        message = parsed.error.message;
      }
    } catch {
      // Use the response text.
    }
    options.onChunk({ content: `> **Responses API Error (${response.status})**\n>\n> ${message}` });
    return { usage: normalizeResponsesUsage(undefined) };
  }

  if (!response.body) throw new Error('No response body for Responses stream');

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  const calls = new Map<string, PendingFunctionCall>();
  let usage: unknown;
  let buffer = '';

  const processEvent = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return;
    const raw = trimmed.slice(5).trim();
    if (!raw || raw === '[DONE]') return;
    try {
      const event: unknown = JSON.parse(raw);
      if (!isRecord(event)) return;
      if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
        options.onChunk({ content: event.delta });
      } else if (
        (event.type === 'response.reasoning_summary_text.delta' || event.type === 'response.reasoning_text.delta')
        && typeof event.delta === 'string'
      ) {
        options.onChunk({ reasoning: event.delta });
      } else if (event.type === 'response.output_item.added' || event.type === 'response.output_item.done') {
        updateFunctionCall(calls, event);
      } else if (event.type === 'response.function_call_arguments.delta' && typeof event.delta === 'string') {
        const key = functionCallKey(event);
        const existing = calls.get(key) || { id: key, name: '', arguments: '' };
        calls.set(key, { ...existing, arguments: existing.arguments + event.delta });
      } else if (event.type === 'response.function_call_arguments.done') {
        const key = functionCallKey(event);
        const existing = calls.get(key) || { id: key, name: '', arguments: '' };
        calls.set(key, {
          ...existing,
          arguments: typeof event.arguments === 'string' ? event.arguments : existing.arguments,
        });
      } else if (event.type === 'response.completed' && isRecord(event.response)) {
        usage = event.response.usage;
      }
    } catch (error) {
      console.warn('Failed to parse Responses SSE line', trimmed, error);
    }
  };

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
    for (const line of lines) processEvent(line);
  }
  if (buffer) processEvent(buffer);

  if (options.onToolCall && !options.abortSignal?.aborted) {
    for (const call of calls.values()) {
      if (call.name) {
        await options.onToolCall({
          id: call.id,
          name: call.name,
          input: parseJsonObject(call.arguments),
        });
      }
    }
  }

  return { usage: normalizeResponsesUsage(usage) };
}
