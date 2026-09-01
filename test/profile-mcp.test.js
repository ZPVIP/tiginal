const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createMcpProfileSnapshot,
  isMcpStatusActive,
  parseStoredMcpProfile,
} = require('../dist/main/shared/profile-mcp.js');

test('treats a missing MCP snapshot as unmanaged', () => {
  assert.deepEqual(parseStoredMcpProfile(null), { kind: 'unmanaged' });
  assert.deepEqual(parseStoredMcpProfile(undefined), { kind: 'unmanaged' });
});

test('parses and normalizes a managed MCP snapshot', () => {
  assert.deepEqual(parseStoredMcpProfile(JSON.stringify({
    version: 1,
    global_enabled: true,
    servers: [
      { id: 'server-b', disabled_tools: ['write', 'write', 'read'] },
      { id: 'server-a', disabled_tools: [] },
      { id: 'server-b', disabled_tools: ['ignored-duplicate-server'] },
    ],
  })), {
    kind: 'managed',
    snapshot: {
      version: 1,
      global_enabled: true,
      servers: [
        { id: 'server-b', disabled_tools: ['write', 'read'] },
        { id: 'server-a', disabled_tools: [] },
      ],
    },
  });
});

test('rejects malformed or unsupported MCP snapshots', () => {
  assert.throws(() => parseStoredMcpProfile('{not-json'), /Invalid MCP profile snapshot/);
  assert.throws(() => parseStoredMcpProfile({ version: 2, global_enabled: true, servers: [] }), /Invalid MCP profile snapshot/);
  assert.throws(() => parseStoredMcpProfile({ version: 1, global_enabled: 'yes', servers: [] }), /Invalid MCP profile snapshot/);
});

test('marks MCP active only when global MCP and a server are enabled', () => {
  assert.equal(isMcpStatusActive({ globalEnabled: true, enabledServerCount: 1 }), true);
  assert.equal(isMcpStatusActive({ globalEnabled: true, enabledServerCount: 0 }), false);
  assert.equal(isMcpStatusActive({ globalEnabled: false, enabledServerCount: 2 }), false);
});

test('stores an explicit disabled MCP state instead of making the profile unmanaged', () => {
  assert.deepEqual(createMcpProfileSnapshot({
    globalEnabled: false,
    enabledServerIds: ['server-a'],
    disabledToolsByServer: { 'server-a': ['write'] },
  }), {
    version: 1,
    global_enabled: false,
    servers: [{ id: 'server-a', disabled_tools: ['write'] }],
  });
});

test('normalizes a draft snapshot so duplicate tool selections collapse', () => {
  assert.deepEqual(createMcpProfileSnapshot({
    globalEnabled: true,
    enabledServerIds: new Set(['server-a', 'server-b']),
    disabledToolsByServer: { 'server-a': ['write', 'write'], 'server-c': ['unused'] },
  }), {
    version: 1,
    global_enabled: true,
    servers: [
      { id: 'server-a', disabled_tools: ['write'] },
      { id: 'server-b', disabled_tools: [] },
    ],
  });
});

test('a disabled draft round-trips as managed so applying it turns MCP off', () => {
  const snapshot = createMcpProfileSnapshot({
    globalEnabled: false,
    enabledServerIds: [],
    disabledToolsByServer: {},
  });
  assert.deepEqual(parseStoredMcpProfile(JSON.stringify(snapshot)), { kind: 'managed', snapshot });
});
