const test = require('node:test');
const assert = require('node:assert/strict');

const {
  formatCacheTooltip,
  formatTokenTooltip,
} = require('../dist/main/shared/token-tooltips.js');

test('formats cache usage as an input breakdown', () => {
  assert.equal(formatCacheTooltip({
    promptTokens: 1333,
    cachedTokens: 1233,
    cacheStatus: 'hit',
  }), 'Cached: 1233 | Uncached: 100 | Total input: 1333');
});

test('formats unavailable cache telemetry without reporting a false miss', () => {
  assert.equal(formatCacheTooltip({
    promptTokens: 1333,
    cachedTokens: 0,
    cacheStatus: 'unknown',
  }), 'Cached: unknown | Uncached: unknown | Total input: 1333');
});

test('separates the current chat request from title generation', () => {
  assert.equal(formatTokenTooltip({
    inputTokens: 1333,
    outputTokens: 150,
    titleTokens: 200,
  }), 'Input: 1333 | Output: 150 | Total: 1483\nTitle: 200 | Overall: 1683');
});

test('omits the title line after the first reply', () => {
  assert.equal(formatTokenTooltip({
    inputTokens: 1333,
    outputTokens: 150,
  }), 'Input: 1333 | Output: 150 | Total: 1483');
});
