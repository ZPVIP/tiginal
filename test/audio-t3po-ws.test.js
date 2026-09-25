const assert = require('node:assert/strict');
const test = require('node:test');
const { WebSocketServer } = require('ws');

const {
  createT3POTranslator,
  t3poDirection,
  t3poTerms,
  testT3POConnection,
  T3POWebSocketTranslator,
} = require('../dist/main/main/audio/T3POWebSocketTranslator.js');

// Mirrors T3PO-ws: every wait or translation event is followed by metrics, and `stats` is answered with metrics.
function sendEvent(socket, event) {
  socket.send(JSON.stringify(event));
  socket.send(JSON.stringify({ type: 'metrics', stats: {} }));
}

async function fakeT3PO(onMessage) {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise(resolve => server.once('listening', resolve));
  const requests = [];
  server.on('connection', (socket, request) => {
    requests.push(request.url);
    // The real server handles one message at a time, so replies stay in request order.
    let queue = Promise.resolve();
    socket.on('message', data => {
      const message = JSON.parse(data.toString());
      queue = queue.then(async () => {
        if (message.type === 'stats') socket.send(JSON.stringify({ type: 'metrics', stats: {} }));
        else await onMessage(socket, message);
      });
    });
  });
  const { port } = server.address();
  return {
    endpoint: `ws://127.0.0.1:${port}/ws/translate`,
    requests,
    close: () => new Promise(resolve => server.close(resolve)),
  };
}

function t3poProvider(endpoint, options = {}) {
  return {
    id: 't3po-1',
    name: 'Local T3PO',
    protocol: 't3po',
    endpoint,
    authMode: 'query-token',
    hasCredential: true,
    builtInKind: null,
    userModified: true,
    maxSessionSeconds: null,
    defaultLanguage: 'zh',
    options: {
      bookedWords: [],
      smooth: false,
      mode: 'slow',
      systemPrompt: '',
      latencyMode: 'high',
      terminology: ['large language model=LLM'],
      ...options,
    },
    createdAt: 1,
    updatedAt: 1,
  };
}

test('T3PO direction follows the Chinese and English language pair', () => {
  assert.equal(t3poDirection('zh', 'en'), 'zh2en');
  assert.equal(t3poDirection('auto', 'en'), 'zh2en');
  assert.equal(t3poDirection('en-US', 'zh'), 'en2zh');
  assert.throws(() => t3poDirection('ja', 'en'), /only between Chinese and English/);
  assert.throws(() => t3poDirection('zh', 'fr'), /only between Chinese and English/);
});

test('T3PO terms parse source=target entries and keep single terms unchanged', () => {
  assert.deepEqual(
    t3poTerms(['large language model = LLM', 'Tiginal', 'Tiginal=Other', { source: 'R2T2', target: 'R2T2' }, '=', '']),
    [
      { src: 'large language model', trg: 'LLM' },
      { src: 'Tiginal', trg: 'Tiginal' },
      { src: 'R2T2', trg: 'R2T2' },
    ],
  );
  assert.equal(t3poTerms(Array.from({ length: 250 }, (_, index) => `term${index}`)).length, 200);
});

test('T3PO translator speaks the /ws/translate protocol and appends segments', async () => {
  const received = [];
  const server = await fakeT3PO((socket, message) => {
    received.push(message);
    if (message.type === 'init') {
      socket.send(JSON.stringify({ type: 'init_ok', direction: message.direction, latency_mode: message.latency_mode }));
    } else if (message.type === 'text' && message.text === 'good') {
      sendEvent(socket, { type: 'wait', source_units: 1 });
    } else if (message.type === 'text') {
      sendEvent(socket, { type: 'translation', source: 'good morning', text: 'first', source_units: 2 });
    } else if (message.type === 'end') {
      sendEvent(socket, { type: 'translation', source: 'everyone', text: 'second', source_units: 1 });
      socket.send(JSON.stringify({ type: 'ended', stats: {} }));
      socket.close(1000, 'translation complete');
    }
  });
  const events = [];
  try {
    const translator = createT3POTranslator(t3poProvider(server.endpoint), 'local-token', {
      sourceLanguage: 'en',
      targetLanguage: 'zh',
      terminology: ['Tiginal'],
      onEvent: event => events.push(event),
    });
    translator.pushCommittedText('good');
    await new Promise(resolve => setTimeout(resolve, 50));
    translator.pushCommittedText(' morning');
    const result = await translator.flush();

    assert.equal(result, 'firstsecond');
    assert.equal(new URL(server.requests[0], 'ws://localhost').searchParams.get('token'), 'local-token');
    assert.deepEqual(received, [
      {
        type: 'init',
        direction: 'en2zh',
        latency_mode: 'high',
        terms: [{ src: 'large language model', trg: 'LLM' }, { src: 'Tiginal', trg: 'Tiginal' }],
      },
      { type: 'text', text: 'good' },
      { type: 'text', text: ' morning' },
      { type: 'end' },
    ]);
    assert.equal(received.length, 4);
    assert.deepEqual(events.filter(event => event.kind === 'trans').map(event => event.fullTranslation), ['first', 'firstsecond']);
    assert.equal(events.some(event => event.kind === 'wait' && event.currentInput.startsWith('good')), true);
    assert.equal(events.at(-1).kind, 'complete');
    assert.equal(events.some(event => event.kind === 'error'), false);
  } finally {
    await server.close();
  }
});

