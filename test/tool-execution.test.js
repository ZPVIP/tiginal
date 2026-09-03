const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseToolArguments,
  prepareToolInput,
  validateDefaultInput,
} = require('../dist/main/main/services/tools/tool-input.js');
const {
  analyzeNonShellTool,
  shouldAutoApproveTool,
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

test('treats omitted arguments from a no-argument tool call as an empty object', () => {
  assert.deepEqual(parseToolArguments(''), { kind: 'valid', input: {} });
  assert.deepEqual(parseToolArguments('   '), { kind: 'valid', input: {} });
  assert.deepEqual(parseToolArguments('{}'), { kind: 'valid', input: {} });
});

test('rejects malformed or non-object tool-call arguments', () => {
  assert.equal(parseToolArguments('{').kind, 'invalid');
  assert.deepEqual(parseToolArguments('[]'), {
    kind: 'invalid',
    error: 'tool arguments must be a JSON object',
  });
});

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
    description: 'Search the web for "2026 World Cup final" using the current search service and return up to 8 results. The query will be sent to the selected search service.',
    riskLevel: 'low',
  });
  assert.equal(analysis.description.includes('Bash'), false);
});

test('only auto-approves operations marked safe', () => {
  assert.equal(shouldAutoApproveTool({
    needsPermission: true,
    description: 'Run a destructive command.',
    riskLevel: 'high',
  }), false);

  assert.equal(shouldAutoApproveTool({
    needsPermission: false,
    description: 'Read local instructions.',
    riskLevel: 'safe',
  }), true);
});
