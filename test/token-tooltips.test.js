const test = require('node:test');
const assert = require('node:assert/strict');

const {
  calculateSessionTokenTotals,
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

test('shows the current interaction separately from session consumption', () => {
  assert.equal(formatTokenTooltip({
    inputTokens: 1333,
    outputTokens: 150,
    titleTokens: 200,
    sessionTokens: 3365,
  }), 'Input: 1333 | Output: 150 | Total: 1483\nSession consumed: 3365 (includes title: 200)');
});

test('keeps a fixed cumulative total on each reply and counts title generation once', () => {
  const totals = calculateSessionTokenTotals([
    { role: 'user' },
    { role: 'assistant', requestTotalTokens: 2184, totalTokens: 3000, titleTokens: 2588 },
    { role: 'tool' },
    { role: 'assistant', requestTotalTokens: 2419, totalTokens: 3200 },
    { role: 'assistant', requestTotalTokens: 2666, totalTokens: 3500 },
  ]);

  assert.deepEqual(totals, [0, 4772, 4772, 7191, 9857]);
});

test('omits the title line after the first reply', () => {
  assert.equal(formatTokenTooltip({
    inputTokens: 1333,
    outputTokens: 150,
  }), 'Input: 1333 | Output: 150 | Total: 1483');
});
