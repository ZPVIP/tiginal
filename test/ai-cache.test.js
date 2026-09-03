const test = require('node:test');
const assert = require('node:assert/strict');

const {
  aggregateCacheUsage,
  buildAnthropicRequest,
  canonicalizeToolDefinitions,
  isAnthropicEndpoint,
  normalizeAnthropicUsage,
  normalizeResponsesUsage,
  normalizeOpenAIUsage,
  summarizeAgentUsage,
} = require('../dist/main/main/services/ai/cache-usage.js');
const {
  anthropicMessagesUrl,
  anthropicModelsUrl,
  createAnthropicStreamState,
  processAnthropicEvent,
} = require('../dist/main/main/services/ai/anthropic-stream.js');

test('normalizes an OpenAI prompt cache hit', () => {
  assert.deepEqual(normalizeOpenAIUsage({
    prompt_tokens: 1200,
    completion_tokens: 80,
    total_tokens: 1280,
    prompt_tokens_details: { cached_tokens: 900 },
    completion_tokens_details: { reasoning_tokens: 20 },
  }), {
    promptTokens: 1200,
    completionTokens: 80,
    reasoningTokens: 20,
    cachedTokens: 900,
    cacheWriteTokens: 0,
    totalTokens: 1280,
    cacheStatus: 'hit',
  });
});

test('distinguishes a reported miss from unavailable cache telemetry', () => {
  assert.equal(normalizeOpenAIUsage({
    prompt_tokens: 1200,
    completion_tokens: 80,
    prompt_tokens_details: { cached_tokens: 0 },
  }).cacheStatus, 'miss');

  assert.equal(normalizeOpenAIUsage({
    prompt_tokens: 1200,
    completion_tokens: 80,
  }).cacheStatus, 'unknown');
});

test('normalizes Anthropic cache read and cache creation tokens', () => {
  assert.deepEqual(normalizeAnthropicUsage({
    input_tokens: 100,
    cache_read_input_tokens: 800,
    cache_creation_input_tokens: 300,
    output_tokens: 50,
  }), {
    promptTokens: 1200,
    completionTokens: 50,
    reasoningTokens: 0,
    cachedTokens: 800,
    cacheWriteTokens: 300,
    totalTokens: 1250,
    cacheStatus: 'hit',
  });
});

test('normalizes Responses API usage fields', () => {
  assert.deepEqual(normalizeResponsesUsage({
    input_tokens: 100,
    output_tokens: 20,
    total_tokens: 120,
    input_tokens_details: { cached_tokens: 40 },
    output_tokens_details: { reasoning_tokens: 8 },
  }), {
    promptTokens: 100,
    completionTokens: 20,
    reasoningTokens: 8,
    cachedTokens: 40,
    cacheWriteTokens: 0,
    totalTokens: 120,
    cacheStatus: 'hit',
  });
});

test('keeps an aggregate unknown if any internal model turn lacks telemetry', () => {
  const known = normalizeOpenAIUsage({
    prompt_tokens: 1000,
    completion_tokens: 50,
    prompt_tokens_details: { cached_tokens: 600 },
  });
  const unknown = normalizeOpenAIUsage({
    prompt_tokens: 1200,
    completion_tokens: 70,
  });

  assert.deepEqual(aggregateCacheUsage([known, unknown]), {
    promptTokens: 2200,
    completionTokens: 120,
    reasoningTokens: 0,
    cachedTokens: 600,
    cacheWriteTokens: 0,
    totalTokens: 2320,
    cacheStatus: 'unknown',
  });
});

test('separates the final model request from total agent-loop consumption', () => {
  const firstRequest = normalizeOpenAIUsage({
    prompt_tokens: 1571,
    completion_tokens: 94,
    total_tokens: 1665,
    prompt_tokens_details: { cached_tokens: 1408 },
  });
  const finalRequest = normalizeOpenAIUsage({
    prompt_tokens: 1611,
    completion_tokens: 89,
    total_tokens: 1700,
    prompt_tokens_details: { cached_tokens: 1472 },
    completion_tokens_details: { reasoning_tokens: 29 },
  });

  assert.deepEqual(summarizeAgentUsage([firstRequest, finalRequest]), {
    currentRequest: finalRequest,
    consumed: {
      promptTokens: 3182,
      completionTokens: 183,
      reasoningTokens: 29,
      cachedTokens: 2880,
      cacheWriteTokens: 0,
      totalTokens: 3365,
      cacheStatus: 'hit',
    },
  });
});

test('detects only the official Anthropic API host', () => {
  assert.equal(isAnthropicEndpoint('https://api.anthropic.com/v1'), true);
  assert.equal(isAnthropicEndpoint('https://api.anthropic.com/v1/'), true);
  assert.equal(isAnthropicEndpoint('https://proxy.example/v1'), false);
  assert.equal(isAnthropicEndpoint('not a URL'), false);
});

