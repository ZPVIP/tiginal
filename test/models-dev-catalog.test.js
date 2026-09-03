const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  BUILTIN_PROVIDER_PRESETS,
  SPECIAL_PROVIDER_PRESETS,
  catalogProviders,
  enrichModelsWithCatalog,
  enrichModelsFromLocalCatalog,
  parseModelsDevCatalog,
  rebuildCatalogFromSource,
} = require('../dist/main/main/services/ai/model-catalog.js');

function provider(overrides = {}) {
  return {
    id: 'tokengo',
    npm: '@ai-sdk/openai-compatible',
    api: 'https://api.tokengo.test/v1',
    name: 'TokenGo',
    env: ['TOKENGO_API_KEY'],
    doc: 'https://docs.tokengo.test',
    models: {
      'qwen/qwen3.5': {
        id: 'qwen/qwen3.5',
        name: 'Qwen 3.5',
        description: 'A catalog description',
        reasoning: true,
        reasoning_options: [{
          type: 'effort',
          values: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
        }],
        tool_call: true,
        structured_output: true,
        modalities: { input: ['text', 'image'], output: ['text'] },
        limit: { context: 262144, output: 65536 },
        cost: { input: 0.4, output: 2.65 },
      },
    },
    ...overrides,
  };
}

test('accepts only supported npm adapters with HTTPS APIs and preserves raw models', () => {
  const rawModel = provider().models['qwen/qwen3.5'];
  const parsed = parseModelsDevCatalog({
    tokengo: provider(),
    subconscious: provider({
      id: 'subconscious',
      name: 'Subconscious',
      npm: '@ai-sdk/anthropic',
      api: 'https://api.subconscious.test/v1',
    }),
    insecure: provider({ id: 'insecure', api: 'http://api.insecure.test/v1' }),
    unsupported: provider({ id: 'unsupported', npm: '@ai-sdk/openai' }),
    missingApi: provider({ id: 'missing-api', api: undefined }),
    numericApi: provider({ id: 'numeric-api', api: 42 }),
  });

  assert.deepEqual(parsed.providers, [
    {
      id: 'subconscious',
      name: 'Subconscious',
      api: 'https://api.subconscious.test/v1',
      npm: '@ai-sdk/anthropic',
    },
    {
      id: 'tokengo',
      name: 'TokenGo',
      api: 'https://api.tokengo.test/v1',
      npm: '@ai-sdk/openai-compatible',
    },
  ]);
  assert.deepEqual(parsed.modelsByProvider.tokengo, { 'qwen/qwen3.5': rawModel });
  assert.equal(parsed.modelsByProvider.insecure, undefined);
});

test('keeps only Google AI and 127.0.0.1 built-ins, with built-ins winning duplicate ids', () => {
  assert.deepEqual(BUILTIN_PROVIDER_PRESETS.map(item => item.id), [
    'google',
    'llamafile',
    'llamacpp',
    'lmstudio',
    'ollama-local',
  ]);
  assert.ok(BUILTIN_PROVIDER_PRESETS.every(item => (
    item.id === 'google' || item.api.startsWith('http://127.0.0.1')
  )));

  const dynamic = parseModelsDevCatalog({
    google: provider({
      id: 'google',
      name: 'Wrong Google',
      api: 'https://wrong-google.test/v1',
    }),
    tokengo: provider(),
  });
  const providers = catalogProviders(dynamic.providers);

  assert.deepEqual(providers.find(item => item.id === 'google'), BUILTIN_PROVIDER_PRESETS[0]);
  assert.deepEqual(providers, [...providers].sort((left, right) => (
    left.name.localeCompare(right.name) || left.id.localeCompare(right.id)
  )));
  assert.ok(providers.every(item => Object.keys(item).sort().join(',') === 'api,id,name,npm'));
});

test('adds fixed provider exceptions and keeps their models.dev metadata', () => {
  const sourceModels = {
    'gpt-test': { id: 'gpt-test', name: 'GPT Test', limit: { context: 1000 } },
  };
  const parsed = parseModelsDevCatalog({
    openai: provider({
      id: 'openai',
      name: 'Source OpenAI',
      npm: '@ai-sdk/openai',
      api: undefined,
      models: sourceModels,
    }),
  });
  const openai = parsed.providers.find(item => item.id === 'openai');

  assert.deepEqual(openai, {
    id: 'openai',
    name: 'OpenAI',
    api: 'https://api.openai.com/v1',
    npm: '@ai-sdk/openai-compatible',
  });
  assert.deepEqual(parsed.modelsByProvider.openai, sourceModels);
  assert.deepEqual(SPECIAL_PROVIDER_PRESETS.map(item => item.id), [
    'openai',
    'aihubmix',
    'anthropic',
    'cerebras',
    'groq',
    'mistral',
    'xai',
  ]);
  assert.ok(SPECIAL_PROVIDER_PRESETS.every(item => (
    catalogProviders([]).some(providerItem => providerItem.id === item.id)
  )));
});

test('enriches exact model ids and keeps unknown provider models visible', () => {
  const models = provider().models;
  const enriched = enrichModelsWithCatalog([
    { id: 'qwen/qwen3.5', name: 'Live Qwen', enabled: false },
    { id: 'qwen/qwen3.5:batch', name: 'Batch', enabled: true },
    { id: 'private-model', name: 'Private', enabled: true },
  ], models);

  assert.equal(enriched[0].name, 'Live Qwen');
  assert.equal(enriched[0].enabled, false);
  assert.equal(enriched[0].contextWindow, 262144);
  assert.equal(enriched[0].maxOutputTokens, 65536);
  assert.equal(enriched[0].supportsImages, true);
  assert.equal(enriched[0].supportsReasoning, true);
  assert.deepEqual(enriched[0].reasoningEffortOptions, [
    'none', 'low', 'medium', 'high', 'xhigh', 'max',
  ]);
  assert.equal(enriched[0].supportsToolCalls, true);
  assert.equal(enriched[0].supportsStructuredOutput, true);
  assert.deepEqual(enriched[1], { id: 'qwen/qwen3.5:batch', name: 'Batch', enabled: true });
  assert.deepEqual(enriched[2], { id: 'private-model', name: 'Private', enabled: true });
});

