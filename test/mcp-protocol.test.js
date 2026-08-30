const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const { HttpClient, collectHeaderBindings, encodeHeaderValue } = require('../dist/main/main/services/mcp/HttpClient.js');
const { StdioClient, formatToolResult } = require('../dist/main/main/services/mcp/StdioClient.js');
const {
  DEFAULT_TOOL_CACHE_MS,
  MIN_TOOL_CACHE_MS,
  isRecognizedModernError,
  isRecoverableCallError,
  mergeCacheHints,
  modernParams,
  selectKnownVersion,
  toolCacheTtl,
  forgetLegacyEra,
} = require('../dist/main/main/services/mcp/protocol.js');
const { McpError } = require('../dist/main/main/services/mcp/types.js');

test('version negotiation selects modern and legacy versions', () => {
  assert.deepEqual(selectKnownVersion(['2026-07-28']), { era: 'modern', version: '2026-07-28' });
  assert.deepEqual(selectKnownVersion(['2025-06-18']), { era: 'legacy', version: '2025-06-18' });
  assert.throws(() => selectKnownVersion(['2030-01-01']), /No mutually supported/);
  assert.equal(isRecognizedModernError(new McpError('future MCP error', -32099)), true);
  assert.equal(isRecognizedModernError(new McpError('JSON-RPC error', -32603)), false);
});

test('modern metadata uses the negotiated version', () => {
  const params = modernParams({ value: 1 }, '2026-09-01');
  assert.equal(params._meta['io.modelcontextprotocol/protocolVersion'], '2026-09-01');
  assert.equal(params.value, 1);
});

test('x-mcp-header validation accepts nullable primitives and ignores instance data', () => {
  const nullable = collectHeaderBindings({
    type: 'object',
    properties: {
      region: { type: ['string', 'null'], 'x-mcp-header': 'Region' },
      options: {
        type: 'object',
        default: { 'x-mcp-header': 'ordinary instance value' },
      },
    },
  });
  assert.equal(nullable.error, undefined);
  assert.equal(nullable.bindings.length, 1);

  const unreachable = collectHeaderBindings({
    type: 'object',
    anyOf: [{ type: 'object', properties: { id: { type: 'string', 'x-mcp-header': 'Id' } } }],
  });
  assert.match(unreachable.error, /not on a statically reachable property/);
});

test('header encoding follows the Base64 sentinel rules', () => {
  assert.equal(encodeHeaderValue('us-west1'), 'us-west1');
  assert.equal(encodeHeaderValue('Hello, café'), '=?base64?SGVsbG8sIGNhZsOp?=');
  assert.equal(encodeHeaderValue(' padded '), '=?base64?IHBhZGRlZCA=?=');
  assert.equal(encodeHeaderValue('line1\nline2'), '=?base64?bGluZTEKbGluZTI=?=');
  assert.equal(encodeHeaderValue('=?base64?literal?='), '=?base64?PT9iYXNlNjQ/bGl0ZXJhbD89?=');
});

test('tool resultType is validated and legacy omission means complete', () => {
  assert.equal(formatToolResult({ content: [{ type: 'text', text: 'legacy' }] }), 'legacy');
  assert.equal(formatToolResult({ resultType: 'complete', content: [{ type: 'text', text: 'modern' }] }), 'modern');
  assert.throws(
    () => formatToolResult({ resultType: 'input_required', inputRequests: { user: { method: 'elicitation/create' } } }),
    /requires additional client input.*elicitation\/create/,
  );
  assert.throws(() => formatToolResult({ resultType: 'future' }), /Unsupported MCP tool resultType/);
});

async function listen(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return { server, url: `http://127.0.0.1:${server.address().port}/mcp` };
}

/**
 * The era memo is keyed by URL and outlives a single mock server, and the OS
 * may hand the same port to a later test. Clear it so every test that means to
 * probe actually probes.
 */
function connect(url, legacySse = false) {
  forgetLegacyEra(`http:${url}`);
  return new HttpClient({ url, timeout: 2 }, legacySse);
}

async function readBody(request) {
  let body = '';
  for await (const chunk of request) body += chunk;
  return JSON.parse(body);
}

