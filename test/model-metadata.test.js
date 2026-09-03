const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseModelListPayload,
  parseStoredModels,
  resolveReasoningEffort,
} = require('../dist/main/main/services/ai/model-metadata.js');

test('parses model capabilities from common model-list fields', () => {
  assert.deepEqual(parseModelListPayload({
    data: [{
      id: 'reasoning-vision-model',
      context_length: 200000,
      top_provider: { max_completion_tokens: 100000 },
      architecture: { input_modalities: ['text', 'image'] },
      supported_parameters: ['tools', 'reasoning'],
      reasoning_options: [{
        type: 'effort',
        values: ['none', 'low', 'medium', 'high', 'xhigh', 'max', 'invalid'],
      }],
    }],
  }), [{
    id: 'reasoning-vision-model',
    name: 'reasoning-vision-model',
    enabled: true,
    contextWindow: 200000,
    maxOutputTokens: 100000,
    supportsImages: true,
    supportsReasoning: true,
    supportsToolCalls: true,
    reasoningEffortOptions: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
  }]);
});

test('preserves old string-only stored model lists', () => {
  assert.deepEqual(parseStoredModels('["model-b","model-a"]'), [
    { id: 'model-a', name: 'model-a', enabled: true },
    { id: 'model-b', name: 'model-b', enabled: true },
  ]);
});

test('preserves saved capability metadata and disabled state', () => {
  assert.deepEqual(parseStoredModels(JSON.stringify([{
    id: 'saved-model',
    name: 'Saved model',
    enabled: false,
    contextWindow: 128000,
    maxOutputTokens: 32000,
    supportsImages: true,
    supportsReasoning: true,
    reasoningEffortOptions: ['low', 'high'],
  }])), [{
    id: 'saved-model',
    name: 'Saved model',
    enabled: false,
    contextWindow: 128000,
    maxOutputTokens: 32000,
    supportsImages: true,
    supportsReasoning: true,
    reasoningEffortOptions: ['low', 'high'],
  }]);
});

test('parses GitHub Copilot reasoning effort capabilities', () => {
  assert.deepEqual(parseModelListPayload({
    data: [{
      id: 'copilot-reasoning-model',
      name: 'Copilot reasoning model',
      capabilities: {
        limits: {
          max_context_window_tokens: 200000,
          max_output_tokens: 32000,
        },
        supports: {
          reasoning_effort: ['low', 'medium', 'high', 'invalid'],
        },
      },
      supported_reasoning_efforts: ['medium', 'high', 'xhigh'],
    }],
  }), [{
    id: 'copilot-reasoning-model',
    name: 'Copilot reasoning model',
    enabled: true,
    contextWindow: 200000,
    maxOutputTokens: 32000,
    supportsReasoning: true,
    reasoningEffortOptions: ['medium', 'high', 'xhigh', 'low'],
  }]);
});

test('deduplicates model ids and ignores malformed entries', () => {
  assert.deepEqual(parseModelListPayload({ models: [
    { name: 'local-model', n_ctx: '32768' },
    { id: 'local-model', context_length: 8192 },
    { created: 123 },
  ] }), [{
    id: 'local-model',
    name: 'local-model',
    enabled: true,
    contextWindow: 32768,
  }]);
});

test('accepts only effort levels advertised by the selected model', () => {
  const models = [{
    id: 'reasoning-model',
    name: 'Reasoning model',
    enabled: true,
    reasoningEffortOptions: ['low', 'medium', 'high'],
  }];

  assert.equal(resolveReasoningEffort(models, 'reasoning-model', 'high'), 'high');
  assert.equal(resolveReasoningEffort(models, 'reasoning-model', 'max'), undefined);
  assert.equal(resolveReasoningEffort(models, 'other-model', 'high'), undefined);
});