test('canonicalizes tool and schema key order without reordering arrays', () => {
  const tools = canonicalizeToolDefinitions([
    {
      name: 'Zulu',
      description: 'z',
      input_schema: { required: ['b', 'a'], properties: { b: { type: 'string' }, a: { type: 'number' } }, type: 'object' },
    },
    {
      name: 'Alpha',
      description: 'a',
      input_schema: { type: 'object', properties: {} },
    },
  ]);

  assert.deepEqual(tools.map(tool => tool.name), ['Alpha', 'Zulu']);
  assert.deepEqual(Object.keys(tools[1].input_schema), ['properties', 'required', 'type']);
  assert.deepEqual(Object.keys(tools[1].input_schema.properties), ['a', 'b']);
  assert.deepEqual(tools[1].input_schema.required, ['b', 'a']);
});

test('builds a native Anthropic request with automatic prompt caching', () => {
  const request = buildAnthropicRequest({
    model: 'claude-sonnet-4-5',
    messages: [
      { role: 'system', content: 'Stable system prompt' },
      { role: 'system', content: 'Today is 2026-08-28' },
      { role: 'user', content: 'Hello' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{
          id: 'tool-1',
          type: 'function',
          function: { name: 'Bash', arguments: '{"command":"pwd"}' },
        }],
      },
      { role: 'tool', tool_call_id: 'tool-1', content: '/tmp' },
    ],
    tools: [{
      name: 'Bash',
      description: 'Run a command',
      input_schema: { type: 'object', properties: { command: { type: 'string' } } },
    }],
    reasoningEffort: 'medium',
  });

  assert.deepEqual(request.system, [
    { type: 'text', text: 'Stable system prompt' },
    { type: 'text', text: 'Today is 2026-08-28' },
  ]);
  assert.deepEqual(request.cache_control, { type: 'ephemeral' });
  assert.deepEqual(request.output_config, { effort: 'medium' });
  assert.equal(request.temperature, undefined);
  assert.equal(request.stream, true);
  assert.deepEqual(request.tools[0], {
    name: 'Bash',
    description: 'Run a command',
    input_schema: { type: 'object', properties: { command: { type: 'string' } } },
  });
  assert.deepEqual(request.messages[1].content[0], {
    type: 'tool_use',
    id: 'tool-1',
    name: 'Bash',
    input: { command: 'pwd' },
  });
  assert.deepEqual(request.messages[2], {
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: '/tmp' }],
  });
});

test('parses Anthropic streaming text, tools, and cache usage', () => {
  const chunks = [];
  const state = createAnthropicStreamState();

  processAnthropicEvent(state, {
    type: 'message_start',
    message: {
      usage: {
        input_tokens: 100,
        cache_read_input_tokens: 700,
        cache_creation_input_tokens: 200,
        output_tokens: 1,
      },
    },
  }, chunk => chunks.push(chunk));
  processAnthropicEvent(state, {
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'text', text: 'Hi' },
  }, chunk => chunks.push(chunk));
  processAnthropicEvent(state, {
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text: ' there' },
  }, chunk => chunks.push(chunk));
  processAnthropicEvent(state, {
    type: 'content_block_start',
    index: 1,
    content_block: { type: 'tool_use', id: 'tool-1', name: 'Bash', input: {} },
  }, chunk => chunks.push(chunk));
  processAnthropicEvent(state, {
    type: 'content_block_delta',
    index: 1,
    delta: { type: 'input_json_delta', partial_json: '{"command":"pwd"}' },
  }, chunk => chunks.push(chunk));
  processAnthropicEvent(state, {
    type: 'message_delta',
    usage: { output_tokens: 30 },
  }, chunk => chunks.push(chunk));

  assert.deepEqual(chunks, [{ content: 'Hi' }, { content: ' there' }]);
  assert.deepEqual(state.toolCalls, [{
    id: 'tool-1',
    name: 'Bash',
    input: { command: 'pwd' },
  }]);
  assert.deepEqual(normalizeAnthropicUsage(state.usage), {
    promptTokens: 1000,
    completionTokens: 30,
    reasoningTokens: 0,
    cachedTokens: 700,
    cacheWriteTokens: 200,
    totalTokens: 1030,
    cacheStatus: 'hit',
  });
});

test('normalizes official Anthropic endpoint variants', () => {
  assert.equal(anthropicMessagesUrl('https://api.anthropic.com'), 'https://api.anthropic.com/v1/messages');
  assert.equal(anthropicMessagesUrl('https://api.anthropic.com/v1'), 'https://api.anthropic.com/v1/messages');
  assert.equal(anthropicMessagesUrl('https://api.anthropic.com/v1/messages'), 'https://api.anthropic.com/v1/messages');
  assert.equal(anthropicModelsUrl('https://api.anthropic.com'), 'https://api.anthropic.com/v1/models');
  assert.equal(anthropicModelsUrl('https://api.anthropic.com/v1'), 'https://api.anthropic.com/v1/models');
  assert.equal(anthropicModelsUrl('https://api.anthropic.com/v1/models'), 'https://api.anthropic.com/v1/models');
});
