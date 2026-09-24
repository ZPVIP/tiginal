const assert = require('node:assert/strict');
const test = require('node:test');

const {
  defaultT3POInstructions,
  formatT3POHistory,
} = require('../dist/main/shared/audio/t3po-prompt.js');
const {
  buildT3POPrompt,
  getT3POLogitBias,
  T3POStreamingTranslator,
} = require('../dist/main/main/audio/T3POStreamingTranslator.js');
const { T3PORStreamAdapter } = require('../dist/main/main/audio/protocols/T3PORStreamAdapter.js');
const { T3PONativeAdapter } = require('../dist/main/main/audio/protocols/T3PONativeAdapter.js');
const { TranslationService } = require('../dist/main/main/audio/TranslationService.js');

test('T3PO prompt builder formats history and current input correctly', () => {
  const instructions = 'Translate from zh to en';
  const history = [
    { source: '你好', target: 'Hello' },
    { source: '世界', target: 'world' },
  ];
  const historyStr = formatT3POHistory(history);
  assert.equal(historyStr, '你好¦Hello§世界¦world§');

  const prompt = buildT3POPrompt(instructions, history, '今天天气不错', false);
  assert.ok(prompt.includes(instructions));
  assert.ok(prompt.includes('<STREAMING_HISTORY>\n你好¦Hello§世界¦world§'));
  assert.ok(prompt.includes('<CURRENT_INPUT>\n今天天气不错'));
  assert.ok(!prompt.includes('This is the final end of speech.'));

  const forcePrompt = buildT3POPrompt(instructions, history, '今天天气不错', true);
  assert.ok(forcePrompt.includes('This is the final end of speech.'));
});

test('T3PO default instructions adapt to language pair', () => {
  const zhToEn = defaultT3POInstructions('zh', 'en');
  assert.ok(zhToEn.includes('Chinese-to-English simultaneous interpreter'));
  assert.ok(zhToEn.includes('<STREAMING_HISTORY>'));
  assert.ok(zhToEn.includes('<CURRENT_INPUT>'));

  const enToZh = defaultT3POInstructions('en', 'zh');
  assert.ok(enToZh.includes('English-to-Chinese simultaneous interpreter'));

  const esToFr = defaultT3POInstructions('es', 'fr');
  assert.ok(esToFr.includes('translating from es to fr'));
});

test('T3PO logit bias varies according to latency mode', () => {
  const nativeBias = getT3POLogitBias('native');
  assert.equal(nativeBias, undefined);

  const lowBias = getT3POLogitBias('low');
  assert.ok(lowBias);
  assert.equal(lowBias['151643'], -0.94);
  assert.equal(lowBias['151645'], -0.98);

  const highBias = getT3POLogitBias('high');
  assert.ok(highBias);
  assert.equal(highBias['151643'], 0.39);
  assert.equal(highBias['151645'], 0.41);
});

