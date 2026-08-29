const test = require('node:test');
const assert = require('node:assert/strict');

const {
  applyCompletionTokenLimit,
  fetchOpenAIWithCompatibility,
  getOpenAIRequestFallback,
} = require('../dist/main/main/services/ai/openai-request.js');

test('uses max_completion_tokens for the official OpenAI API', () => {
  assert.deepEqual(
    applyCompletionTokenLimit({ model: 'gpt-5', stream: true }, 'https://api.openai.com/v1', 4000),
    { model: 'gpt-5', stream: true, max_completion_tokens: 4000 },
  );
});

test('keeps max_tokens for generic OpenAI-compatible providers', () => {
  assert.deepEqual(
    applyCompletionTokenLimit({ model: 'local-model', stream: true }, 'http://127.0.0.1:1234/v1', 4000),
    { model: 'local-model', stream: true, max_tokens: 4000 },
  );
});

test('swaps max_tokens after a provider requests max_completion_tokens', () => {
  assert.deepEqual(getOpenAIRequestFallback(
    { model: 'gpt-5', max_tokens: 4000, stream: true },
    400,
    "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.",
  ), {
    model: 'gpt-5',
    max_completion_tokens: 4000,
    stream: true,
  });
});

test('removes unsupported streaming usage options without changing the token limit', () => {
  assert.deepEqual(getOpenAIRequestFallback(
    {
      model: 'local-model',
      max_tokens: 4000,
      stream: true,
      stream_options: { include_usage: true },
    },
    422,
    'Unsupported parameter: stream_options.include_usage',
  ), {
    model: 'local-model',
    max_tokens: 4000,
    stream: true,
  });
});

test('does not retry unrelated API errors', () => {
  assert.equal(getOpenAIRequestFallback(
    { model: 'gpt-5', max_completion_tokens: 4000, stream: true },
    400,
    'Invalid tool schema',
  ), null);
});

test('retries a rejected request with max_completion_tokens', async () => {
  const requests = [];
  const fetcher = async (_url, init) => {
    requests.push(JSON.parse(init.body));
    if (requests.length === 1) {
      return new Response(JSON.stringify({
        error: {
          message: "Unsupported parameter: 'max_tokens'. Use 'max_completion_tokens' instead.",
        },
      }), { status: 400 });
    }
    return new Response(JSON.stringify({ choices: [] }), { status: 200 });
  };

  const result = await fetchOpenAIWithCompatibility(
    fetcher,
    'https://proxy.example/v1/chat/completions',
    { method: 'POST' },
    { model: 'gpt-5', max_tokens: 4000, stream: true },
  );

  assert.equal(result.response.status, 200);
  assert.deepEqual(requests, [
    { model: 'gpt-5', max_tokens: 4000, stream: true },
    { model: 'gpt-5', max_completion_tokens: 4000, stream: true },
  ]);
});

test('merges leading system messages while preserving the stable prompt prefix', async () => {
  const stablePrompt = 'Stable system prompt and tool instructions';
  const volatilePrompt = 'Today is 2026-08-28';
  let request;
  const fetcher = async (_url, init) => {
    request = JSON.parse(init.body);
    return new Response(JSON.stringify({ choices: [] }), { status: 200 });
  };

  await fetchOpenAIWithCompatibility(
    fetcher,
    'http://127.0.0.1:1337/v1/chat/completions',
    { method: 'POST' },
    {
      model: 'AtomicChat/Qwen3_8-27B-AD-IQ2_S',
      messages: [
        { role: 'system', content: stablePrompt },
        { role: 'system', content: volatilePrompt },
        { role: 'user', content: '你是谁' },
      ],
      stream: true,
    },
  );

  assert.deepEqual(request.messages, [
    { role: 'system', content: `${stablePrompt}\n\n${volatilePrompt}` },
    { role: 'user', content: '你是谁' },
  ]);
  assert.equal(request.messages[0].content.startsWith(stablePrompt), true);
});
