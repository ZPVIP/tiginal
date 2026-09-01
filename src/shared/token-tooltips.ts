export type CacheStatus = 'hit' | 'miss' | 'unknown';

interface CacheTooltipData {
  promptTokens?: number;
  cachedTokens?: number;
  cacheStatus?: CacheStatus;
}

interface TokenTooltipData {
  inputTokens?: number;
  outputTokens?: number;
  titleTokens?: number;
  sessionTokens?: number;
}

export interface SessionTokenMessage {
  role: string;
  promptTokens?: number;
  completionTokens?: number;
  requestPromptTokens?: number;
  requestCompletionTokens?: number;
  requestTotalTokens?: number;
  contextTokens?: number;
  titleTokens?: number;
}

function interactionTotal(message: SessionTokenMessage): number {
  if (message.requestTotalTokens !== undefined) return message.requestTotalTokens;
  if ((message.contextTokens || 0) > 0) return message.contextTokens || 0;

  const input = message.requestPromptTokens ?? message.promptTokens ?? 0;
  const output = message.requestCompletionTokens ?? message.completionTokens ?? 0;
  return input + output;
}

export function calculateSessionTokenTotals(messages: readonly SessionTokenMessage[]): number[] {
  let consumed = 0;
  let titleCounted = false;

  return messages.map(message => {
    if (message.role !== 'assistant') return consumed;

    consumed += interactionTotal(message);
    if (!titleCounted && (message.titleTokens || 0) > 0) {
      consumed += message.titleTokens || 0;
      titleCounted = true;
    }
    return consumed;
  });
}

export function formatCacheTooltip(data: CacheTooltipData): string {
  const promptTokens = data.promptTokens || 0;
  if (data.cacheStatus === 'unknown' || data.cacheStatus === undefined) {
    return `Cached: unknown | Uncached: unknown | Total input: ${promptTokens}`;
  }

  const cachedTokens = data.cachedTokens || 0;
  const uncachedTokens = Math.max(promptTokens - cachedTokens, 0);
  return `Cached: ${cachedTokens} | Uncached: ${uncachedTokens} | Total input: ${promptTokens}`;
}

export function formatTokenTooltip(data: TokenTooltipData): string {
  const inputTokens = data.inputTokens || 0;
  const outputTokens = data.outputTokens || 0;
  const chatTokens = inputTokens + outputTokens;
  const chatLine = `Input: ${inputTokens} | Output: ${outputTokens} | Total: ${chatTokens}`;
  const titleTokens = data.titleTokens || 0;
  const sessionTokens = data.sessionTokens || 0;

  if (sessionTokens > 0) {
    const titleSuffix = titleTokens > 0 ? ` (includes title: ${titleTokens})` : '';
    return `${chatLine}\nSession consumed: ${sessionTokens}${titleSuffix}`;
  }

  if (titleTokens === 0) return chatLine;
  return `${chatLine}\nTitle: ${titleTokens} | Overall: ${chatTokens + titleTokens}`;
}
