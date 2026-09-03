const test = require('node:test');
const assert = require('node:assert/strict');

const {
  GLOBAL_MODEL_CATALOG_URL,
  MODEL_CATALOG_URL,
  apiFormatForCatalogProvider,
} = require('../dist/main/main/services/ai/model-catalog.js');

test('uses both models.dev catalog sources', () => {
  assert.equal(MODEL_CATALOG_URL, 'https://models.dev/api.json');
  assert.equal(GLOBAL_MODEL_CATALOG_URL, 'https://models.dev/models.json');
});

test('derives the request format from the catalog npm adapter', () => {
  assert.equal(apiFormatForCatalogProvider({
    id: 'compatible',
    name: 'Compatible',
    api: 'https://compatible.test/v1',
    npm: '@ai-sdk/openai-compatible',
  }), 'chat-completions');
  assert.equal(apiFormatForCatalogProvider({
    id: 'anthropic',
    name: 'Anthropic',
    api: 'https://anthropic.test/v1',
    npm: '@ai-sdk/anthropic',
  }), 'anthropic-messages');
});

test('uses the Anthropic v1 API endpoint', () => {
  const { SPECIAL_PROVIDER_PRESETS } = require('../dist/main/main/services/ai/model-catalog.js');
  assert.equal(
    SPECIAL_PROVIDER_PRESETS.find(provider => provider.id === 'anthropic').api,
    'https://api.anthropic.com/v1',
  );
});
