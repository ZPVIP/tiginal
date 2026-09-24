const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { WebSocketServer } = require('ws');

const { AudioService } = require('../dist/main/main/audio/AudioService.js');
const {
  SpeechStreamClient,
  testSpeechConnection,
} = require('../dist/main/main/audio/SpeechStreamClient.js');

const options = {
  bookedWords: [],
  useVad: true,
  smooth: true,
  mode: 'slow',
  systemPrompt: '',
};

async function fakeServer(connectionHandler) {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  server.on('connection', connectionHandler);
  return {
    server,
    endpoint: `ws://127.0.0.1:${server.address().port}/asr`,
  };
}

function closeServer(server) {
  return new Promise(resolve => server.close(resolve));
}

function provider(endpoint) {
  return {
    id: 'fake-rstream',
    name: 'Fake R2T2',
    protocol: 'r2t2-rstream',
    endpoint,
    authMode: 'query-token',
    hasCredential: true,
    builtInKind: null,
    userModified: true,
    maxSessionSeconds: null,
    defaultLanguage: 'en',
    options,
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
  };
}

function eventWithin(register, timeoutMs = 3_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for audio event')), timeoutMs);
    register(value => {
      clearTimeout(timer);
      resolve(value);
    });
  });
}

test('fake rstream server receives PCM and returns stable transcript prefixes', async () => {
  const messages = [];
  const mock = await fakeServer(socket => {
    socket.on('message', (data, isBinary) => {
      if (isBinary) {
        messages.push({ kind: 'audio', bytes: data.length });
        socket.send(JSON.stringify({ msg: { text: 'hello' } }));
        socket.send(JSON.stringify({ msg: { text: 'hello world' } }));
        return;
      }
      const text = data.toString();
      if (text === 'YOUDAO_ASR_EOS') {
        messages.push({ kind: 'eos', text });
        socket.send(JSON.stringify({ final: true }));
      } else {
        messages.push({ kind: 'opening', value: JSON.parse(text) });
        socket.send(JSON.stringify({ status: 'connected' }));
      }
    });
  });

  const events = [];
  const client = new SpeechStreamClient(provider(mock.endpoint), 'local-token', event => events.push(event));
  try {
    await client.connect('en');
    await client.waitForProtocolReady();
    client.sendFrame(new Int16Array(2560).fill(25));
    await client.finish();

    assert.equal(messages[0].kind, 'opening');
    assert.equal(messages[0].value.lang, 'en');
    assert.deepEqual(messages.slice(1).map(message => message.kind), ['audio', 'eos']);
    assert.equal(messages[1].bytes, 5120);
    assert.deepEqual(events.filter(event => event.kind === 'committed').map(event => event.fullText), [
      'hello',
      'hello world',
    ]);
    assert.deepEqual(events.at(-1), { kind: 'final', text: 'hello world' });
  } finally {
    client.close();
    await closeServer(mock.server);
  }
});

test('connection test sends PCM before waiting for an rstream response', async () => {
  let audioFrames = 0;
  let receivedEos = false;
  const mock = await fakeServer(socket => {
    socket.on('message', (data, isBinary) => {
      if (isBinary) {
        audioFrames += 1;
        if (audioFrames >= 2) {
          socket.send(JSON.stringify({ delta_text: '', audio_ms: audioFrames * 160 }));
        }
        return;
      }
      if (data.toString() === 'YOUDAO_ASR_EOS') {
        receivedEos = true;
        socket.send(JSON.stringify({ is_final: true }));
      }
    });
  });

  try {
    await testSpeechConnection(provider(mock.endpoint), 'local-token');
    assert.equal(audioFrames, 3);
    assert.equal(receivedEos, true);
  } finally {
    await closeServer(mock.server);
  }
});

