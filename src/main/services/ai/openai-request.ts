export type OpenAIRequestPayload = Record<string, unknown>;

type RequestFetcher = (url: string, init: RequestInit) => Promise<Response>;

export interface OpenAIFetchResult {
  response: Response;
  payload: OpenAIRequestPayload;
  errorText?: string;
}

function isOfficialOpenAIEndpoint(endpoint: string): boolean {
  try {
    return new URL(endpoint).hostname.toLowerCase() === 'api.openai.com';
  } catch {
    return false;
  }
}

function withoutKeys(
  payload: Readonly<OpenAIRequestPayload>,
  keys: ReadonlySet<string>,
): OpenAIRequestPayload {
  return Object.entries(payload).reduce<OpenAIRequestPayload>((result, [key, value]) => {
    if (!keys.has(key)) result[key] = value;
    return result;
  }, {});
}

function isTextSystemMessage(
  value: unknown,
): value is Record<string, unknown> & { role: 'system'; content: string } {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && 'role' in value
    && value.role === 'system'
    && 'content' in value
    && typeof value.content === 'string';
}

function mergeLeadingSystemMessages(messages: unknown): unknown {
  if (!Array.isArray(messages)) return messages;

  const systemMessages = [];
  for (const message of messages) {
    if (!isTextSystemMessage(message)) break;
    systemMessages.push(message);
  }

  if (systemMessages.length < 2) return messages;

  // Preserve content order so stable system text remains the cacheable prefix.
  const mergedSystemMessage = {
    ...systemMessages[0],
    content: systemMessages.map(message => message.content).join('\n\n'),
  };
  return [mergedSystemMessage, ...messages.slice(systemMessages.length)];
}

function normalizeOpenAIPayload(
  payload: Readonly<OpenAIRequestPayload>,
): OpenAIRequestPayload {
  if (!('messages' in payload)) return { ...payload };
  return {
    ...payload,
    messages: mergeLeadingSystemMessages(payload.messages),
  };
}

export function applyCompletionTokenLimit(
  payload: Readonly<OpenAIRequestPayload>,
  endpoint: string,
  tokenLimit: number,
): OpenAIRequestPayload {
  const result = withoutKeys(payload, new Set(['max_tokens', 'max_completion_tokens']));
  if (isOfficialOpenAIEndpoint(endpoint)) {
    result.max_completion_tokens = tokenLimit;
  } else {
    result.max_tokens = tokenLimit;
  }
  return result;
}

export function getOpenAIRequestFallback(
  payload: Readonly<OpenAIRequestPayload>,
  status: number,
  errorText: string,
): OpenAIRequestPayload | null {
  if (status !== 400 && status !== 422) return null;

  if ('stream_options' in payload && /stream_options|include_usage/i.test(errorText)) {
    return withoutKeys(payload, new Set(['stream_options']));
  }

  if (
    typeof payload.max_tokens === 'number'
    && /max_tokens/i.test(errorText)
    && /max_completion_tokens/i.test(errorText)
  ) {
    const result = withoutKeys(payload, new Set(['max_tokens']));
    result.max_completion_tokens = payload.max_tokens;
    return result;
  }

  if (
    typeof payload.max_completion_tokens === 'number'
    && /max_completion_tokens/i.test(errorText)
    && /(?:use|supports?)\s+['"]?max_tokens/i.test(errorText)
  ) {
    const result = withoutKeys(payload, new Set(['max_completion_tokens']));
    result.max_tokens = payload.max_completion_tokens;
    return result;
  }

  return null;
}

export async function fetchOpenAIWithCompatibility(
  fetcher: RequestFetcher,
  url: string,
  init: Omit<RequestInit, 'body'>,
  payload: Readonly<OpenAIRequestPayload>,
): Promise<OpenAIFetchResult> {
  let currentPayload = normalizeOpenAIPayload(payload);

  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetcher(url, {
      ...init,
      body: JSON.stringify(currentPayload),
    });
    if (response.ok) return { response, payload: currentPayload };

    const errorText = await response.text();
    const fallbackPayload = getOpenAIRequestFallback(currentPayload, response.status, errorText);
    if (!fallbackPayload) return { response, payload: currentPayload, errorText };
    currentPayload = fallbackPayload;
  }

  throw new Error('OpenAI compatibility retry limit exceeded');
}
