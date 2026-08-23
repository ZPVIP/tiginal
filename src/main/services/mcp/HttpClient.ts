import { McpClient, McpServerConfig, McpTool, McpToolList, McpClientError, McpError, McpTimeoutError } from './types';
import { formatToolResult } from './StdioClient';
import {
  CacheHints,
  CLIENT_INFO,
  LEGACY_PROTOCOL_VERSION,
  LEGACY_PROTOCOL_VERSIONS,
  LEGACY_SSE_PROTOCOL_VERSION,
  McpEra,
  MODERN_PROTOCOL_VERSION,
  PROBE_TIMEOUT_MS,
  assertCompleteResult,
  forgetLegacyEra,
  isRecognizedModernError,
  isUnsupportedProtocolVersion,
  mergeCacheHints,
  modernParams,
  recallLegacyEra,
  rememberLegacyEra,
  selectDiscoveredVersion,
  selectKnownVersion,
  toolCacheTtl,
} from './protocol';

interface Pending {
  resolve: (value: any) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

interface HeaderBinding {
  headerName: string;
  path: string[];
  type: 'string' | 'integer' | 'boolean';
}

const SINGLE_SCHEMA_KEYWORDS = new Set([
  'additionalProperties', 'contains', 'contentSchema', 'else', 'if', 'items', 'not',
  'propertyNames', 'then', 'unevaluatedItems', 'unevaluatedProperties',
]);
const ARRAY_SCHEMA_KEYWORDS = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems']);
const MAP_SCHEMA_KEYWORDS = new Set(['$defs', 'definitions', 'dependentSchemas', 'patternProperties']);

class McpHttpError extends McpError {
  constructor(readonly status: number, readonly responseText: string, jsonError?: any) {
    super(
      jsonError?.message || `HTTP ${status}${responseText ? `: ${responseText.slice(0, 300)}` : ''}`,
      jsonError?.code,
      jsonError?.data,
    );
    this.name = 'McpHttpError';
  }
}

/** A modern server answers an unimplemented method with 404 and `-32601`. */
function isMethodNotFound(error: unknown): boolean {
  return error instanceof McpHttpError && error.status === 404 && error.code === -32601;
}

function isRecognizedModernHttpError(error: unknown): boolean {
  return isRecognizedModernError(error) || isMethodNotFound(error);
}

const HEADER_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/** Validate and collect every statically reachable x-mcp-header annotation. */
export function collectHeaderBindings(inputSchema: any): { bindings: HeaderBinding[]; error?: string } {
  const bindings: HeaderBinding[] = [];
  const names = new Set<string>();
  let error: string | undefined;

  const visit = (node: any, path: string[], reachable: boolean): void => {
    if (!node || typeof node !== 'object' || error) return;

    if (Object.prototype.hasOwnProperty.call(node, 'x-mcp-header')) {
      const name = node['x-mcp-header'];
      const declaredTypes = (Array.isArray(node.type) ? node.type : [node.type])
        .filter((type: unknown) => type !== 'null');
      if (!reachable || path.length === 0) error = 'x-mcp-header is not on a statically reachable property';
      else if (typeof name !== 'string' || !HEADER_TOKEN.test(name)) error = 'x-mcp-header must be a valid HTTP field-name token';
      else if (declaredTypes.length !== 1 || !['string', 'integer', 'boolean'].includes(declaredTypes[0])) {
        error = 'x-mcp-header is only valid on string, integer, or boolean properties';
      }
      else if (names.has(name.toLowerCase())) error = `duplicate x-mcp-header name "${name}"`;
      else {
        names.add(name.toLowerCase());
        bindings.push({ headerName: `Mcp-Param-${name}`, path, type: declaredTypes[0] });
      }
    }

    for (const [key, value] of Object.entries(node)) {
      if (key === 'properties' && value && typeof value === 'object' && !Array.isArray(value)) {
        for (const [property, schema] of Object.entries(value)) {
          visit(schema, reachable ? [...path, property] : path, reachable);
        }
      } else if (SINGLE_SCHEMA_KEYWORDS.has(key)) {
        visit(value, path, false);
      } else if (ARRAY_SCHEMA_KEYWORDS.has(key) && Array.isArray(value)) {
        value.forEach(item => visit(item, path, false));
      } else if (MAP_SCHEMA_KEYWORDS.has(key) && value && typeof value === 'object' && !Array.isArray(value)) {
        Object.values(value).forEach(schema => visit(schema, path, false));
      }
    }
  };

  // The schema root is reachable, but an annotation must be on a property.
  visit(inputSchema, [], true);
  return error ? { bindings: [], error } : { bindings };
}

export function encodeHeaderValue(value: string): string {
  const plainAscii = /^[\x20-\x7e]*$/.test(value);
  const padded = value.trim() !== value;
  const sentinel = value.startsWith('=?base64?') && value.endsWith('?=');
  return plainAscii && !padded && !sentinel
    ? value
    : `=?base64?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function headerValue(binding: HeaderBinding, args: any): string | undefined {
  let value = args;
  for (const part of binding.path) {
    if (!value || typeof value !== 'object' || !(part in value)) return undefined;
    value = value[part];
  }
  if (value == null) return undefined;
  if (binding.type === 'integer' && (!Number.isSafeInteger(value))) {
    throw new McpClientError(`MCP header parameter "${binding.path.join('.')}" must be a safe integer`);
  }
  if (binding.type === 'boolean' && typeof value !== 'boolean') {
    throw new McpClientError(`MCP header parameter "${binding.path.join('.')}" must be a boolean`);
  }
  if (binding.type === 'string' && typeof value !== 'string') {
    throw new McpClientError(`MCP header parameter "${binding.path.join('.')}" must be a string`);
  }
  return encodeHeaderValue(String(value));
}

/** Pull JSON-RPC messages out of an `text/event-stream` body. */
async function* iterateSse(body: any): AsyncGenerator<any> {
  const decoder = new TextDecoder();
  let buffer = '';

  for await (const chunk of body) {
    buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });

    let idx: number;
    // Events are separated by a blank line; \r\n\r\n is also legal.
    while ((idx = buffer.search(/\r?\n\r?\n/)) !== -1) {
      const rawEvent = buffer.slice(0, idx);
      buffer = buffer.slice(idx + buffer.slice(idx).match(/^\r?\n\r?\n/)![0].length);

      let event = 'message';
      const dataLines: string[] = [];
      for (const line of rawEvent.split(/\r?\n/)) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
      }
      if (dataLines.length === 0) continue;

      yield { event, data: dataLines.join('\n') };
    }
  }
}

/**
 * MCP client for remote servers. Handles both the current `streamableHttp`
 * transport (JSON-RPC over POST, replies as JSON or SSE) and the legacy `sse`
 * transport (GET stream for replies, POST to a server-supplied endpoint).
 */
export class HttpClient implements McpClient {
  private ready: Promise<void> | null = null;
  private sessionId: string | null = null;
  /** Legacy SSE only: where to POST requests, learned from the `endpoint` event. */
  private postEndpoint: string | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private abort: AbortController | null = null;
  private closed = false;
  private era: McpEra;
  private protocolVersion: string;
  private useLegacySse: boolean;
  private toolHeaderBindings = new Map<string, HeaderBinding[]>();
  private rejectedToolReasons = new Map<string, string>();

  constructor(private readonly config: McpServerConfig, private readonly legacySse: boolean) {
    this.era = legacySse ? 'legacy' : 'modern';
    this.protocolVersion = legacySse ? LEGACY_SSE_PROTOCOL_VERSION : MODERN_PROTOCOL_VERSION;
    this.useLegacySse = legacySse;
  }

  private get timeoutMs(): number {
    return Math.max(1, this.config.timeout || 60) * 1000;
  }

  /** Identifies the server this client talks to, for the era memo. */
  private get memoKey(): string {
    return `http:${(this.config.url || '').trim()}`;
  }

  private get url(): string {
    const url = (this.config.url || '').trim();
    if (!url) throw new McpError('Missing "url" for a remote MCP server');
    return url;
  }

  private headers(method?: string, params?: any, additional: Record<string, string> = {}): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(this.config.headers || {}),
    };

    const setHeader = (name: string, value: string): void => {
      for (const existing of Object.keys(headers)) {
        if (existing.toLowerCase() === name.toLowerCase()) delete headers[existing];
      }
      headers[name] = value;
    };

    // These transport headers are normative, so user configuration cannot
    // replace them with values that make the MCP request non-compliant.
    setHeader('Content-Type', 'application/json');
    setHeader('Accept', 'application/json, text/event-stream');

    if (this.era === 'modern' && method) {
      setHeader('MCP-Protocol-Version', this.protocolVersion);
      setHeader('Mcp-Method', method);
      if (['tools/call', 'resources/read', 'prompts/get'].includes(method)) {
        const name = method === 'resources/read' ? params?.uri : params?.name;
        if (typeof name === 'string') setHeader('Mcp-Name', encodeHeaderValue(name));
      }
      for (const [name, value] of Object.entries(additional)) setHeader(name, value);
    } else {
      if (this.sessionId) setHeader('Mcp-Session-Id', this.sessionId);
      if (!this.useLegacySse) setHeader('MCP-Protocol-Version', this.protocolVersion);
    }
    return headers;
  }

  private settle(msg: any): void {
    if (typeof msg?.id !== 'number') return; // a notification
    // A server-initiated request also has an id; only a response settles a call.
    if (!('result' in msg) && !('error' in msg)) return;
    const entry = this.pending.get(msg.id);
    if (!entry) return;
    this.pending.delete(msg.id);
    clearTimeout(entry.timer);
    if (msg.error) entry.reject(new McpError(msg.error.message || 'MCP request failed', msg.error.code, msg.error.data));
    else entry.resolve(msg.result);
  }

  private failAll(err: Error): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(err);
    }
    this.pending.clear();
  }

  private track(id: number, method: string, timeoutMs: number): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new McpTimeoutError(`MCP request "${method}" timed out after ${timeoutMs / 1000}s`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
  }

  /** Legacy SSE: open the GET stream and learn the POST endpoint. */
  private async openLegacyStream(): Promise<void> {
    this.abort = new AbortController();
    const res = await fetch(this.url, {
      method: 'GET',
      headers: { Accept: 'text/event-stream', ...(this.config.headers || {}) },
      signal: this.abort.signal,
    });
    if (!res.ok || !res.body) throw new McpError(`SSE connect failed: HTTP ${res.status}`);

    const endpointReady = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new McpError('Timed out waiting for the SSE endpoint event')), this.timeoutMs);
      const pump = async () => {
        try {
          for await (const { event, data } of iterateSse(res.body)) {
            if (event === 'endpoint') {
              this.postEndpoint = new URL(data, this.url).toString();
              clearTimeout(timer);
              resolve();
              continue;
            }
            try {
              this.settle(JSON.parse(data));
            } catch {
              // Ignore keep-alives and anything that is not JSON-RPC.
            }
          }
          this.failAll(new McpError('SSE stream closed'));
        } catch (err: any) {
          clearTimeout(timer);
          if (!this.closed) this.failAll(new McpError(`SSE stream error: ${err.message}`));
          reject(err);
        }
      };
      void pump();
    });

    await endpointReady;
  }

  private async post(
    payload: object,
    method?: string,
    params?: any,
    additionalHeaders?: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<Response> {
    const target = this.useLegacySse ? (this.postEndpoint || this.url) : this.url;
    const res = await fetch(target, {
      method: 'POST',
      headers: this.headers(method, params, additionalHeaders),
      body: JSON.stringify(payload),
      signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      let jsonError: any;
      try {
        jsonError = JSON.parse(text)?.error;
      } catch {
        // A legacy server may return an empty or non-JSON 4xx response.
      }
      throw new McpHttpError(res.status, text, jsonError);
    }
    const session = res.headers.get('mcp-session-id');
    if (session) this.sessionId = session;
    return res;
  }

  private async request(
    method: string,
    params?: any,
    options: { headers?: Record<string, string>; timeoutMs?: number } = {},
  ): Promise<any> {
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const id = this.nextId++;
    const waiter = this.track(id, method, timeoutMs);
    // The reply timer and the round-trip timer below race each other, and a
    // rejection that has no handler yet is reported as an unhandled rejection —
    // which takes the whole process down. Claim it now; the caller awaiting the
    // waiter still sees the rejection.
    void waiter.catch(() => undefined);
    const wireParams = this.era === 'modern' ? modernParams(params, this.protocolVersion) : (params ?? {});
    const payload = { jsonrpc: '2.0', id, method, params: wireParams };

    // `track` only bounds the wait for a JSON-RPC reply. A server that accepts
    // the POST and never answers it would hang below forever, so bound the
    // round trip to the response headers as well. The timer is dropped once
    // they arrive, which leaves a legitimate SSE stream free to run long.
    const controller = new AbortController();
    const httpTimer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await this.post(payload, method, wireParams, options.headers, controller.signal);
      const contentType = res.headers.get('content-type') || '';

      if (contentType.includes('text/event-stream') && res.body) {
        // Streamable HTTP: the reply arrives inside the POST's own SSE body.
        void (async () => {
          try {
            for await (const { data } of iterateSse(res.body)) {
              try {
                this.settle(JSON.parse(data));
              } catch {
                /* not JSON-RPC */
              }
            }
          } catch {
            /* stream ended */
          }
        })();
      } else if (contentType.includes('application/json')) {
        this.settle(await res.json());
      } else if (!this.useLegacySse) {
        throw new McpError(`MCP request "${method}" returned HTTP ${res.status} without a JSON or SSE response`);
      }
    } catch (err) {
      const entry = this.pending.get(id);
      if (entry) {
        this.pending.delete(id);
        clearTimeout(entry.timer);
      }
      if (controller.signal.aborted) {
        throw new McpTimeoutError(`MCP request "${method}" timed out after ${timeoutMs / 1000}s`);
      }
      throw err;
    } finally {
      clearTimeout(httpTimer);
    }

    return waiter;
  }

  /**
   * A request that re-handshakes if the server rejects the version this
   * connection settled on. `connect` pins a version, but the origin can be
   * redeployed — including all the way back to a legacy revision — between two
   * calls, and nothing else would ever notice.
   *
   * The error is still raised after reconnecting, because only the caller knows
   * what a retry means: a tool call can simply be sent again, while a paginated
   * listing has to start over rather than replay a cursor the new era never
   * issued.
   */
  private async call(method: string, params?: any, headers?: Record<string, string>): Promise<any> {
    try {
      return await this.request(method, params, { headers });
    } catch (error) {
      if (this.era !== 'modern' || !isUnsupportedProtocolVersion(error)) throw error;
      this.ready = null;
      this.sessionId = null;
      await this.connect();
      throw error;
    }
  }

  private async notify(method: string, params?: any): Promise<void> {
    const wireParams = this.era === 'modern' ? modernParams(params, this.protocolVersion) : (params ?? {});
    await this.post({ jsonrpc: '2.0', method, params: wireParams }, method, wireParams).catch(() => undefined);
  }

  private async initializeWithVersions(versions: string[]): Promise<any> {
    let lastError: unknown;
    for (const version of [...new Set(versions)]) {
      this.protocolVersion = version;
      try {
        return await this.request('initialize', {
          protocolVersion: version,
          capabilities: {},
          clientInfo: CLIENT_INFO,
        });
      } catch (error) {
        lastError = error;
        if (error instanceof McpHttpError && [404, 405].includes(error.status)) break;
        if (error instanceof McpHttpError) {
          if (error.status !== 400 || ![-32602, -32022].includes(error.code ?? 0)) break;
        } else if (!(error instanceof McpError) || ![-32602, -32022].includes(error.code ?? 0)) {
          break;
        }
      }
    }
    throw lastError;
  }

  private connect(): Promise<void> {
    if (!this.ready) {
      this.ready = (async () => {
        const memo = this.legacySse ? undefined : recallLegacyEra(this.memoKey);
        let legacyVersion = memo?.version || LEGACY_PROTOCOL_VERSION;
        if (memo?.useLegacySse) this.useLegacySse = true;

        if (!this.useLegacySse && !memo) {
          this.era = 'modern';
          this.protocolVersion = MODERN_PROTOCOL_VERSION;
          try {
            const discovered = await this.request('server/discover', {}, {
              timeoutMs: Math.min(this.timeoutMs, PROBE_TIMEOUT_MS),
            });
            assertCompleteResult(discovered, 'server/discover');
            const selected = selectDiscoveredVersion(discovered);
            if (selected.era === 'modern') {
              this.protocolVersion = selected.version;
              return;
            }
            legacyVersion = selected.version;
          } catch (error) {
            if (isUnsupportedProtocolVersion(error)) {
              const selected = selectKnownVersion(error.data?.supported);
              if (selected.era === 'modern') throw error;
              legacyVersion = selected.version;
            } else if (isMethodNotFound(error) || error instanceof McpTimeoutError) {
              // Discovery is optional for clients, so a server that does not
              // implement it is still usable. A slow answer says nothing about
              // the server's era either — era detection on HTTP is by status
              // code — and a cold-starting server should not be demoted for it.
              // Either way: keep the preferred version, skip discovery, and let
              // a later request renegotiate.
              return;
            } else if (isRecognizedModernError(error)) {
              throw error;
            } else {
              // A legacy endpoint rejects the modern request outright.
              const canFallBack = error instanceof McpHttpError && [400, 404, 405].includes(error.status);
              if (!canFallBack) throw error;
            }
          }
        } else if (this.useLegacySse) {
          await this.openLegacyStream();
        }

        this.era = 'legacy';
        this.protocolVersion = this.useLegacySse ? LEGACY_SSE_PROTOCOL_VERSION : legacyVersion;
        let initialized: any;
        try {
          const versions = this.useLegacySse
            ? [LEGACY_SSE_PROTOCOL_VERSION]
            : [legacyVersion, ...LEGACY_PROTOCOL_VERSIONS.filter(version => version !== LEGACY_SSE_PROTOCOL_VERSION)];
          initialized = await this.initializeWithVersions(versions);
        } catch (error) {
          const canTryLegacySse = !this.useLegacySse
            && error instanceof McpHttpError
            && [400, 404, 405].includes(error.status)
            && !isRecognizedModernHttpError(error);
          if (!canTryLegacySse) throw error;

          this.useLegacySse = true;
          this.sessionId = null;
          this.protocolVersion = LEGACY_SSE_PROTOCOL_VERSION;
          await this.openLegacyStream();
          initialized = await this.initializeWithVersions([LEGACY_SSE_PROTOCOL_VERSION]);
        }
        this.protocolVersion = initialized?.protocolVersion || this.protocolVersion;
        await this.notify('notifications/initialized');
        if (!this.legacySse) {
          rememberLegacyEra(this.memoKey, { version: this.protocolVersion, useLegacySse: this.useLegacySse });
        }
      })().catch((err) => {
        this.ready = null;
        // A remembered era that no longer holds must not be retried forever.
        forgetLegacyEra(this.memoKey);
        void this.close();
        throw err;
      });
    }
    return this.ready;
  }

  async listTools(): Promise<McpToolList> {
    await this.connect();
    // A re-handshake inside `call` can switch eras mid-listing, which would
    // mix pages — and cursors — from two protocol revisions. Start over once.
    for (let attempt = 0; ; attempt++) {
      const era = this.era;
      try {
        const listed = await this.listPages();
        if (this.era === era || attempt > 0) return listed;
      } catch (error) {
        if (attempt > 0 || !isUnsupportedProtocolVersion(error)) throw error;
      }
    }
  }

  private async listPages(): Promise<McpToolList> {
    const tools: McpTool[] = [];
    const warnings: string[] = [];
    const hints: CacheHints = {};
    let cursor: string | undefined;
    if (this.era === 'modern') {
      this.toolHeaderBindings.clear();
      this.rejectedToolReasons.clear();
    }

    do {
      const result = await this.call('tools/list', cursor ? { cursor } : {});
      assertCompleteResult(result, 'tools/list');
      if (this.era === 'modern') mergeCacheHints(hints, result);
      for (const tool of result?.tools || []) {
        if (this.era === 'modern') {
          const collected = collectHeaderBindings(tool.inputSchema);
          if (collected.error) {
            const warning = `Ignoring invalid tool "${tool.name}": ${collected.error}`;
            this.rejectedToolReasons.set(tool.name, collected.error);
            warnings.push(warning);
            console.warn(`[MCP] ${warning}`);
            continue;
          }
          this.toolHeaderBindings.set(tool.name, collected.bindings);
        }
        tools.push({
          name: tool.name,
          description: tool.description || '',
          inputSchema: tool.inputSchema || { type: 'object', properties: {} },
        });
      }
      cursor = result?.nextCursor;
    } while (cursor);

    return {
      tools,
      ttlMs: this.era === 'modern' ? toolCacheTtl(hints.ttlMs) : undefined,
      cacheScope: hints.cacheScope,
      warnings: warnings.length ? warnings : undefined,
    };
  }

  private async toolHeaders(name: string, args: any): Promise<Record<string, string>> {
    if (!this.toolHeaderBindings.has(name)) await this.listTools();
    const rejected = this.rejectedToolReasons.get(name);
    if (rejected) throw new McpClientError(`MCP tool "${name}" has an invalid x-mcp-header definition: ${rejected}`);
    if (!this.toolHeaderBindings.has(name)) throw new McpClientError(`MCP tool "${name}" is not advertised by the server`);

    const headers: Record<string, string> = {};
    for (const binding of this.toolHeaderBindings.get(name) || []) {
      const value = headerValue(binding, args || {});
      if (value !== undefined) headers[binding.headerName] = value;
    }
    return headers;
  }

  async callTool(name: string, args: any): Promise<string> {
    await this.connect();
    const invoke = async (): Promise<string> => {
      const additionalHeaders = this.era === 'modern' ? await this.toolHeaders(name, args) : {};
      return formatToolResult(await this.call('tools/call', { name, arguments: args || {} }, additionalHeaders));
    };

    try {
      return await invoke();
    } catch (error) {
      // A stale tool schema and a version the server no longer accepts are both
      // worth exactly one retry; `call` has already re-handshaked for the latter.
      if (!(error instanceof McpError)) throw error;
      if (error.code === -32020 && this.era === 'modern') await this.listTools();
      else if (!isUnsupportedProtocolVersion(error)) throw error;
      return invoke();
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    this.ready = null;
    this.abort?.abort();
    this.abort = null;
    this.failAll(new McpError('MCP connection closed'));
  }
}
