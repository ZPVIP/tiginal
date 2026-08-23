import { spawn, ChildProcess } from 'child_process';
import { McpClient, McpServerConfig, McpTool, McpToolList, McpClientError, McpError, McpTimeoutError } from './types';
import { buildSpawnEnv, expandHome } from './env';
import {
  CacheHints,
  CLIENT_INFO,
  LEGACY_PROTOCOL_VERSION,
  LEGACY_PROTOCOL_VERSIONS,
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

/**
 * MCP client speaking JSON-RPC 2.0 over a child process' stdio, one JSON
 * message per line (the `stdio` transport from the MCP spec).
 */
export class StdioClient implements McpClient {
  private child: ChildProcess | null = null;
  private pending = new Map<number, Pending>();
  private buffer = '';
  private stderrTail = '';
  private nextId = 1;
  private ready: Promise<void> | null = null;
  private closed = false;
  private era: McpEra = 'modern';
  private protocolVersion = MODERN_PROTOCOL_VERSION;

  constructor(private readonly config: McpServerConfig) {}

  private get timeoutMs(): number {
    return Math.max(1, this.config.timeout || 60) * 1000;
  }

  /** Identifies the server this client launches, for the era memo. */
  private get memoKey(): string {
    const args = (this.config.args || []).map(a => String(a)).join(' ');
    return `stdio:${(this.config.command || '').trim()} ${args}`;
  }

  private start(): void {
    const command = (this.config.command || '').trim();
    if (!command) throw new McpError('Missing "command" for a stdio MCP server');

    const args = (this.config.args || []).map(a => String(a));
    const child = spawn(command, args, {
      env: buildSpawnEnv(this.config.env),
      cwd: this.config.cwd ? expandHome(this.config.cwd) : undefined,
      stdio: ['pipe', 'pipe', 'pipe'],
      // Windows resolves npx/uvx through .cmd shims, which need a shell.
      shell: process.platform === 'win32',
    });
    this.child = child;

    child.stdout?.setEncoding('utf-8');
    child.stdout?.on('data', (chunk: string) => this.onStdout(chunk));

    child.stderr?.setEncoding('utf-8');
    child.stderr?.on('data', (chunk: string) => {
      // Servers log freely on stderr; keep only enough to explain a failure.
      this.stderrTail = (this.stderrTail + chunk).slice(-2000);
    });

    child.on('error', (err) => this.failAll(new McpError(`Failed to start "${command}": ${err.message}`)));
    child.on('exit', (code, signal) => {
      const how = signal ? `signal ${signal}` : `code ${code}`;
      this.failAll(new McpError(`MCP server exited (${how})${this.stderrTail ? `: ${this.stderrTail.trim()}` : ''}`));
    });
  }

  private onStdout(chunk: string): void {
    this.buffer += chunk;
    let idx: number;
    while ((idx = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;

      let msg: any;
      try {
        msg = JSON.parse(line);
      } catch {
        // Some servers print non-JSON banners on stdout; ignore them.
        continue;
      }
      this.dispatch(msg);
    }
  }

  private dispatch(msg: any): void {
    if (typeof msg?.id !== 'number') return; // a notification
    // Servers also send *requests* (sampling, roots) that carry an id but no
    // result/error; those must not settle one of our pending calls.
    if (!('result' in msg) && !('error' in msg)) return;
    const entry = this.pending.get(msg.id);
    if (!entry) return;
    this.pending.delete(msg.id);
    clearTimeout(entry.timer);

    if (msg.error) {
      entry.reject(new McpError(msg.error.message || 'MCP request failed', msg.error.code, msg.error.data));
    } else {
      entry.resolve(msg.result);
    }
  }

  private failAll(err: Error): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(err);
    }
    this.pending.clear();
  }

  private send(payload: object): void {
    if (!this.child?.stdin?.writable) throw new McpError('MCP server is not running');
    this.child.stdin.write(JSON.stringify(payload) + '\n');
  }

  private request(
    method: string,
    params?: any,
    includeModernMetadata = this.era === 'modern',
    requestTimeoutMs = this.timeoutMs,
  ): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new McpTimeoutError(`MCP request "${method}" timed out after ${requestTimeoutMs / 1000}s`));
      }, requestTimeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({
          jsonrpc: '2.0',
          id,
          method,
          params: includeModernMetadata ? modernParams(params, this.protocolVersion) : (params ?? {}),
        });
      } catch (err) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(err as Error);
      }
    });
  }

  private async initializeLegacy(preferredVersion = LEGACY_PROTOCOL_VERSION): Promise<void> {
    const versions = [...new Set([preferredVersion, ...LEGACY_PROTOCOL_VERSIONS])];
    let lastError: unknown;
    for (const version of versions) {
      try {
        const initialized = await this.request('initialize', {
          protocolVersion: version,
          capabilities: {},
          clientInfo: CLIENT_INFO,
        }, false);
        this.protocolVersion = initialized?.protocolVersion || version;
        this.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
        return;
      } catch (error) {
        lastError = error;
        if (!(error instanceof McpError) || ![-32602, -32022].includes(error.code ?? 0)) throw error;
      }
    }
    throw lastError;
  }

  /** Probe for the stateless protocol, then fall back to a legacy handshake. */
  private connect(): Promise<void> {
    if (!this.ready) {
      this.ready = (async () => {
        this.start();
        this.era = 'modern';
        this.protocolVersion = MODERN_PROTOCOL_VERSION;
        const memo = recallLegacyEra(this.memoKey);
        let legacyVersion = memo?.version || LEGACY_PROTOCOL_VERSION;

        if (memo) {
          this.era = 'legacy';
          await this.initializeLegacy(legacyVersion);
          return;
        }

        try {
          const discovered = await this.request('server/discover', {}, true, Math.min(this.timeoutMs, PROBE_TIMEOUT_MS));
          assertCompleteResult(discovered, 'server/discover');
          const selected = selectDiscoveredVersion(discovered);
          if (selected.era === 'modern') {
            this.protocolVersion = selected.version;
            return;
          }
          legacyVersion = selected.version;
        } catch (error) {
          if (error instanceof McpClientError) {
            throw error;
          } else if (isUnsupportedProtocolVersion(error)) {
            const selected = selectKnownVersion(error.data?.supported);
            if (selected.era === 'modern') throw error;
            legacyVersion = selected.version;
          } else if (isRecognizedModernError(error)) {
            throw error;
          }
        }

        this.era = 'legacy';
        await this.initializeLegacy(legacyVersion);
        rememberLegacyEra(this.memoKey, { version: this.protocolVersion, useLegacySse: false });
      })().catch((err) => {
        // Let the next call retry from scratch instead of caching the failure.
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
    const tools: McpTool[] = [];
    const hints: CacheHints = {};
    let cursor: string | undefined;

    do {
      const result = await this.request('tools/list', cursor ? { cursor } : {});
      assertCompleteResult(result, 'tools/list');
      if (this.era === 'modern') mergeCacheHints(hints, result);
      for (const tool of result?.tools || []) {
        tools.push({
          name: tool.name,
          description: tool.description || '',
          inputSchema: tool.inputSchema || { type: 'object', properties: {} },
        });
      }
      cursor = result?.nextCursor;
    } while (cursor);

    return { tools, ttlMs: this.era === 'modern' ? toolCacheTtl(hints.ttlMs) : undefined, cacheScope: hints.cacheScope };
  }

  async callTool(name: string, args: any): Promise<string> {
    await this.connect();
    const result = await this.request('tools/call', { name, arguments: args || {} });
    return formatToolResult(result);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.failAll(new McpError('MCP connection closed'));
    const child = this.child;
    this.child = null;
    this.ready = null;
    if (!child || child.exitCode !== null) return;

    child.stdin?.end();
    child.kill();
    // Give the server a moment to exit cleanly before forcing it.
    setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
    }, 2000).unref?.();
  }
}