test('T3PO translator joins English segments with spaces and honors a session latency override', async () => {
  let init;
  const server = await fakeT3PO((socket, message) => {
    if (message.type === 'init') {
      init = message;
      socket.send(JSON.stringify({ type: 'init_ok' }));
    } else if (message.type === 'text') {
      sendEvent(socket, { type: 'translation', source: message.text, text: 'Good morning,', source_units: 2 });
    } else if (message.type === 'end') {
      sendEvent(socket, { type: 'translation', source: 'rest', text: 'everyone.', source_units: 1 });
      socket.send(JSON.stringify({ type: 'ended' }));
      socket.close(1000);
    }
  });
  try {
    const translator = createT3POTranslator(t3poProvider(server.endpoint), null, {
      sourceLanguage: 'zh',
      targetLanguage: 'en',
      latencyMode: 'low',
    });
    translator.pushCommittedText('source text');
    assert.equal(await translator.flush(), 'Good morning, everyone.');
    assert.equal(init.direction, 'zh2en');
    assert.equal(init.latency_mode, 'low');
  } finally {
    await server.close();
  }
});

test('T3PO server errors reject the flush and surface the server code', async () => {
  const server = await fakeT3PO(socket => {
    socket.send(JSON.stringify({ type: 'error', code: 'BUSY', message: 'another translation session is active' }));
    socket.close(1013, 'BUSY');
  });
  const events = [];
  try {
    const translator = new T3POWebSocketTranslator({
      endpoint: server.endpoint,
      token: null,
      direction: 'zh2en',
      latencyMode: 'native',
      terms: [],
      onEvent: event => events.push(event),
    });
    await assert.rejects(() => translator.flush(), /BUSY: another translation session is active/);
    assert.equal(events.filter(event => event.kind === 'error').length, 1);
  } finally {
    await server.close();
  }
});

test('T3PO connection test initializes and ends an empty session', async () => {
  const types = [];
  const server = await fakeT3PO((socket, message) => {
    types.push(message.type);
    if (message.type === 'init') socket.send(JSON.stringify({ type: 'init_ok' }));
    if (message.type === 'end') {
      socket.send(JSON.stringify({ type: 'ended' }));
      socket.close(1000);
    }
  });
  try {
    await testT3POConnection(t3poProvider(server.endpoint), 'token');
    assert.deepEqual(types, ['init', 'end']);
  } finally {
    await server.close();
  }
});

test('T3PO translator merges text while the server is busy so the end is never stuck behind a backlog', async () => {
  const texts = [];
  let endReceivedAt = 0;
  const server = await fakeT3PO(async (socket, message) => {
    if (message.type === 'init') socket.send(JSON.stringify({ type: 'init_ok' }));
    if (message.type === 'text') {
      texts.push(message.text);
      // Each model decision takes longer than the gap between ASR updates.
      await new Promise(resolve => setTimeout(resolve, 150));
      sendEvent(socket, { type: 'wait', source_units: texts.length });
    }
    if (message.type === 'end') {
      endReceivedAt = Date.now();
      sendEvent(socket, { type: 'translation', source: texts.join(''), text: 'done', source_units: 1 });
      socket.send(JSON.stringify({ type: 'ended' }));
      socket.close(1000);
    }
  });
  try {
    const translator = createT3POTranslator(t3poProvider(server.endpoint), null, {
      sourceLanguage: 'en',
      targetLanguage: 'zh',
    });
    const words = Array.from({ length: 20 }, (_, index) => `w${index} `);
    for (const word of words) {
      translator.pushCommittedText(word);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    const stoppedAt = Date.now();
    assert.equal(await translator.flush(), 'done');

    assert.equal(texts.join(''), words.join(''));
    assert.ok(texts.length <= 5, `expected merged text, got ${texts.length} messages`);
    // Without flow control the end would wait behind about 20 decisions of 150 ms each.
    assert.ok(endReceivedAt - stoppedAt < 400, `end waited ${endReceivedAt - stoppedAt} ms`);
  } finally {
    await server.close();
  }
});

test('T3PO translator keeps going when the server sends no event for a text message', async () => {
  const texts = [];
  const server = await fakeT3PO((socket, message) => {
    if (message.type === 'init') socket.send(JSON.stringify({ type: 'init_ok' }));
    // T3PO-ws stays silent while zh2en input ends inside an English word.
    if (message.type === 'text') texts.push(message.text);
    if (message.type === 'end') {
      sendEvent(socket, { type: 'translation', source: texts.join(''), text: 'Tiginal', source_units: 1 });
      socket.send(JSON.stringify({ type: 'ended' }));
      socket.close(1000);
    }
  });
  try {
    const translator = createT3POTranslator(t3poProvider(server.endpoint), null, {
      sourceLanguage: 'zh',
      targetLanguage: 'en',
    });
    translator.pushCommittedText('Tigi');
    await new Promise(resolve => setTimeout(resolve, 50));
    translator.pushCommittedText('nal');
    assert.equal(await translator.flush(), 'Tiginal');
    assert.deepEqual(texts, ['Tigi', 'nal']);
  } finally {
    await server.close();
  }
});