test('AudioService keeps a finalized WAV after the recognition socket disconnects', async () => {
  const mock = await fakeServer(socket => {
    socket.on('message', (_data, isBinary) => {
      if (isBinary) {
        socket.terminate();
      } else {
        socket.send(JSON.stringify({ status: 'connected' }));
      }
    });
  });
  const recordingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'tiginal-audio-disconnect-'));
  const statuses = [];
  const repository = {
    insert(record) { statuses.push({ kind: 'insert', record }); },
    updateStatus(id, status, durationMs) { statuses.push({ kind: 'status', id, status, durationMs }); },
    updateTranscript() {},
  };
  const speechProvider = provider(mock.endpoint);
  const providers = {
    require() { return { provider: speechProvider, credential: 'local-token' }; },
  };
  const service = new AudioService(providers, repository, recordingDirectory);
  let deliverEvent;
  const failedEvent = eventWithin(resolve => { deliverEvent = resolve; });

  try {
    const session = await service.createSession(
      { providerId: speechProvider.id, language: 'en' },
      event => {
        if (event.kind === 'failed') deliverEvent(event);
      },
    );
    service.pushPcmFrame(session.id, new Int16Array(2560).fill(50));
    const failure = await failedEvent;

    assert.equal(failure.kind, 'failed');
    assert.equal(failure.recordingPath, session.recordingPath);
    assert.equal(fs.existsSync(session.recordingPath), true);
    assert.equal(fs.existsSync(`${session.recordingPath}.part`), false);
    const wav = fs.readFileSync(session.recordingPath);
    assert.equal(wav.readUInt32LE(40), 5120);
    assert.equal(wav.length, 5164);
    assert.equal(statuses.some(item => item.kind === 'status' && item.status === 'failed'), true);
  } finally {
    await service.disposeAll();
    await closeServer(mock.server);
  }
});

test('SpeechStreamClient T3PO protocol error labeling', async () => {

  const t3poProvider = {
    id: 't3po-test',
    name: 'T3PO Test',
    protocol: 't3po-rstream',
    endpoint: 'ws://127.0.0.1:59999/non-existent',
    authMode: 'none',
    hasCredential: false,
    builtInKind: null,
    userModified: true,
    maxSessionSeconds: null,
    defaultLanguage: 'en',
    options,
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
  };

  const client = new SpeechStreamClient(t3poProvider, null, () => undefined);
  await assert.rejects(
    () => client.connect('en'),
    /T3PO connection failed:/
  );
});

test('AudioService does not create WAV file when source is file', async () => {
  const mock = await fakeServer(ws => {
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      const text = data.toString();
      if (text === 'YOUDAO_ASR_EOS') {
        ws.send(JSON.stringify({ final: true }));
      } else {
        ws.send(JSON.stringify({ status: 'connected' }));
      }
    });
  });

  const recordingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'tiginal-audio-file-'));
  const statuses = [];
  const repository = {
    insert(record) { statuses.push({ kind: 'insert', record }); },
    updateStatus(id, status, durationMs) { statuses.push({ kind: 'status', id, status, durationMs }); },
    updateTranscript() {},
  };
  const speechProvider = provider(mock.endpoint);
  const providers = {
    require() { return { provider: speechProvider, credential: 'local-token' }; },
  };
  const service = new AudioService(providers, repository, recordingDirectory);
  let completedEvent;
  const donePromise = eventWithin(resolve => { completedEvent = resolve; });

  try {
    const session = await service.createSession(
      {
        providerId: speechProvider.id,
        language: 'en',
        source: { kind: 'file', name: 'uploaded-speech.mp3' },
      },
      event => {
        if (event.kind === 'completed') completedEvent(event);
      },
    );

    assert.equal(session.recordingPath, null);
    assert.equal(fs.readdirSync(recordingDirectory).length, 0);

    // Push 1600 samples = 100ms at 16kHz
    service.pushPcmFrame(session.id, new Int16Array(1600).fill(100));
    await service.finishSession(session.id);

    const completed = await donePromise;
    assert.equal(completed.recordingPath, null);
    assert.equal(completed.durationMs, 100);
    // Crucial check: No file should exist in the audios directory
    assert.equal(fs.readdirSync(recordingDirectory).length, 0);
  } finally {
    await service.disposeAll();
    await closeServer(mock.server);
    fs.rmSync(recordingDirectory, { recursive: true, force: true });
  }
});

