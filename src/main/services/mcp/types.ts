/**
 * Shared MCP types.
 *
 * Tiginal talks the MCP wire protocol directly (JSON-RPC 2.0) instead of using
 * @modelcontextprotocol/sdk, because the SDK ships ESM-only and the main
 * process is compiled to CommonJS.
 */

export type McpServerType = 'builtin' | 'stdio' | 'sse' | 'streamableHttp';

/** A tool as advertised by a server's `tools/list`. */
export interface McpTool {
  name: string;
  description: string;
  inputSchema: any;
}

export interface McpToolList {
  tools: McpTool[];
  ttlMs?: number;
  cacheScope?: 'public' | 'private';
  warnings?: string[];
}

/**
 * The JSON blob the user edits in Settings. Everything except `type` is
 * transport-specific, which is why it is stored as free-form JSON.
 */
export interface McpServerConfig {
  type?: McpServerType;
  description?: string;
  /** builtin only: which built-in implementation to run */
  provider?: string;
  /** stdio */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  /** sse / streamableHttp */
  url?: string;
  headers?: Record<string, string>;
  /** Seconds to wait for a single request. Defaults to 60. */
  timeout?: number;
  /** builtin-specific options (allowed directories, interpreter path, ...) */
  options?: Record<string, any>;
  [key: string]: any;
}

/** User-entered config before transport aliases and wrappers are normalized. */
export type McpServerInputConfig = Omit<McpServerConfig, 'type'> & {
  type?: McpServerType | 'http';
};

/** A server row as handed to the renderer. */
export interface McpServer {
  id: string;
  name: string;
  type: McpServerType;
  description: string;
  config: McpServerConfig;
  isBuiltin: boolean;
  enabled: boolean;
  disabledTools: string[];
  tools: McpTool[];
  /** False until a tool list has been fetched at least once. */
  hasToolsCache: boolean;
  toolsCacheExpiresAt?: number | null;
  /** Non-fatal problems from the last refresh, such as a rejected tool. */
  warnings: string[];
  lastError: string | null;
  rank: number;
}

/** Minimal client surface shared by every transport. */
export interface McpClient {
  listTools(): Promise<McpToolList>;
  callTool(name: string, args: any): Promise<string>;
  close(): Promise<void>;
}

export class McpError extends Error {
  constructor(message: string, readonly code?: number, readonly data?: any) {
    super(message);
    this.name = 'McpError';
  }
}

/** A client-side protocol validation error, never an error sent by a server. */
export class McpClientError extends McpError {
  constructor(message: string) {
    super(message);
    this.name = 'McpClientError';
  }
}

/** A request we gave up waiting for. Distinct so a probe can fall back on it. */
export class McpTimeoutError extends McpError {
  constructor(message: string) {
    super(message);
    this.name = 'McpTimeoutError';
  }
}
