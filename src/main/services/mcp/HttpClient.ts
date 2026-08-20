import { McpClient, McpServerConfig, McpTool, McpError } from './types';
import { formatToolResult } from './StdioClient';

const PROTOCOL_VERSION = '2025-06-18';
const CLIENT_INFO = { name: 'Tiginal', version: '0.1.0' };

interface Pending {
  resolve: (value: any) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
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

  constructor(private readonly config: McpServerConfig, private readonly legacySse: boolean) {}

  private get timeoutMs(): number {
    return Math.max(1, this.config.timeout || 60) * 1000;
  }

  private get url(): string {
    const url = (this.config.url || '').trim();
    if (!url) throw new McpError('Missing "url" for a remote MCP server');
    return url;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(this.config.headers || {}),
    };
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;
    if (!this.legacySse) headers['MCP-Protocol-Version'] = PROTOCOL_VERSION;
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
    if (msg.error) entry.reject(new McpError(msg.error.message || 'MCP request failed'));
    else entry.resolve(msg.result);
  }

  private failAll(err: Error): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(err);
    }
    this.pending.clear();
  }

  private track(id: number, method: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new McpError(`MCP request "${method}" timed out after ${this.timeoutMs / 1000}s`));
      }, this.timeoutMs);
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

  private async post(payload: object): Promise<Response> {
    const target = this.legacySse ? (this.postEndpoint || this.url) : this.url;
    const res = await fetch(target, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new McpError(`HTTP ${res.status}${text ? `: ${text.slice(0, 300)}` : ''}`);
    }
    const session = res.headers.get('mcp-session-id');
    if (session) this.sessionId = session;
    return res;
  }

  private async request(method: string, params?: any): Promise<any> {
    const id = this.nextId++;
    const waiter = this.track(id, method);
    const payload = { jsonrpc: '2.0', id, method, params: params ?? {} };

    try {
      const res = await this.post(payload);
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
      } else if (!this.legacySse) {
        // 202 Accepted with no body is legal only for notifications.
        this.settle({ id, result: {} });
      }
    } catch (err) {
      const entry = this.pending.get(id);
      if (entry) {
        this.pending.delete(id);
        clearTimeout(entry.timer);
      }
      throw err;
    }

    return waiter;
  }

  private async notify(method: string, params?: any): Promise<void> {
    await this.post({ jsonrpc: '2.0', method, params: params ?? {} }).catch(() => undefined);
  }

  private connect(): Promise<void> {
    if (!this.ready) {
      this.ready = (async () => {
        if (this.legacySse) await this.openLegacyStream();
        await this.request('initialize', {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: CLIENT_INFO,
        });
        await this.notify('notifications/initialized');
      })().catch((err) => {
        this.ready = null;
        void this.close();
        throw err;
      });
    }
    return this.ready;
  }

  async listTools(): Promise<McpTool[]> {
    await this.connect();
    const tools: McpTool[] = [];
    let cursor: string | undefined;

    do {
      const result = await this.request('tools/list', cursor ? { cursor } : {});
      for (const tool of result?.tools || []) {
        tools.push({
          name: tool.name,
          description: tool.description || '',
          inputSchema: tool.inputSchema || { type: 'object', properties: {} },
        });
      }
      cursor = result?.nextCursor;
    } while (cursor);

    return tools;
  }

  async callTool(name: string, args: any): Promise<string> {
    await this.connect();
    return formatToolResult(await this.request('tools/call', { name, arguments: args || {} }));
  }

  async close(): Promise<void> {
    this.closed = true;
    this.ready = null;
    this.abort?.abort();
    this.abort = null;
    this.failAll(new McpError('MCP connection closed'));
  }
}