test('HeaderMismatch refreshes tools and retries once', async () => {
  let listCalls = 0;
  let toolCalls = 0;
  const mock = await listen(async (request, response) => {
    const message = await readBody(request);
    response.setHeader('content-type', 'application/json');
    if (message.method === 'server/discover') {
      return response.end(JSON.stringify({
        jsonrpc: '2.0', id: message.id,
        result: { resultType: 'complete', supportedVersions: ['2026-07-28'], capabilities: { tools: {} }, ttlMs: 1000, cacheScope: 'private' },
      }));
    }
    if (message.method === 'tools/list') {
      listCalls++;
      const header = listCalls === 1 ? 'Old-Region' : 'Region';
      return response.end(JSON.stringify({
        jsonrpc: '2.0', id: message.id,
        result: {
          resultType: 'complete', ttlMs: 1000, cacheScope: 'private',
          tools: [{ name: 'weather', inputSchema: { type: 'object', properties: { region: { type: 'string', 'x-mcp-header': header } } } }],
        },
      }));
    }
    if (message.method === 'tools/call') {
      toolCalls++;
      if (toolCalls === 1) {
        response.statusCode = 400;
        return response.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32020, message: 'Header mismatch' } }));
      }
      assert.equal(request.headers['mcp-param-region'], 'us-west1');
      return response.end(JSON.stringify({
        jsonrpc: '2.0', id: message.id,
        result: { resultType: 'complete', content: [{ type: 'text', text: 'ok' }] },
      }));
    }
    response.statusCode = 404;
    response.end();
  });

  const client = connect(mock.url);
  try {
    await client.listTools();
    assert.equal(await client.callTool('weather', { region: 'us-west1' }), 'ok');
    assert.equal(listCalls, 2);
    assert.equal(toolCalls, 2);
  } finally {
    await client.close();
    await new Promise(resolve => mock.server.close(resolve));
  }
});

test('UnsupportedProtocolVersion selects a legacy handshake version', async () => {
  const seen = [];
  const mock = await listen(async (request, response) => {
    const message = await readBody(request);
    seen.push({ message, headers: request.headers });
    response.setHeader('content-type', 'application/json');
    if (message.method === 'server/discover') {
      response.statusCode = 400;
      return response.end(JSON.stringify({
        jsonrpc: '2.0', id: message.id,
        error: { code: -32022, message: 'Unsupported protocol version', data: { supported: ['2025-06-18'] } },
      }));
    }
    if (message.method === 'initialize') {
      assert.equal(message.params.protocolVersion, '2025-06-18');
      response.setHeader('mcp-session-id', 'legacy-session');
      return response.end(JSON.stringify({
        jsonrpc: '2.0', id: message.id,
        result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'legacy', version: '1' } },
      }));
    }
    if (message.method === 'notifications/initialized') {
      response.statusCode = 202;
      response.removeHeader('content-type');
      return response.end();
    }
    if (message.method === 'tools/list') {
      return response.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { tools: [] } }));
    }
  });

  const client = connect(mock.url);
  try {
    assert.deepEqual((await client.listTools()).tools, []);
    const list = seen.find(item => item.message.method === 'tools/list');
    assert.equal(list.message.params._meta, undefined);
    assert.equal(list.headers['mcp-protocol-version'], '2025-06-18');
    assert.equal(list.headers['mcp-session-id'], 'legacy-session');
  } finally {
    await client.close();
    await new Promise(resolve => mock.server.close(resolve));
  }
});

test('HTTP 200 generic JSON-RPC errors do not trigger an era downgrade', async () => {
  const methods = [];
  const mock = await listen(async (request, response) => {
    const message = await readBody(request);
    methods.push(message.method);
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: 'server failure' } }));
  });

  const client = connect(mock.url);
  try {
    await assert.rejects(client.listTools(), /server failure/);
    assert.deepEqual(methods, ['server/discover']);
  } finally {
    await client.close();
    await new Promise(resolve => mock.server.close(resolve));
  }
});

test('stdio retries older legacy initialize versions', async () => {
  const serverScript = `
    process.stdin.setEncoding('utf8'); let buffer = '';
    const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
    process.stdin.on('data', chunk => { buffer += chunk; let index;
      while ((index = buffer.indexOf('\\n')) !== -1) {
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
        if (!line.trim()) continue; const message = JSON.parse(line);
        if (message.method === 'server/discover') send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'unknown' } });
        else if (message.method === 'initialize' && message.params.protocolVersion !== '2024-11-05') send({ jsonrpc: '2.0', id: message.id, error: { code: -32602, message: 'unsupported version' } });
        else if (message.method === 'initialize') send({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'old', version: '1' } } });
        else if (message.method === 'tools/list') send({ jsonrpc: '2.0', id: message.id, result: { tools: [{ name: 'echo', inputSchema: { type: 'object' } }] } });
      }
    });
  `;
  const client = new StdioClient({ command: process.execPath, args: ['-e', serverScript], timeout: 2 });
  try {
    assert.equal((await client.listTools()).tools[0].name, 'echo');
  } finally {
    await client.close();
  }
});

