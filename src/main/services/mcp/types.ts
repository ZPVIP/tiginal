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
  lastError: string | null;
  rank: number;
}

/** Minimal client surface shared by every transport. */
export interface McpClient {
  listTools(): Promise<McpTool[]>;
  callTool(name: string, args: any): Promise<string>;
  close(): Promise<void>;
}

export class McpError extends Error {}
