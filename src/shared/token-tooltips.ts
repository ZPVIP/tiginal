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

  if (titleTokens === 0) return chatLine;
  return `${chatLine}\nTitle: ${titleTokens} | Overall: ${chatTokens + titleTokens}`;
}