test('Streamable HTTP configuration falls back to legacy HTTP+SSE', async () => {
  let stream;
  const send = message => stream.write(`event: message\ndata: ${JSON.stringify(message)}\n\n`);
  const mock = await listen(async (request, response) => {
    if (request.method === 'GET' && request.url === '/mcp') {
      stream = response;
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write('event: endpoint\ndata: /messages\n\n');
      return;
    }
    if (request.method === 'POST' && request.url === '/mcp') {
      response.statusCode = 405;
      return response.end();
    }
    if (request.method === 'POST' && request.url === '/messages') {
      const message = await readBody(request);
      response.statusCode = 202;
      response.end();
      if (message.method === 'initialize') {
        send({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'sse', version: '1' } } });
      } else if (message.method === 'tools/list') {
        send({ jsonrpc: '2.0', id: message.id, result: { tools: [{ name: 'old_sse', inputSchema: { type: 'object' } }] } });
      }
      return;
    }
    response.statusCode = 404;
    response.end();
  });

  const client = connect(mock.url);
  try {
    assert.equal((await client.listTools()).tools[0].name, 'old_sse');
  } finally {
    await client.close();
    await new Promise(resolve => mock.server.close(resolve));
  }
});

test('cache hints fold across pages and get a sane freshness window', () => {
  const hints = {};
  mergeCacheHints(hints, { ttlMs: 300_000, cacheScope: 'public' });
  mergeCacheHints(hints, { ttlMs: 30_000, cacheScope: 'private' });
  assert.equal(hints.ttlMs, 30_000);
  assert.equal(hints.cacheScope, 'private');
  assert.equal(toolCacheTtl(hints.ttlMs), 30_000);

  // Absent is the client's choice; 0 and negatives are floored so a single
  // chat message cannot pay for several full tools/list walks.
  assert.equal(toolCacheTtl(undefined), DEFAULT_TOOL_CACHE_MS);
  const zero = {};
  mergeCacheHints(zero, { ttlMs: -1 });
  assert.equal(zero.ttlMs, 0);
  assert.equal(toolCacheTtl(zero.ttlMs), MIN_TOOL_CACHE_MS);
});

test('a modern server without server/discover stays modern', async () => {
  const seen = [];
  const mock = await listen(async (request, response) => {
    const message = await readBody(request);
    seen.push({ message, headers: request.headers });
    response.setHeader('content-type', 'application/json');
    if (message.method === 'server/discover') {
      response.statusCode = 404;
      return response.end(JSON.stringify({
        jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' },
      }));
    }
    response.end(JSON.stringify({
      jsonrpc: '2.0', id: message.id,
      result: {
        resultType: 'complete', ttlMs: 300_000, cacheScope: 'public',
        tools: [{ name: 'ping', inputSchema: { type: 'object' } }],
      },
    }));
  });

  const client = connect(mock.url);
  try {
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map(tool => tool.name), ['ping']);
    assert.equal(listed.ttlMs, 300_000);
    assert.equal(listed.cacheScope, 'public');

    // Discovery is optional for clients, so the server stays usable and modern.
    assert.equal(seen.some(item => item.message.method === 'initialize'), false);
    const list = seen.find(item => item.message.method === 'tools/list');
    assert.equal(list.message.params._meta['io.modelcontextprotocol/protocolVersion'], '2026-07-28');
    assert.equal(list.headers['mcp-protocol-version'], '2026-07-28');
    assert.equal(list.headers['mcp-method'], 'tools/list');
  } finally {
    await client.close();
    await new Promise(resolve => mock.server.close(resolve));
  }
});

