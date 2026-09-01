const assert = require('node:assert/strict');
const test = require('node:test');
// The app's better-sqlite3 is built for Electron's ABI, so plain `node` cannot
// load it. Node's own SQLite has the same prepare/run/get/all surface.
const { DatabaseSync } = require('node:sqlite');

// McpService reaches for the app database singleton, which wants Electron's
// app paths. Swap in an in-memory database before the module is loaded.
const databaseModule = require.resolve('../dist/main/services/database/database.js');
const db = new DatabaseSync(':memory:');
db.exec(`
  CREATE TABLE mcp_servers (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    type TEXT NOT NULL DEFAULT 'stdio',
    description TEXT,
    config TEXT NOT NULL DEFAULT '{}',
    is_builtin INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 0,
    disabled_tools TEXT NOT NULL DEFAULT '[]',
    tools_cache TEXT,
    last_error TEXT,
    rank INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
`);
const settings = new Map();
require.cache[databaseModule] = {
  id: databaseModule,
  filename: databaseModule,
  loaded: true,
  exports: {
    getDatabase: () => ({
      getDb: () => db,
      getSetting: key => (settings.has(key) ? settings.get(key) : null),
      setSetting: (key, value) => settings.set(key, value),
    }),
  },
};

const { McpService } = require('../dist/main/main/services/mcp/McpService.js');
const { McpClientError, McpTimeoutError } = require('../dist/main/main/services/mcp/types.js');

const TOOL = { name: 'echo', description: 'echo', inputSchema: { type: 'object' } };

function addServer(id, toolsCache = null) {
  db.prepare('DELETE FROM mcp_servers').run();
  const now = Date.now();
  db.prepare(`
    INSERT INTO mcp_servers (id, name, type, description, config, is_builtin, enabled, disabled_tools, tools_cache, rank, created_at, updated_at)
    VALUES (?, ?, 'streamableHttp', '', '{"type":"streamableHttp","url":"http://example.invalid/mcp"}', 0, 1, '[]', ?, 0, ?, ?)
  `).run(id, id, toolsCache, now, now);
}

/**
 * A service wired to a stub transport. `clientFor` and `dispose` are private to
 * TypeScript only, so the test can stand in for both and watch what the cache
 * logic actually asks of the connection.
 */
function serviceWith(client) {
  const service = new McpService();
  const calls = { list: 0, disposed: 0 };
  service.clientFor = () => ({
    listTools: async () => { calls.list++; return client.listTools(); },
    callTool: (...args) => client.callTool(...args),
    close: async () => undefined,
  });
  service.dispose = () => { calls.disposed++; };
  return { service, calls };
}

test('http configs are stored as streamableHttp', () => {
  db.prepare('DELETE FROM mcp_servers').run();
  const service = new McpService();

  const server = service.saveServer({
    name: 'remote',
    config: { type: 'http', url: 'http://localhost:3000/mcp' },
  });

  assert.equal(server.type, 'streamableHttp');
  assert.equal(server.config.type, 'streamableHttp');
});

test('the single-server editor accepts a full mcpServers wrapper', () => {
  db.prepare('DELETE FROM mcp_servers').run();
  const service = new McpService();

  const server = service.saveServer({
    name: '',
    config: {
      mcpServers: {
        pelco: {
          type: 'http',
          url: 'http://localhost:3000/mcp',
          headers: { Authorization: 'Bearer test-token' },
        },
      },
    },
  });

  assert.equal(server.name, 'pelco');
  assert.deepEqual(server.config, {
    type: 'streamableHttp',
    url: 'http://localhost:3000/mcp',
    headers: { Authorization: 'Bearer test-token' },
  });
});

test('MCP import normalizes the http transport alias', () => {
  db.prepare('DELETE FROM mcp_servers').run();
  const service = new McpService();

  const result = service.importJson(JSON.stringify({
    mcpServers: {
      remote: { type: 'http', url: 'http://localhost:3000/mcp' },
    },
  }));

  assert.deepEqual(result, { added: 1, updated: 0, skipped: [] });
  const server = service.listServers()[0];
  assert.equal(server.type, 'streamableHttp');
  assert.equal(server.config.type, 'streamableHttp');
});

test('a fetched tool list is reused until its TTL expires', async () => {
  addServer('ttl');
  const { service, calls } = serviceWith({ listTools: async () => ({ tools: [TOOL], ttlMs: 60_000 }) });

  assert.equal((await service.getEnabledTools()).length, 1);
  assert.equal(calls.list, 1);
  assert.equal((await service.getEnabledTools()).length, 1);
  assert.equal(calls.list, 1, 'a fresh cache must not be re-fetched');

  const cache = JSON.parse(db.prepare('SELECT tools_cache AS c FROM mcp_servers').get().c);
  assert.ok(cache.expiresAt > Date.now());
  db.prepare('UPDATE mcp_servers SET tools_cache = ?')
    .run(JSON.stringify({ ...cache, expiresAt: Date.now() - 1 }));

  assert.equal((await service.getEnabledTools()).length, 1);
  assert.equal(calls.list, 2, 'a stale cache must be re-fetched');
});

test('an empty tool list is not re-fetched on every message', async () => {
  addServer('empty');
  const { service, calls } = serviceWith({ listTools: async () => ({ tools: [] }) });

  assert.equal((await service.getEnabledTools()).length, 0);
  assert.equal((await service.getEnabledTools()).length, 0);
  assert.equal(calls.list, 1, 'an empty list is a real answer, not a missing cache');
});

test('an array-shaped cache is migrated once', async () => {
  addServer('legacy-cache', JSON.stringify([TOOL]));
  const { service, calls } = serviceWith({ listTools: async () => ({ tools: [TOOL], ttlMs: 60_000 }) });

  assert.equal((await service.getEnabledTools()).length, 1);
  assert.equal(calls.list, 1, 'rows without cache hints refresh once');
  assert.equal((await service.getEnabledTools()).length, 1);
  assert.equal(calls.list, 1);
});

test('a rejected tool does not read as a server error', async () => {
  addServer('warned');
  const { service } = serviceWith({
    listTools: async () => ({ tools: [TOOL], ttlMs: 60_000, warnings: ['Ignoring invalid tool "bad": duplicate x-mcp-header name "A"'] }),
  });

  const server = await service.refreshTools('warned');
  assert.equal(server.lastError, null);
  assert.deepEqual(server.warnings, ['Ignoring invalid tool "bad": duplicate x-mcp-header name "A"']);
  assert.equal(server.tools.length, 1);
});

test('only a broken connection is torn down after a failed tool call', async () => {
  addServer('calls');
  let failure = new McpClientError('arguments rejected before sending');
  const { service, calls } = serviceWith({
    listTools: async () => ({ tools: [TOOL], ttlMs: 60_000 }),
    callTool: async () => { throw failure; },
  });

  const [tool] = await service.getEnabledTools();
  assert.equal((await service.callTool(tool.name, {})).success, false);
  assert.equal(calls.disposed, 0, 'a client-side rejection leaves the connection usable');

  failure = new McpTimeoutError('MCP request "tools/call" timed out after 60s');
  assert.equal((await service.callTool(tool.name, {})).success, false);
  assert.equal(calls.disposed, 1, 'a dead connection has to be rebuilt');
});
