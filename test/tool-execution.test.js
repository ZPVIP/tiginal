const test = require('node:test');
const assert = require('node:assert/strict');

const {
  prepareToolInput,
  validateDefaultInput,
} = require('../dist/main/main/services/tools/tool-input.js');
const {
  analyzeNonShellTool,
} = require('../dist/main/main/services/tools/tool-approval.js');
const {
  filterSearchResults,
} = require('../dist/main/main/services/search/index.js');

const WEB_SEARCH_SCHEMA = {
  type: 'object',
  properties: {
    query: { type: 'string', minLength: 2 },
    allowed_domains: { type: 'array', items: { type: 'string' } },
    blocked_domains: { type: 'array', items: { type: 'string' } },
    max_results: { type: 'integer', minimum: 1, maximum: 10, default: 5 },
  },
  required: ['query'],
  additionalProperties: false,
};

test('merges local defaults before validating tool arguments', () => {
  const prepared = prepareToolInput({
    schema: WEB_SEARCH_SCHEMA,
    defaultInput: {
      blocked_domains: ['bing.com'],
      max_results: 6,
    },
    input: {
      query: '2026 World Cup final',
      max_results: 8,
    },
  });

  assert.deepEqual(prepared, {
    kind: 'valid',
    input: {
      blocked_domains: ['bing.com'],
      max_results: 8,
      query: '2026 World Cup final',
    },
  });
});

test('applies JSON Schema defaults and rejects arguments outside the schema', () => {
  assert.deepEqual(prepareToolInput({
    schema: WEB_SEARCH_SCHEMA,
    input: { query: 'Tiginal terminal' },
  }), {
    kind: 'valid',
    input: { query: 'Tiginal terminal', max_results: 5 },
  });

  const invalid = prepareToolInput({
    schema: WEB_SEARCH_SCHEMA,
    input: { query: 'Tiginal terminal', max_results: 20 },
  });
  assert.equal(invalid.kind, 'invalid');
  assert.match(invalid.error, /10/);
});

test('validates partial local defaults without requiring model arguments', () => {
  assert.equal(validateDefaultInput({
    schema: WEB_SEARCH_SCHEMA,
    defaultInput: { blocked_domains: ['bing.com'] },
  }), null);

  assert.match(validateDefaultInput({
    schema: WEB_SEARCH_SCHEMA,
    defaultInput: { blocked_domains: 'bing.com' },
  }), /array/);
});

test('filters search results by exact domains and subdomains before applying the limit', () => {
  const results = [
    { title: 'Bing', url: 'https://www.bing.com/search?q=x', content: 'blocked' },
    { title: 'Subdomain', url: 'https://news.example.com/a', content: 'allowed' },
    { title: 'Other', url: 'https://other.example/a', content: 'not allowed' },
    { title: 'Example', url: 'https://example.com/b', content: 'allowed' },
  ];

  assert.deepEqual(filterSearchResults(results, {
    allowedDomains: ['example.com'],
    blockedDomains: ['bing.com'],
    maxResults: 1,
  }).map(result => result.title), ['Subdomain']);

  assert.deepEqual(filterSearchResults(results, {
    blockedDomains: ['bing.com'],
    maxResults: 10,
  }).map(result => result.title), ['Subdomain', 'Other', 'Example']);
});

test('uses tool-aware approval descriptions instead of treating JSON as Bash', () => {
  const analysis = analyzeNonShellTool('WebSearch', {
    query: '2026 World Cup final',
    max_results: 8,
  });

  assert.deepEqual(analysis, {
    needsPermission: true,
    description: '使用当前搜索服务在网络上搜索“2026 World Cup final”，最多返回 8 条结果。搜索词会发送给所选搜索服务。',
    riskLevel: 'low',
  });
  assert.equal(analysis.description.includes('Bash'), false);
});