test('a non-ASCII tool name is carried as a Base64 sentinel', async () => {
  let callHeaders;
  const mock = await listen(async (request, response) => {
    const message = await readBody(request);
    response.setHeader('content-type', 'application/json');
    if (message.method === 'server/discover') {
      return response.end(JSON.stringify({
        jsonrpc: '2.0', id: message.id,
        result: { resultType: 'complete', supportedVersions: ['2026-07-28'], capabilities: { tools: {} }, ttlMs: 1000 },
      }));
    }
    if (message.method === 'tools/list') {
      return response.end(JSON.stringify({
        jsonrpc: '2.0', id: message.id,
        result: { resultType: 'complete', ttlMs: 1000, tools: [{ name: 'météo', inputSchema: { type: 'object' } }] },
      }));
    }
    callHeaders = request.headers;
    response.end(JSON.stringify({
      jsonrpc: '2.0', id: message.id,
      result: { resultType: 'complete', content: [{ type: 'text', text: 'ok' }] },
    }));
  });

  const client = connect(mock.url);
  try {
    await client.listTools();
    assert.equal(await client.callTool('météo', {}), 'ok');
    assert.equal(callHeaders['mcp-name'], `=?base64?${Buffer.from('météo', 'utf8').toString('base64')}?=`);
  } finally {
    await client.close();
    await new Promise(resolve => mock.server.close(resolve));
  }
});

test('an input_required result fails without blaming the connection', async () => {
  const mock = await listen(async (request, response) => {
    const message = await readBody(request);
    response.setHeader('content-type', 'application/json');
    if (message.method === 'server/discover') {
      return response.end(JSON.stringify({
        jsonrpc: '2.0', id: message.id,
        result: { resultType: 'complete', supportedVersions: ['2026-07-28'], capabilities: { tools: {} }, ttlMs: 1000 },
      }));
    }
    if (message.method === 'tools/list') {
      return response.end(JSON.stringify({
        jsonrpc: '2.0', id: message.id,
        result: { resultType: 'complete', ttlMs: 1000, tools: [{ name: 'ask', inputSchema: { type: 'object' } }] },
      }));
    }
    response.end(JSON.stringify({
      jsonrpc: '2.0', id: message.id,
      result: { resultType: 'input_required', inputRequests: { who: { method: 'elicitation/create' } } },
    }));
  });

  const client = connect(mock.url);
  try {
    await client.listTools();
    const error = await client.callTool('ask', {}).then(() => null, e => e);
    assert.match(error.message, /elicitation\/create/);
    // A protocol result we cannot satisfy is not a broken connection, so the
    // caller must not tear the client down over it.
    assert.equal(isRecoverableCallError(error), true);
  } finally {
    await client.close();
    await new Promise(resolve => mock.server.close(resolve));
  }
});

test('a server that drops back to a legacy revision is re-handshaked', async () => {
  let modern = true;
  const seen = [];
  const mock = await listen(async (request, response) => {
    const message = await readBody(request);
    seen.push({ message, headers: request.headers });
    response.setHeader('content-type', 'application/json');

    if (message.method === 'server/discover') {
      if (!modern) {
        response.statusCode = 400;
        return response.end(JSON.stringify({
          jsonrpc: '2.0', id: message.id,
          error: { code: -32022, message: 'Unsupported protocol version', data: { supported: ['2025-06-18'] } },
        }));
      }
      return response.end(JSON.stringify({
        jsonrpc: '2.0', id: message.id,
        result: { resultType: 'complete', supportedVersions: ['2026-07-28'], capabilities: { tools: {} }, ttlMs: 1000 },
      }));
    }
    if (message.method === 'initialize') {
      return response.end(JSON.stringify({
        jsonrpc: '2.0', id: message.id,
        result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'downgraded', version: '1' } },
      }));
    }
    if (message.method === 'notifications/initialized') {
      response.statusCode = 202;
      response.removeHeader('content-type');
      return response.end();
    }
    if (message.method === 'tools/list') {
      if (modern) {
        // The deployment flips between the first and the second call.
        modern = false;
        response.statusCode = 400;
        return response.end(JSON.stringify({
          jsonrpc: '2.0', id: message.id,
          error: { code: -32022, message: 'Unsupported protocol version', data: { supported: ['2025-06-18'] } },
        }));
      }
      return response.end(JSON.stringify({
        jsonrpc: '2.0', id: message.id, result: { tools: [{ name: 'kept', inputSchema: { type: 'object' } }] },
      }));
    }
    response.statusCode = 404;
    response.end();
  });

  const client = connect(mock.url);
  try {
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map(tool => tool.name), ['kept']);
    // A legacy era carries no per-request metadata and no cache hints.
    const replay = seen.filter(item => item.message.method === 'tools/list').pop();
    assert.equal(replay.message.params._meta, undefined);
    assert.equal(replay.headers['mcp-protocol-version'], '2025-06-18');
    assert.equal(listed.ttlMs, undefined);
  } finally {
    await client.close();
    await new Promise(resolve => mock.server.close(resolve));
  }
});