/** Flatten an MCP `CallToolResult` into the plain text the chat loop expects. */
export function formatToolResult(result: any): string {
  if (result == null) return 'Done';

  const resultType = result.resultType ?? 'complete';
  if (resultType === 'input_required') {
    const methods = Object.values(result.inputRequests || {})
      .map((request: any) => request?.method)
      .filter((method): method is string => typeof method === 'string');
    throw new McpClientError(
      `MCP tool requires additional client input${methods.length ? ` (${methods.join(', ')})` : ''}, but Tiginal did not advertise those capabilities`,
    );
  }
  if (resultType !== 'complete') throw new McpClientError(`Unsupported MCP tool resultType "${String(resultType)}"`);

  const parts: string[] = [];
  for (const item of result.content || []) {
    if (item?.type === 'text') parts.push(item.text || '');
    else if (item?.type === 'resource') parts.push(item.resource?.text || JSON.stringify(item.resource));
    else if (item?.type === 'image') parts.push(`[image ${item.mimeType || 'binary'}]`);
    else parts.push(JSON.stringify(item));
  }

  if (parts.length === 0 && result.structuredContent) {
    parts.push(JSON.stringify(result.structuredContent, null, 2));
  }

  const text = parts.join('\n').trim() || 'Done';
  return result.isError ? `Error: ${text}` : text;
}