test('T3POStreamingTranslator handles WAIT, TRANS, coalescing and force flush', async () => {
  const events = [];
  const requests = [];

  // Mock fetcher
  let callCount = 0;
  const mockFetcher = async (url, init) => {
    callCount++;
    const body = JSON.parse(init.body);
    requests.push({ url, body });

    // Step 1: ambiguous input -> WAIT (empty output)
    if (callCount === 1) {
      return new Response(JSON.stringify({
        choices: [{ message: { content: '' } }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // Step 2: input resolved -> TRANS
    if (callCount === 2) {
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'Good morning' } }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // Step 3: flush / force -> complete remainder
    return new Response(JSON.stringify({
      choices: [{ message: { content: ', everyone.' } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const translator = new T3POStreamingTranslator({
    endpoint: 'http://localhost:8000/v1/chat/completions',
    sourceLanguage: 'zh',
    targetLanguage: 'en',
    latencyMode: 'low',
    fetcher: mockFetcher,
    onEvent: event => events.push(event),
  });

  // 1. Push first segment -> emits deciding then wait
  translator.pushCommittedText('早上');
  await new Promise(r => setTimeout(r, 20));

  assert.equal(events.some(e => e.kind === 'wait'), true);
  assert.equal(translator.committedTranslation, '');

  // 2. Push second segment -> emits trans
  translator.pushCommittedText('好');
  await new Promise(r => setTimeout(r, 20));

  assert.equal(events.some(e => e.kind === 'trans'), true);
  assert.equal(translator.committedTranslation, 'Good morning');

  // 3. Force flush
  translator.pushCommittedText('大家');
  const finalResult = await translator.flush();

  assert.equal(finalResult, 'Good morning, everyone.');
  assert.equal(events.some(e => e.kind === 'complete'), true);
});

test('T3PO rstream and native protocol adapters handle messages and URL', () => {
  const rstream = new T3PORStreamAdapter();
  const provider = {
    id: 'p1',
    name: 'T3PO RStream',
    protocol: 't3po-rstream',
    endpoint: 'wss://example.com/stream',
    authMode: 'query-token',
    hasCredential: true,
    builtInKind: null,
    userModified: false,
    maxSessionSeconds: null,
    defaultLanguage: 'zh',
    options: {
      targetLanguage: 'en',
      latencyMode: 'low',
    },
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
  };

  const url = rstream.buildUrl(provider, 'token123');
  assert.equal(url.searchParams.get('t'), 'token123');

  const openMsg = JSON.parse(rstream.buildOpeningMessage({
    requestId: 'req-1',
    language: 'zh',
    options: provider.options,
  }));
  assert.equal(openMsg.action, 'start');
  assert.equal(openMsg.lang, 'cn');

  const state = { committedText: '', partialText: '' };
  const msgs = rstream.readMessage(JSON.stringify({ status: 'connected' }), state);
  assert.deepEqual(msgs, [{ kind: 'connected' }]);

  const transMsgs = rstream.readMessage(JSON.stringify({
    text: 'Hello',
  }), state);
  assert.equal(transMsgs.length, 1);
  assert.equal(transMsgs[0].kind, 'committed');
  assert.equal(transMsgs[0].text, 'Hello');

  const native = new T3PONativeAdapter();
  const nativeOpen = JSON.parse(native.buildOpeningMessage({
    requestId: 'req-2',
    language: 'zh',
    credential: 'auth-secret',
    options: provider.options,
  }));
  assert.equal(nativeOpen.secret_key, 'auth-secret');
  assert.equal(nativeOpen.action, 'handshake');
});

test('TranslationService lists candidates from speech providers and ai providers', async () => {
  const mockDb = {
    prepare: sql => {
      const s = sql.trim();
      if (s.includes('speech_providers')) {
        return {
          all: () => [
            {
              id: 'sp-t3po',
              name: 'T3PO Online Trial',
              protocol: 't3po-rstream',
              endpoint: 'wss://example.com/t3po',
              auth_mode: 'query-token',
              credential_encrypted: null,
              built_in_kind: 't3po-online-trial',
              user_modified: 0,
              max_session_seconds: 600,
              default_language: 'zh',
              options_json: '{}',
              enabled: 1,
              created_at: 1,
              updated_at: 1,
            },
            {
              id: 'sp-r2t2',
              name: 'R2T2 Trial',
              protocol: 'r2t2-rstream',
              endpoint: 'wss://example.com/r2t2',
              auth_mode: 'query-token',
              credential_encrypted: null,
              built_in_kind: 'r2t2-online-trial',
              user_modified: 0,
              max_session_seconds: 600,
              default_language: 'zh',
              options_json: '{}',
              enabled: 1,
              created_at: 1,
              updated_at: 1,
            },
          ],
        };
      }
      if (s.includes('ai_providers')) {
        return {
          all: () => [
            {
              id: 'openai-1',
              name: 'OpenAI GPT-4o',
              endpoint: 'https://api.openai.com/v1',
              model: 'gpt-4o',
              api_key_encrypted: null,
              enabled: 1,
            },
          ],
        };
      }
      return { all: () => [] };
    },
  };

  const service = new TranslationService(mockDb, {
    isUnlocked: () => false,
    decrypt: () => '',
  });

  const candidates = await service.listCandidates();
  assert.equal(candidates.length, 2);

  const t3po = candidates.find(c => c.source === 'speech-provider');
  assert.ok(t3po);
  assert.equal(t3po.isSimultaneous, true);

  const openai = candidates.find(c => c.source === 'remote');
  assert.ok(openai);
  assert.equal(openai.isSimultaneous, false);
});

test('createStreamingTranslator rejects non-ws engines', () => {
  const mockDb = {
    prepare: () => ({
      get: () => ({
        id: 'openai-1',
        endpoint: 'https://api.openai.com/v1',
        model: 'gpt-4o',
        api_key_encrypted: null,
      }),
    }),
  };
  const service = new TranslationService(mockDb, {
    isUnlocked: () => false,
    decrypt: () => '',
  });

  assert.throws(() => {
    service.createStreamingTranslator({
      engineId: 'remote-ai:openai-1:gpt-4o',
      targetLanguage: 'en',
    }, 'zh', () => {});
  }, /Model does not support streaming/);
});

test('T3POStreamingTranslator throws in flush when inference fails', async () => {
  const failingFetcher = async () => {
    return {
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => 'Service Unavailable',
    };
  };

  const translator = new T3POStreamingTranslator({
    endpoint: 'https://example.com/v1',
    fetcher: failingFetcher,
    sourceLanguage: 'zh',
    targetLanguage: 'en',
  });

  translator.pushCommittedText('测试');
  await assert.rejects(async () => {
    await translator.flush();
  }, /Service Unavailable/);
});

test('translateStatic throws clear error if key storage is locked', async () => {
  const mockDb = {
    prepare: () => ({
      get: () => ({
        id: 'openai-1',
        name: 'OpenAI',
        endpoint: 'https://api.openai.com/v1',
        model: 'gpt-4o',
        api_key_encrypted: 'some-encrypted-bytes',
      }),
    }),
  };
  const service = new TranslationService(mockDb, {
    isUnlocked: () => false,
    decrypt: () => '',
  });

  await assert.rejects(async () => {
    await service.translateStatic({
      engineId: 'remote-ai:openai-1:gpt-4o',
      text: '你好',
      sourceLanguage: 'zh',
      targetLanguage: 'en',
    });
  }, /Key storage is locked/);
});

