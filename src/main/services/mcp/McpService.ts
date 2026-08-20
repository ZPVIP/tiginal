import * as crypto from 'crypto';
import { getDatabase } from '../../../services/database/database';
import { McpClient, McpServer, McpServerConfig, McpServerType, McpTool, McpError } from './types';
import { StdioClient } from './StdioClient';
import { HttpClient } from './HttpClient';
import { BuiltinClient, BUILTIN_PROVIDERS } from './builtin';

const GLOBAL_ENABLED_KEY = 'mcpGlobalEnabled';
const TOOL_PREFIX = 'mcp__';
/** OpenAI rejects function names longer than 64 characters. */
const MAX_TOOL_NAME = 64;

interface Row {
  id: string;
  name: string;
  type: string;
  description: string | null;
  config: string;
  is_builtin: number;
  enabled: number;
  disabled_tools: string;
  tools_cache: string | null;
  last_error: string | null;
  rank: number;
}

function parseJson<T>(text: string | null, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

/** Function names may only contain `[A-Za-z0-9_-]`, so fold everything else. */
function slug(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'server';
}

/**
 * Turn a (server, tool) pair into a single wire name. Long names are trimmed
 * from the server half first and given a short hash so they stay unique.
 */
function qualify(serverName: string, toolName: string): string {
  const full = `${TOOL_PREFIX}${slug(serverName)}__${slug(toolName)}`;
  if (full.length <= MAX_TOOL_NAME) return full;

  const hash = crypto.createHash('sha1').update(full).digest('hex').slice(0, 6);
  const tail = `__${slug(toolName)}_${hash}`;
  const room = Math.max(1, MAX_TOOL_NAME - TOOL_PREFIX.length - tail.length);
  return `${TOOL_PREFIX}${slug(serverName).slice(0, room)}${tail}`;
}

export class McpService {
  private clients = new Map<string, { client: McpClient; signature: string }>();
  /** Wire tool name -> which server and which real tool it belongs to. */
  private routes = new Map<string, { serverId: string; toolName: string }>();

  private get db() {
    return getDatabase().getDb();
  }

  // ------------------------------------------------------------------ settings

  isGlobalEnabled(): boolean {
    return getDatabase().getSetting(GLOBAL_ENABLED_KEY) !== 'false';
  }

  setGlobalEnabled(enabled: boolean): void {
    getDatabase().setSetting(GLOBAL_ENABLED_KEY, String(!!enabled));
  }

  // --------------------------------------------------------------------- rows

  private toServer(row: Row): McpServer {
    const config = parseJson<McpServerConfig>(row.config, {});
    return {
      id: row.id,
      name: row.name,
      type: (row.type as McpServerType) || 'stdio',
      description: row.description || config.description || '',
      config,
      isBuiltin: row.is_builtin === 1,
      enabled: row.enabled === 1,
      disabledTools: parseJson<string[]>(row.disabled_tools, []),
      tools: parseJson<McpTool[]>(row.tools_cache, []),
      lastError: row.last_error,
      rank: row.rank,
    };
  }

  listServers(): McpServer[] {
    const rows = this.db.prepare('SELECT * FROM mcp_servers ORDER BY rank ASC, name ASC').all() as Row[];
    return rows.map(r => this.toServer(r));
  }

  getServer(id: string): McpServer | null {
    const row = this.db.prepare('SELECT * FROM mcp_servers WHERE id = ?').get(id) as Row | undefined;
    return row ? this.toServer(row) : null;
  }

  /**
   * Seed the built-in servers on first run. Existing rows are left alone so a
   * user's edits survive; only missing built-ins are (re)created.
   */
  seedBuiltins(): void {
    const now = Date.now();
    const insert = this.db.prepare(`
      INSERT INTO mcp_servers (id, name, type, description, config, is_builtin, enabled, disabled_tools, rank, created_at, updated_at)
      VALUES (?, ?, 'builtin', ?, ?, 1, 0, '[]', ?, ?, ?)
    `);

    let rank = 0;
    for (const [provider, def] of Object.entries(BUILTIN_PROVIDERS)) {
      const existing = this.db.prepare('SELECT id FROM mcp_servers WHERE name = ?').get(provider);
      if (!existing) {
        insert.run(crypto.randomUUID(), provider, def.description, JSON.stringify(def.defaults(), null, 2), rank, now, now);
      }
      rank++;
    }
  }

  // -------------------------------------------------------------------- writes

  private assertNameAvailable(name: string, excludeId?: string): void {
    const row = excludeId
      ? this.db.prepare('SELECT id FROM mcp_servers WHERE name = ? AND id != ?').get(name, excludeId)
      : this.db.prepare('SELECT id FROM mcp_servers WHERE name = ?').get(name);
    if (row) throw new McpError(`An MCP server named "${name}" already exists`);
  }

  /**
   * Validate a config the user typed. Returns the normalized type so the row
   * and the JSON never disagree about the transport.
   */
  private validate(name: string, config: McpServerConfig, isBuiltin: boolean): McpServerType {
    if (!name.trim()) throw new McpError('"name" is required');
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new McpError('The config must be a JSON object');

    const type = (config.type || (config.url ? 'streamableHttp' : 'stdio')) as McpServerType;
    if (!['builtin', 'stdio', 'sse', 'streamableHttp'].includes(type)) {
      throw new McpError(`Unknown type "${type}" (expected builtin, stdio, sse or streamableHttp)`);
    }
    if (isBuiltin && type !== 'builtin') throw new McpError('A built-in server must keep "type": "builtin"');

    if (type === 'builtin') {
      if (!config.provider || !BUILTIN_PROVIDERS[config.provider]) {
        throw new McpError(`"provider" must be one of: ${Object.keys(BUILTIN_PROVIDERS).join(', ')}`);
      }
    } else if (type === 'stdio') {
      if (!String(config.command || '').trim()) throw new McpError('"command" is required for a stdio server');
      if (config.args && !Array.isArray(config.args)) throw new McpError('"args" must be an array of strings');
    } else {
      if (!String(config.url || '').trim()) throw new McpError('"url" is required for a remote server');
      try {
        new URL(String(config.url));
      } catch {
        throw new McpError(`"url" is not a valid URL: ${config.url}`);
      }
    }

    return type;
  }

  saveServer(input: { id?: string; name: string; config: McpServerConfig }): McpServer {
    const name = String(input.name || '').trim();
    const existing = input.id ? this.getServer(input.id) : null;
    if (input.id && !existing) throw new McpError('Server not found');

    // A built-in row keeps its identity: renaming it would orphan the provider.
    if (existing?.isBuiltin && name !== existing.name) {
      throw new McpError('A built-in server cannot be renamed');
    }

    const type = this.validate(name, input.config, !!existing?.isBuiltin);
    this.assertNameAvailable(name, input.id);

    const now = Date.now();
    const config = { ...input.config, type };
    const json = JSON.stringify(config, null, 2);
    const description = config.description || existing?.description || '';

    if (existing) {
      this.db.prepare(`
        UPDATE mcp_servers SET name = ?, type = ?, description = ?, config = ?, tools_cache = NULL, last_error = NULL, updated_at = ?
        WHERE id = ?
      `).run(name, type, description, json, now, existing.id);
      this.dispose(existing.id);
      return this.getServer(existing.id)!;
    }

    const id = crypto.randomUUID();
    const nextRank = (this.db.prepare('SELECT COALESCE(MAX(rank), -1) + 1 AS r FROM mcp_servers').get() as { r: number }).r;
    this.db.prepare(`
      INSERT INTO mcp_servers (id, name, type, description, config, is_builtin, enabled, disabled_tools, rank, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 0, 0, '[]', ?, ?, ?)
    `).run(id, name, type, description, json, nextRank, now, now);

    return this.getServer(id)!;
  }

  deleteServer(id: string): void {
    const server = this.getServer(id);
    if (!server) return;
    this.dispose(id);
    this.db.prepare('DELETE FROM mcp_servers WHERE id = ?').run(id);
  }

  setEnabled(id: string, enabled: boolean): void {
    this.db.prepare('UPDATE mcp_servers SET enabled = ?, updated_at = ? WHERE id = ?').run(enabled ? 1 : 0, Date.now(), id);
    if (!enabled) this.dispose(id);
  }

  setToolEnabled(id: string, toolName: string, enabled: boolean): void {
    const server = this.getServer(id);
    if (!server) return;
    const disabled = new Set(server.disabledTools);
    if (enabled) disabled.delete(toolName);
    else disabled.add(toolName);
    this.db.prepare('UPDATE mcp_servers SET disabled_tools = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify([...disabled]), Date.now(), id);
  }

  reorder(orderedIds: string[]): void {
    const now = Date.now();
    const stmt = this.db.prepare('UPDATE mcp_servers SET rank = ?, updated_at = ? WHERE id = ?');
    const run = this.db.transaction((ids: string[]) => {
      ids.forEach((id, index) => stmt.run(index, now, id));
    });
    run(orderedIds);
  }

  /**
   * Import the `{"mcpServers": {...}}` shape other MCP clients use. A bare map
   * of name -> config and an array of `{name, ...config}` objects also work.
   */
  importJson(text: string): { added: number; updated: number; skipped: Array<{ name: string; reason: string }> } {
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch (e: any) {
      throw new McpError(`Invalid JSON: ${e.message}`);
    }

    const entries: Array<[string, any]> = [];
    if (Array.isArray(parsed)) {
      for (const item of parsed) entries.push([item?.name, item]);
    } else if (parsed && typeof parsed === 'object') {
      const map = parsed.mcpServers || parsed.servers || parsed;
      for (const [name, config] of Object.entries(map)) entries.push([name, config]);
    } else {
      throw new McpError('Expected a JSON object or array of servers');
    }

    let added = 0;
    let updated = 0;
    const skipped: Array<{ name: string; reason: string }> = [];

    for (const [rawName, rawConfig] of entries) {
      const name = String(rawName || '').trim();
      if (!name || !rawConfig || typeof rawConfig !== 'object') {
        skipped.push({ name: name || '(unnamed)', reason: 'not a server object' });
        continue;
      }

      const { name: _ignored, ...config } = rawConfig as any;
      const existing = this.db.prepare('SELECT id, is_builtin FROM mcp_servers WHERE name = ?').get(name) as
        | { id: string; is_builtin: number }
        | undefined;

      if (existing?.is_builtin === 1) {
        skipped.push({ name, reason: 'built-in server, not overwritten' });
        continue;
      }

      try {
        this.saveServer({ id: existing?.id, name, config });
        if (existing) updated++;
        else added++;
      } catch (e: any) {
        skipped.push({ name, reason: e.message });
      }
    }

    return { added, updated, skipped };
  }

  // --------------------------------------------------------------- connections

  /** Config fingerprint, so an edited server reconnects instead of reusing a stale process. */
  private signature(server: McpServer): string {
    return JSON.stringify(server.config);
  }

  private clientFor(server: McpServer): McpClient {
    const signature = this.signature(server);
    const cached = this.clients.get(server.id);
    if (cached && cached.signature === signature) return cached.client;
    if (cached) void cached.client.close();

    let client: McpClient;
    if (server.type === 'builtin') client = new BuiltinClient(server.config);
    else if (server.type === 'stdio') client = new StdioClient(server.config);
    else client = new HttpClient(server.config, server.type === 'sse');

    this.clients.set(server.id, { client, signature });
    return client;
  }

  private dispose(id: string): void {
    const cached = this.clients.get(id);
    if (!cached) return;
    this.clients.delete(id);
    void cached.client.close();
  }

  async disposeAll(): Promise<void> {
    const clients = [...this.clients.values()];
    this.clients.clear();
    await Promise.all(clients.map(c => c.client.close().catch(() => undefined)));
  }

  /** Connect to a server, refresh its cached tool list, and record any error. */
  async refreshTools(id: string): Promise<McpServer> {
    const server = this.getServer(id);
    if (!server) throw new McpError('Server not found');

    try {
      const tools = await this.clientFor(server).listTools();
      this.db.prepare('UPDATE mcp_servers SET tools_cache = ?, last_error = NULL, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(tools), Date.now(), id);
    } catch (e: any) {
      this.dispose(id);
      this.db.prepare('UPDATE mcp_servers SET last_error = ?, updated_at = ? WHERE id = ?')
        .run(String(e?.message || e), Date.now(), id);
    }

    return this.getServer(id)!;
  }

  async refreshAllEnabled(): Promise<McpServer[]> {
    const servers = this.listServers().filter(s => s.enabled);
    for (const server of servers) await this.refreshTools(server.id);
    return this.listServers();
  }

  // ---------------------------------------------------------------- chat glue

  /**
   * Tool definitions for the agent loop, in the same shape as the DB tools.
   * Uses the cached tool list and refreshes any enabled server that has none.
   */
  async getEnabledTools(): Promise<Array<{ name: string; description: string; input_schema: object }>> {
    this.routes.clear();
    if (!this.isGlobalEnabled()) return [];

    const result: Array<{ name: string; description: string; input_schema: object }> = [];

    for (const server of this.listServers()) {
      if (!server.enabled) continue;

      // Discover tools the first time a server is used. A server that already
      // failed is not retried here, or every message would stall on its
      // connection timeout; the UI offers an explicit reload instead.
      let tools = server.tools;
      if (tools.length === 0 && !server.lastError) {
        const refreshed = await this.refreshTools(server.id);
        tools = refreshed.tools;
      }

      const disabled = new Set(server.disabledTools);
      for (const tool of tools) {
        if (disabled.has(tool.name)) continue;
        const wireName = qualify(server.name, tool.name);
        this.routes.set(wireName, { serverId: server.id, toolName: tool.name });
        result.push({
          name: wireName,
          description: `[${server.name}] ${tool.description}`.trim(),
          input_schema: tool.inputSchema || { type: 'object', properties: {} },
        });
      }
    }

    return result;
  }

  isMcpTool(name: string): boolean {
    return name.startsWith(TOOL_PREFIX);
  }

  /** Rebuild the wire-name routing table without touching the network. */
  private rebuildRoutes(): void {
    this.routes.clear();
    for (const server of this.listServers()) {
      for (const tool of server.tools) {
        this.routes.set(qualify(server.name, tool.name), { serverId: server.id, toolName: tool.name });
      }
    }
  }

  async callTool(wireName: string, args: any): Promise<{ success: boolean; result?: string; error?: string }> {
    if (!this.isGlobalEnabled()) return { success: false, error: 'MCP servers are disabled' };

    let route = this.routes.get(wireName);
    if (!route) {
      this.rebuildRoutes();
      route = this.routes.get(wireName);
    }
    if (!route) return { success: false, error: `Unknown MCP tool: ${wireName}` };

    const server = this.getServer(route.serverId);
    if (!server) return { success: false, error: 'MCP server no longer exists' };
    if (!server.enabled) return { success: false, error: `MCP server "${server.name}" is disabled` };

    try {
      const text = await this.clientFor(server).callTool(route.toolName, args);
      return { success: true, result: text };
    } catch (e: any) {
      this.dispose(server.id);
      return { success: false, error: `MCP tool "${wireName}" failed: ${e?.message || e}` };
    }
  }
}

let instance: McpService | null = null;

export function getMcpService(): McpService {
  if (!instance) instance = new McpService();
  return instance;
}