test('uses slash prefixes to enrich custom provider models from several local catalogs', async t => {
  const dataDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'tiginal-model-prefix-'));
  t.after(() => fs.promises.rm(dataDirectory, { recursive: true, force: true }));
  await fs.promises.mkdir(path.join(dataDirectory, 'models'));
  await fs.promises.writeFile(path.join(dataDirectory, 'models', 'anthropic.json'), JSON.stringify({
    'claude-test': { id: 'claude-test', name: 'Claude Test', limit: { context: 200000 } },
  }));
  await fs.promises.writeFile(path.join(dataDirectory, 'models', 'openai.json'), JSON.stringify({
    'gpt-test': { id: 'gpt-test', name: 'GPT Test', reasoning: true },
  }));

  const enriched = enrichModelsFromLocalCatalog([
    { id: 'anthropic/claude-test', name: 'Live Claude', enabled: true },
    { id: 'openai/gpt-test', name: 'Live GPT', enabled: true },
    { id: 'unknown/private-model', name: 'Private', enabled: true },
  ], undefined, dataDirectory);

  assert.equal(enriched[0].id, 'anthropic/claude-test');
  assert.equal(enriched[0].name, 'Live Claude');
  assert.equal(enriched[0].contextWindow, 200000);
  assert.equal(enriched[1].supportsReasoning, true);
  assert.deepEqual(enriched[2], { id: 'unknown/private-model', name: 'Private', enabled: true });
});

test('falls back to the global model catalog when provider catalogs have no match', async t => {
  const dataDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'tiginal-global-models-'));
  t.after(() => fs.promises.rm(dataDirectory, { recursive: true, force: true }));
  await fs.promises.mkdir(path.join(dataDirectory, 'models'));
  await fs.promises.writeFile(path.join(dataDirectory, 'models', 'custom.json'), '{}');
  await fs.promises.writeFile(path.join(dataDirectory, 'models.json'), JSON.stringify({
    'alibaba/qwen3.5': {
      id: 'alibaba/qwen3.5',
      name: 'Qwen 3.5',
      reasoning: true,
      limit: { context: 262144 },
    },
  }));

  const enriched = enrichModelsFromLocalCatalog([
    { id: 'alibaba/qwen3.5', name: 'Live Qwen', enabled: true },
    { id: 'private-model', name: 'Private', enabled: true },
  ], 'custom', dataDirectory);

  assert.equal(enriched[0].name, 'Live Qwen');
  assert.equal(enriched[0].contextWindow, 262144);
  assert.equal(enriched[0].supportsReasoning, true);
  assert.deepEqual(enriched[1], { id: 'private-model', name: 'Private', enabled: true });
});

test('full rebuild replaces stale model files and leaves the previous catalog intact on parse failure', async t => {
  const dataDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'tiginal-model-catalog-'));
  t.after(() => fs.promises.rm(dataDirectory, { recursive: true, force: true }));
  await fs.promises.mkdir(path.join(dataDirectory, 'models'));
  await fs.promises.writeFile(path.join(dataDirectory, 'models', 'stale.json'), '{"old":true}');
  await fs.promises.writeFile(path.join(dataDirectory, 'providers.json'), '[{"old":true}]');

  const source = JSON.stringify({
    tokengo: provider(),
    rejected: provider({ id: 'rejected', npm: '@ai-sdk/google' }),
  });
  const globalModelsSource = JSON.stringify({
    'alibaba/qwen3.5': { id: 'alibaba/qwen3.5', name: 'Qwen 3.5' },
  });
  const result = await rebuildCatalogFromSource({
    apiSource: source,
    globalModelsSource,
    dataDirectory,
  });

  assert.equal(result.modelCount, 1);
  assert.equal(result.providerCount, BUILTIN_PROVIDER_PRESETS.length + SPECIAL_PROVIDER_PRESETS.length + 1);
  assert.equal(fs.existsSync(path.join(dataDirectory, 'models', 'stale.json')), false);
  assert.equal(fs.existsSync(path.join(dataDirectory, 'models', 'rejected.json')), false);
  assert.deepEqual(
    JSON.parse(await fs.promises.readFile(path.join(dataDirectory, 'models', 'tokengo.json'), 'utf8')),
    provider().models,
  );
  for (const specialProvider of SPECIAL_PROVIDER_PRESETS) {
    assert.equal(
      fs.existsSync(path.join(dataDirectory, 'models', specialProvider.id + '.json')),
      true,
      specialProvider.id + '.json should always exist',
    );
  }
  assert.deepEqual(
    JSON.parse(await fs.promises.readFile(path.join(dataDirectory, 'api.json'), 'utf8')),
    JSON.parse(source),
  );
  assert.deepEqual(
    JSON.parse(await fs.promises.readFile(
      path.join(dataDirectory, 'models.json'),
      'utf8',
    )),
    JSON.parse(globalModelsSource),
  );

  const providersBeforeFailure = await fs.promises.readFile(path.join(dataDirectory, 'providers.json'), 'utf8');
  await assert.rejects(rebuildCatalogFromSource({
    apiSource: '{bad json',
    globalModelsSource,
    dataDirectory,
  }));
  assert.equal(
    await fs.promises.readFile(path.join(dataDirectory, 'providers.json'), 'utf8'),
    providersBeforeFailure,
  );
});
