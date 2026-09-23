const test = require('node:test');
const assert = require('node:assert/strict');

const {
  clampTtl,
  deriveFileState,
  fingerprint,
  isExpired,
  parseTtl,
  remainingMs,
} = require('../dist/main/shared/credentials/state.js');
const { MAX_TTL_MS, MIN_TTL_MS } = require('../dist/main/shared/credentials/types.js');

const SAFE_ENV = 'REDIS_PASSWORD=********\nREDIS_HOST=localhost\n';
const ENTRIES = [{ keyName: 'REDIS_PASSWORD', fakeValue: '********' }];

const state = (overrides) => deriveFileState({
  content: SAFE_ENV,
  safeFingerprint: fingerprint(SAFE_ENV),
  format: 'dotenv',
  entries: ENTRIES,
  ...overrides,
});

test('reports safe when the content matches the recorded fingerprint', () => {
  assert.deepEqual(state({}), { kind: 'safe' });
});

test('reports safe-edited when only a non-secret line changed', () => {
  const edited = 'REDIS_PASSWORD=********\nREDIS_HOST=127.0.0.1\n';
  assert.deepEqual(state({ content: edited }), { kind: 'safe-edited' });
});

test('reports safe-edited when a comment was added', () => {
  const edited = `# cache\n${SAFE_ENV}`;
  assert.deepEqual(state({ content: edited }), { kind: 'safe-edited' });
});

test('reports drift when a managed value is no longer its mask', () => {
  const drifted = 'REDIS_PASSWORD=typed-back-by-hand\nREDIS_HOST=localhost\n';
  assert.deepEqual(state({ content: drifted }), {
    kind: 'drifted',
    changedKeys: ['REDIS_PASSWORD'],
    missingKeys: [],
  });
});

test('reports drift when a managed key vanished from the file', () => {
  assert.deepEqual(state({ content: 'REDIS_HOST=localhost\n' }), {
    kind: 'drifted',
    changedKeys: [],
    missingKeys: ['REDIS_PASSWORD'],
  });
});

test('reports missing when the file is gone', () => {
  assert.deepEqual(state({ content: null }), { kind: 'missing' });
});

test('reports unmanaged before the file has ever been materialized', () => {
  assert.deepEqual(state({ safeFingerprint: null }), { kind: 'unmanaged' });
});

test('reads a declared ENV file as safe when every value is masked', () => {
  const content = '# cache\nREDIS_PASSWORD=********\nREDIS_HOST=********\nREDIS_PORT=********\n';
  const entries = ['REDIS_PASSWORD', 'REDIS_HOST', 'REDIS_PORT'].map((keyName) => ({
    keyName,
    fakeValue: '********',
  }));

  assert.deepEqual(
    deriveFileState({ content, safeFingerprint: fingerprint(content), format: 'dotenv', entries }),
    { kind: 'safe' },
  );
  assert.deepEqual(
    deriveFileState({
      content: content.replace('REDIS_HOST=********', 'REDIS_HOST=localhost'),
      safeFingerprint: fingerprint(content),
      format: 'dotenv',
      entries,
    }),
    { kind: 'drifted', changedKeys: ['REDIS_HOST'], missingKeys: [] },
  );
});

test('a key appended back into the file settles to safe once the mask is written', () => {
  const entries = [...ENTRIES, { keyName: 'API_KEY', fakeValue: '********' }];
  const appended = `${SAFE_ENV}API_KEY=********\n`;

  assert.deepEqual(
    deriveFileState({
      content: SAFE_ENV,
      safeFingerprint: fingerprint(SAFE_ENV),
      format: 'dotenv',
      entries,
    }),
    { kind: 'drifted', changedKeys: [], missingKeys: ['API_KEY'] },
  );
  assert.deepEqual(
    deriveFileState({
      content: appended,
      safeFingerprint: fingerprint(appended),
      format: 'dotenv',
      entries,
    }),
    { kind: 'safe' },
  );
});

test('compares a whole-file secret against its placeholder', () => {
  const safe = 'FAKE_SECRET\n';
  const entries = [{ keyName: 'KAMAL_REGISTRY_PASSWORD', fakeValue: 'FAKE_SECRET' }];

  assert.deepEqual(
    deriveFileState({ content: safe, safeFingerprint: fingerprint(safe), format: 'opaque', entries }),
    { kind: 'safe' },
  );
  assert.deepEqual(
    deriveFileState({
      content: 'REAL_AGAIN\n',
      safeFingerprint: fingerprint(safe),
      format: 'opaque',
      entries,
    }),
    { kind: 'drifted', changedKeys: ['KAMAL_REGISTRY_PASSWORD'], missingKeys: [] },
  );
});

test('fingerprints content as a stable sha256 hex digest', () => {
  assert.match(fingerprint('x'), /^[0-9a-f]{64}$/);
  assert.equal(fingerprint('x'), fingerprint('x'));
  assert.notEqual(fingerprint('x'), fingerprint('y'));
});

test('parses a ttl in seconds, minutes, hours, and bare minutes', () => {
  assert.equal(parseTtl('30s'), 30 * 1000);
  assert.equal(parseTtl('15m'), 15 * 60 * 1000);
  assert.equal(parseTtl('1h'), 60 * 60 * 1000);
  assert.equal(parseTtl('45'), 45 * 60 * 1000);
  assert.equal(parseTtl(' 15m '), 15 * 60 * 1000);
});

test('rejects a ttl that is not a positive duration', () => {
  for (const input of ['abc', '0', '0m', '-5', '', '15x', '1.5m']) {
    assert.equal(parseTtl(input), null, `${input} must be rejected`);
  }
});

test('clamps a ttl into the allowed window', () => {
  assert.equal(clampTtl(30 * 1000), MIN_TTL_MS);
  assert.equal(clampTtl(15 * 60 * 1000), 15 * 60 * 1000);
  assert.equal(clampTtl(4 * 60 * 60 * 1000), MAX_TTL_MS);
});

test('reports the remaining time and expiry of a session', () => {
  const now = 1_000_000;
  assert.equal(remainingMs(now + 5000, now), 5000);
  assert.equal(remainingMs(now - 5000, now), 0);
  assert.equal(isExpired(now - 1, now), true);
  assert.equal(isExpired(now, now), true);
  assert.equal(isExpired(now + 1, now), false);
});
