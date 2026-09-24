const assert = require('node:assert/strict');
const test = require('node:test');

const {
  R2T2_NATIVE_EOS,
  R2T2_RSTREAM_EOS,
} = require('../dist/main/shared/audio/r2t2.js');
const { R2T2NativeAdapter } = require('../dist/main/main/audio/protocols/R2T2NativeAdapter.js');
const { R2T2RStreamAdapter } = require('../dist/main/main/audio/protocols/R2T2RStreamAdapter.js');

const options = {
  bookedWords: ['Tiginal'],
  useVad: true,
  smooth: true,
  mode: 'slow',
  systemPrompt: 'Technical meeting',
};

function provider(protocol, endpoint) {
  return {
    id: 'provider-1',
    name: 'Test Provider',
    protocol,
    endpoint,
    authMode: protocol === 'r2t2-native' ? 'handshake-secret' : 'query-token',
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

test('rstream adapter keeps credentials in the URL and emits stable prefixes', () => {
  const adapter = new R2T2RStreamAdapter();
  const url = adapter.buildUrl(provider('r2t2-rstream', 'wss://example.com/asr'), 'secret value');
  assert.equal(url.searchParams.get('t'), 'secret value');
  assert.equal(adapter.eosMarker(), R2T2_RSTREAM_EOS);
  assert.equal(adapter.tailSilenceSamples(), 0);

  assert.deepEqual(JSON.parse(adapter.buildOpeningMessage({
    requestId: 'request-1',
    language: 'zh',
    credential: 'secret value',
    options,
  })), {
    lang: 'cn',
    booked_words: 'Technical words: Tiginal',
    use_vad: true,
    smooth: true,
    requestId: 'request-1',
  });

  const state = { committedText: '', partialText: '' };
  assert.deepEqual(adapter.readMessage('{"status":"connected"}', state), [{ kind: 'connected' }]);
  assert.deepEqual(adapter.readMessage('{"msg":{"text":"hello","partial":"hello w"}}', state), [
    { kind: 'committed', text: 'hello', fullText: 'hello' },
    { kind: 'partial', text: 'hello w' },
  ]);
  assert.deepEqual(adapter.readMessage('{"msg":{"text":"hello world"},"final":true}', state), [
    { kind: 'committed', text: ' world', fullText: 'hello world' },
    { kind: 'partial', text: '' },
    { kind: 'final', text: 'hello world' },
  ]);
});

test('rstream adapter parses the current demo response envelope without exposing raw JSON', () => {
  const adapter = new R2T2RStreamAdapter();
  const state = { committedText: '', partialText: '' };

  assert.deepEqual(adapter.readMessage(JSON.stringify({
    text: JSON.stringify([{ partial: false, sentence: '' }]),
    delta_text: '',
    is_final: false,
    reset: false,
    language: 'cn',
    chunk_id: 0,
    audio_ms: 320,
  }), state), [
    { kind: 'metrics', ackedSamples: 5120, serverBufferedMs: undefined },
  ]);

  assert.deepEqual(adapter.readMessage(JSON.stringify({
    text: JSON.stringify([{ partial: false, sentence: 'hello' }]),
    delta_text: '',
    audio_ms: 480,
  }), state), [
    { kind: 'committed', text: 'hello', fullText: 'hello' },
    { kind: 'metrics', ackedSamples: 7680, serverBufferedMs: undefined },
  ]);
});

test('native adapter sends its secret in the handshake and appends deltas', () => {
  const adapter = new R2T2NativeAdapter();
  assert.equal(adapter.buildUrl(provider('r2t2-native', 'ws://127.0.0.1:10086/asr'), 'secret').search, '');
  assert.equal(adapter.eosMarker(), R2T2_NATIVE_EOS);
  assert.equal(adapter.tailSilenceSamples(), 8_000);

  const opening = JSON.parse(adapter.buildOpeningMessage({
    requestId: 'request-2',
    language: 'zh',
    credential: 'native-secret',
    options,
  }));
  assert.equal(opening.secret_key, 'native-secret');
  assert.equal(opening.sample_rate, 16_000);
  assert.equal(opening.system_prompt, 'Technical meeting');

  const state = { committedText: '', partialText: '' };
  assert.deepEqual(adapter.readMessage('{"msg":{"text":"hello "}}', state), [
    { kind: 'committed', text: 'hello ', fullText: 'hello ' },
  ]);
  assert.deepEqual(adapter.readMessage('{"msg":{"text":"world","final":true}}', state), [
    { kind: 'committed', text: 'world', fullText: 'hello world' },
    { kind: 'final', text: 'hello world' },
  ]);
});

test('audio frame encoding copies only the selected PCM view', () => {
  const adapter = new R2T2RStreamAdapter();
  const source = Int16Array.from([10, 20, 30, 40]);
  const view = new Int16Array(source.buffer, 2, 2);
  const encoded = adapter.encodeAudioFrame(view, 1);
  assert.deepEqual([...new Int16Array(encoded)], [20, 30]);
  source[1] = 99;
  assert.deepEqual([...new Int16Array(encoded)], [20, 30]);
});
