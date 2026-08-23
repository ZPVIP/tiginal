import { McpClientError, McpError } from './types';

export const MODERN_PROTOCOL_VERSION = '2026-07-28';
export const LEGACY_PROTOCOL_VERSION = '2025-11-25';
export const LEGACY_SSE_PROTOCOL_VERSION = '2024-11-05';
export const LEGACY_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'] as const;
export const CLIENT_INFO = { name: 'Tiginal', version: '0.1.0' };

/** A legacy server answers the modern probe with an error, or not at all. */
export const PROBE_TIMEOUT_MS = 3000;
/** The spec leaves the freshness of a list without `ttlMs` up to the client. */
export const DEFAULT_TOOL_CACHE_MS = 60_000;
/**
 * `ttlMs: 0` asks us to treat the list as immediately stale. The refresh runs
 * inline on the chat path, so a small floor keeps a single message from paying
 * for several full `tools/list` walks.
 */
export const MIN_TOOL_CACHE_MS = 5_000;

export type McpEra = 'modern' | 'legacy';

/** `-32020`..`-32099` is reserved for the spec, so any code there is modern. */
export function isRecognizedModernError(error: unknown): error is McpError {
  return error instanceof McpError
    && typeof error.code === 'number'
    && error.code <= -32020
    && error.code >= -32099;
}

export function isUnsupportedProtocolVersion(error: unknown): error is McpError {
  return error instanceof McpError && error.code === -32022;
}

/**
 * True when a failed call left the connection usable: either our own
 * validation rejected it, or the server answered with a JSON-RPC error.
 * Anything else — a timeout, a dead socket, a child that exited — means the
 * connection has to be rebuilt.
 */
export function isRecoverableCallError(error: unknown): boolean {
  return error instanceof McpClientError
    || (error instanceof McpError && typeof error.code === 'number');
}

export function modernParams(params: any = {}, version = MODERN_PROTOCOL_VERSION): any {
  return {
    ...params,
    _meta: {
      ...(params?._meta || {}),
      'io.modelcontextprotocol/protocolVersion': version,
      'io.modelcontextprotocol/clientInfo': CLIENT_INFO,
      'io.modelcontextprotocol/clientCapabilities': {},
    },
  };
}

export function selectKnownVersion(supportedValue: unknown): { era: McpEra; version: string } {
  const supported = Array.isArray(supportedValue)
    ? supportedValue.filter((value): value is string => typeof value === 'string')
    : [];
  if (supported.includes(MODERN_PROTOCOL_VERSION)) return { era: 'modern', version: MODERN_PROTOCOL_VERSION };
  const legacy = LEGACY_PROTOCOL_VERSIONS.find(version => supported.includes(version));
  if (legacy) return { era: 'legacy', version: legacy };
  throw new McpClientError(
    `No mutually supported MCP protocol version${supported.length ? ` (server supports: ${supported.join(', ')})` : ''}`,
  );
}

export function selectDiscoveredVersion(result: any): { era: McpEra; version: string } {
  return selectKnownVersion(result?.supportedVersions);
}

export function assertCompleteResult(result: any, method: string): void {
  const resultType = result?.resultType ?? 'complete';
  if (resultType !== 'complete') {
    throw new McpClientError(`MCP request "${method}" returned unsupported resultType "${String(resultType)}"`);
  }
}

export interface CacheHints {
  ttlMs?: number;
  cacheScope?: 'public' | 'private';
}

/**
 * Fold one page's caching hints into the hints for the whole list. Each page
 * carries its own TTL, so the shortest one bounds the list; `private` wins over
 * `public` because it is the more restrictive scope.
 */
export function mergeCacheHints(hints: CacheHints, result: any): void {
  if (typeof result?.ttlMs === 'number' && Number.isFinite(result.ttlMs)) {
    // A negative TTL is meaningless; the spec asks clients to read it as 0.
    const ttlMs = Math.max(0, result.ttlMs);
    hints.ttlMs = hints.ttlMs === undefined ? ttlMs : Math.min(hints.ttlMs, ttlMs);
  }
  if (result?.cacheScope === 'private') hints.cacheScope = 'private';
  else if (!hints.cacheScope && result?.cacheScope === 'public') hints.cacheScope = 'public';
}

/** How long a freshly listed tool set stays fresh, in milliseconds. */
export function toolCacheTtl(ttlMs: number | undefined): number {
  return ttlMs === undefined ? DEFAULT_TOOL_CACHE_MS : Math.max(ttlMs, MIN_TOOL_CACHE_MS);
}

interface LegacyEra {
  version: string;
  useLegacySse: boolean;
}

/**
 * The spec asks clients to remember which era a server speaks rather than
 * probing every time. Only the legacy answer is worth remembering: it is the
 * expensive one to rediscover (a legacy server may simply not answer the
 * probe), and a stale memo fails loudly on the handshake, which clears it.
 */
const legacyEras = new Map<string, LegacyEra>();

export function recallLegacyEra(key: string): LegacyEra | undefined {
  return legacyEras.get(key);
}

export function rememberLegacyEra(key: string, era: LegacyEra): void {
  legacyEras.set(key, era);
}

export function forgetLegacyEra(key: string): void {
  legacyEras.delete(key);
}