test('a legacy era is remembered so the next client skips the probe', async () => {
  let discoverCalls = 0;
  const mock = await listen(async (request, response) => {
    const message = await readBody(request);
    if (message.method === 'server/discover') {
      discoverCalls++;
      response.statusCode = 400;
      return response.end('not an MCP endpoint');
    }
    response.setHeader('content-type', 'application/json');
    if (message.method === 'initialize') {
      return response.end(JSON.stringify({
        jsonrpc: '2.0', id: message.id,
        result: { protocolVersion: '2025-11-25', capabilities: {}, serverInfo: { name: 'legacy', version: '1' } },
      }));
    }
    if (message.method === 'notifications/initialized') {
      response.statusCode = 202;
      response.removeHeader('content-type');
      return response.end();
    }
    response.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { tools: [] } }));
  });

  const first = connect(mock.url);
  const second = new HttpClient({ url: mock.url, timeout: 2 }, false);
  try {
    await first.listTools();
    await second.listTools();
    assert.equal(discoverCalls, 1);
  } finally {
    await first.close();
    await second.close();
    await new Promise(resolve => mock.server.close(resolve));
  }
});

test('a slow server/discover does not demote a modern server', async () => {
  const methods = [];
  let stalled;
  const mock = await listen(async (request, response) => {
    const message = await readBody(request);
    methods.push(message.method);
    // The probe is capped well below the request timeout, so a cold start must
    // not be mistaken for a legacy server.
    if (message.method === 'server/discover') {
      stalled = response;
      return;
    }
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({
      jsonrpc: '2.0', id: message.id,
      result: { resultType: 'complete', ttlMs: 1000, tools: [{ name: 'slow', inputSchema: { type: 'object' } }] },
    }));
  });

  const client = connect(mock.url);
  try {
    assert.equal((await client.listTools()).tools[0].name, 'slow');
    assert.deepEqual(methods, ['server/discover', 'tools/list']);
  } finally {
    await client.close();
    stalled?.destroy();
    mock.server.closeAllConnections();
    await new Promise(resolve => mock.server.close(resolve));
  }
});

test('an era change mid-pagination restarts the listing', async () => {
  let modern = true;
  const pages = { '2026-07-28': [], '2025-06-18': [] };
  const mock = await listen(async (request, response) => {
    const message = await readBody(request);
    response.setHeader('content-type', 'application/json');
    const fail = () => {
      response.statusCode = 400;
      response.end(JSON.stringify({
        jsonrpc: '2.0', id: message.id,
        error: { code: -32022, message: 'Unsupported protocol version', data: { supported: ['2025-06-18'] } },
      }));
    };

    if (message.method === 'server/discover') {
      if (!modern) return fail();
      return response.end(JSON.stringify({
        jsonrpc: '2.0', id: message.id,
        result: { resultType: 'complete', supportedVersions: ['2026-07-28'], capabilities: { tools: {} }, ttlMs: 1000 },
      }));
    }
    if (message.method === 'initialize') {
      return response.end(JSON.stringify({
        jsonrpc: '2.0', id: message.id,
        result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'downgraded', version: '1' } },
      }));
    }
    if (message.method === 'notifications/initialized') {
      response.statusCode = 202;
      response.removeHeader('content-type');
      return response.end();
    }
    if (message.method === 'tools/list') {
      const version = request.headers['mcp-protocol-version'];
      pages[version].push(message.params.cursor);
      // The deployment flips while the client is asking for the second page.
      if (modern && message.params.cursor) {
        modern = false;
        return fail();
      }
      const first = !message.params.cursor;
      return response.end(JSON.stringify({
        jsonrpc: '2.0', id: message.id,
        result: {
          tools: [{ name: `${version}-${first ? 'a' : 'b'}`, inputSchema: { type: 'object' } }],
          nextCursor: first ? 'page-2' : undefined,
        },
      }));
    }
    response.statusCode = 404;
    response.end();
  });

  const client = connect(mock.url);
  try {
    const listed = await client.listTools();
    // Only whole listings from one revision, never a mix of the two.
    assert.deepEqual(listed.tools.map(tool => tool.name), ['2025-06-18-a', '2025-06-18-b']);
    assert.deepEqual(pages['2025-06-18'], [undefined, 'page-2']);
  } finally {
    await client.close();
    await new Promise(resolve => mock.server.close(resolve));
  }
});
