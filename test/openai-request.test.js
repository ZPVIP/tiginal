const test = require('node:test');
const assert = require('node:assert/strict');

const {
  applyCompletionTokenLimit,
  applyReasoningEffort,
  fetchOpenAIWithCompatibility,
  getOpenAIRequestFallback,
  parseOpenAIChatCompletion,
  prepareOpenAIRequestPayload,
} = require('../dist/main/main/services/ai/openai-request.js');

test('adds reasoning_effort and omits unsupported temperature from Chat Completions requests', () => {
  assert.deepEqual(applyReasoningEffort({ model: 'gpt-5.6-sol', temperature: 0.7 }, 'xhigh'), {
    model: 'gpt-5.6-sol',
    reasoning_effort: 'xhigh',
  });
  assert.deepEqual(applyReasoningEffort({ model: 'gpt-4o' }, undefined), {
    model: 'gpt-4o',
  });
});

test('parses a standard OpenAI chat completion response', () => {
  assert.deepEqual(parseOpenAIChatCompletion({
    choices: [{ message: { content: 'Standard title' } }],
    usage: { total_tokens: 12 },
  }), {
    content: 'Standard title',
    usage: { total_tokens: 12 },
  });
});

test('parses a chat completion wrapped in a data envelope', () => {
  assert.deepEqual(parseOpenAIChatCompletion({
    data: {
      choices: [{ message: { content: '2026 FIFA World Cup Winner' } }],
      usage: { total_tokens: 258 },
    },
    success: true,
  }), {
    content: '2026 FIFA World Cup Winner',
    usage: { total_tokens: 258 },
  });
});

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

test('uses the provider token-field setting instead of inferring from the endpoint', () => {
  assert.deepEqual(
    applyCompletionTokenLimit({ model: 'o3', stream: true }, 'https://proxy.example/v1', 4000, true),
    { model: 'o3', stream: true, max_completion_tokens: 4000 },
  );
  assert.deepEqual(
    applyCompletionTokenLimit({ model: 'gpt-5', stream: true }, 'https://api.openai.com/v1', 4000, false),
    { model: 'gpt-5', stream: true, max_tokens: 4000 },
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

test('merges every system message into one leading message', async () => {
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
        { role: 'user', content: 'Who are you?' },
        { role: 'system', content: volatilePrompt },
      ],
      stream: true,
    },
  );

  assert.deepEqual(request.messages, [
    { role: 'system', content: `${stablePrompt}\n\n${volatilePrompt}` },
    { role: 'user', content: 'Who are you?' },
  ]);
  assert.equal(request.messages[0].content.startsWith(stablePrompt), true);
});

test('prepares the same single-system payload used by request logging', () => {
  assert.deepEqual(prepareOpenAIRequestPayload({
    model: 'gpt-5',
    messages: [
      { role: 'system', content: 'Web search instructions' },
      { role: 'user', content: 'Current question' },
      { role: 'assistant', content: 'Earlier answer' },
      { role: 'system', content: 'Today is 2026-08-30' },
    ],
  }), {
    model: 'gpt-5',
    messages: [
      { role: 'system', content: 'Web search instructions\n\nToday is 2026-08-30' },
      { role: 'user', content: 'Current question' },
      { role: 'assistant', content: 'Earlier answer' },
    ],
  });
});
