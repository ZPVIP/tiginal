// Tiginal owns the set of managed keys in a declared ENV file, so a key it holds outlives the user deleting the line, and nothing outside a value's own span may move.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  FORMAT_HANDLERS,
  detectFormat,
  rewriteValues,
  storableValue,
} = require('../dist/main/shared/credentials/formats.js');
const {
  classifyEnvValue,
  fakeValueFor,
  MASK,
} = require('../dist/main/shared/credentials/classify.js');
const {
  deriveFileState,
  fingerprint,
} = require('../dist/main/shared/credentials/state.js');

const ENV = [
  '# deployment secrets',
  'PLAIN=hunter2',
  'QUOTED="s3cr3t value"',
  "SINGLE='tick'",
  'export EXPORTED=abc   # trailing note',
  'DB_URL=postgres://user:pw@localhost:5432/app',
  '',
  '# NOT_A_KEY=ignored',
].join('\n') + '\n';

test('a quoted value keeps its quotes in the parsed span', () => {
  const parsed = FORMAT_HANDLERS.dotenv.parse(ENV);
  const byKey = Object.fromEntries(parsed.map(e => [e.key, e.value]));
  assert.equal(byKey.PLAIN, 'hunter2');
  assert.equal(byKey.QUOTED, '"s3cr3t value"');
  assert.equal(byKey.SINGLE, "'tick'");
  assert.equal(byKey.EXPORTED, 'abc');
  assert.equal(byKey.DB_URL, 'postgres://user:pw@localhost:5432/app');
  assert.equal(parsed.length, 5, 'a comment is not an entry');
});

test('every ENV value is managed whatever it looks like', () => {
  for (const entry of FORMAT_HANDLERS.dotenv.parse(ENV)) {
    const c = classifyEnvValue(entry.key, entry.value);
    assert.equal(c.spans.length, 1, entry.key);
    assert.deepEqual(c.spans[0], { start: 0, end: entry.value.length }, entry.key);
    assert.equal(fakeValueFor(entry.value, c, 'dotenv'), MASK, entry.key);
  }
});

test('an already-masked value is never recaptured, quoted or not', () => {
  assert.equal(classifyEnvValue('PLAIN', MASK).spans.length, 0);
  assert.equal(classifyEnvValue('PLAIN', `"${MASK}"`).spans.length, 0);
  assert.equal(classifyEnvValue('PLAIN', 'FAKE_SECRET').spans.length, 0);
});

test('masking rewrites only the values and leaves every other byte alone', () => {
  const parsed = FORMAT_HANDLERS.dotenv.parse(ENV);
  const fakes = new Map(parsed.map(e => [e.key, MASK]));
  const masked = rewriteValues(ENV, 'dotenv', fakes, { appendMissing: true });
  assert.deepEqual(masked.appendedKeys, []);
  assert.equal(masked.content, [
    '# deployment secrets',
    'PLAIN=********',
    'QUOTED=********',
    'SINGLE=********',
    'export EXPORTED=********   # trailing note',
    'DB_URL=********',
    '',
    '# NOT_A_KEY=ignored',
  ].join('\n') + '\n');
});

test('a round trip through masked form restores the original bytes', () => {
  const parsed = FORMAT_HANDLERS.dotenv.parse(ENV);
  const reals = new Map(parsed.map(e => [e.key, e.value]));
  const masked = rewriteValues(ENV, 'dotenv', new Map(parsed.map(e => [e.key, MASK])), {});
  const restored = rewriteValues(masked.content, 'dotenv', reals, { appendMissing: true });
  assert.equal(restored.content, ENV);
});

test('a key Tiginal holds but the file lost is appended, not dropped', () => {
  const trimmed = '# deployment secrets\nPLAIN=********\n';
  const reals = new Map([['PLAIN', 'hunter2'], ['GONE', '"came back"']]);
  const out = rewriteValues(trimmed, 'dotenv', reals, { appendMissing: true });
  assert.deepEqual(out.appendedKeys, ['GONE']);
  assert.deepEqual(out.missingKeys, []);
  assert.equal(out.content, '# deployment secrets\nPLAIN=hunter2\nGONE="came back"\n');
});

test('appending is idempotent: a second write adds nothing', () => {
  const reals = new Map([['PLAIN', 'hunter2'], ['GONE', '"came back"']]);
  const first = rewriteValues('PLAIN=x\n', 'dotenv', reals, { appendMissing: true });
  const second = rewriteValues(first.content, 'dotenv', reals, { appendMissing: true });
  assert.equal(second.content, first.content);
  assert.deepEqual(second.appendedKeys, []);
});

test('a file with no trailing newline gains one before the appended line', () => {
  const out = rewriteValues('PLAIN=x', 'dotenv', new Map([['PLAIN', 'y'], ['NEW', 'z']]), { appendMissing: true });
  assert.equal(out.content, 'PLAIN=y\nNEW=z\n');
});

test('CRLF files keep CRLF on the appended line', () => {
  const out = rewriteValues('PLAIN=x\r\n', 'dotenv', new Map([['PLAIN', 'y'], ['NEW', 'z']]), { appendMissing: true });
  assert.equal(out.content, 'PLAIN=y\r\nNEW=z\r\n');
});

test('tfvars appends in its own assignment style', () => {
  const out = rewriteValues('plain = "x"\n', 'tfvars', new Map([['plain', '"y"'], ['extra', '"z"']]), { appendMissing: true });
  assert.equal(out.content, 'plain = "y"\nextra = "z"\n');
});

test('an opaque file never appends: it has one nameless value', () => {
  const out = rewriteValues('FAKE_SECRET\n', 'opaque', new Map([['KAMAL_REGISTRY_PASSWORD', 'real']]), { appendMissing: true });
  assert.equal(out.content, 'real\n');
  assert.deepEqual(out.appendedKeys, []);
  assert.equal(detectFormat('/x/.kamal/keys/KAMAL_REGISTRY_PASSWORD.key'), 'opaque');
});

test('masked content reads as safe and a typed-back real value reads as drift', () => {
  const parsed = FORMAT_HANDLERS.dotenv.parse(ENV);
  const entries = parsed.map(e => ({ keyName: e.key, fakeValue: MASK }));
  const masked = rewriteValues(ENV, 'dotenv', new Map(parsed.map(e => [e.key, MASK])), {}).content;
  assert.deepEqual(
    deriveFileState({ content: masked, safeFingerprint: fingerprint(masked), format: 'dotenv', entries }),
    { kind: 'safe' },
  );
  assert.equal(
    deriveFileState({ content: ENV, safeFingerprint: fingerprint(masked), format: 'dotenv', entries }).kind,
    'drifted',
  );
});

// A value typed into the ENV table has never been through the reader, so it is
// the one place a value can arrive in a shape the file cannot carry.
const storedThenParsed = (format, typed) => {
  const stored = storableValue(format, typed);
  if (stored === null) return null;
  const masked = rewriteValues('EXISTING=x\n', format,
    new Map([['EXISTING', MASK], ['NEW', MASK]]), { appendMissing: true }).content;
  const real = rewriteValues(masked, format,
    new Map([['EXISTING', 'x'], ['NEW', stored]]), { appendMissing: true }).content;
  const found = FORMAT_HANDLERS[format].parse(real).find(e => e.key === 'NEW');
  return found ? found.value : null;
};

test('a typed value survives the mask-and-restore cycle whatever is in it', () => {
  for (const typed of [
    'plain',
    'hello world',
    'abc #def',
    '#leading-hash',
    'trailing ',
    ' leading',
    'has"an interior quote',
    "it's",
    '"already quoted"',
    "'already quoted'",
    '"unclosed quote',
    'both" kinds \'',
  ]) {
    const stored = storableValue('dotenv', typed);
    assert.notEqual(stored, null, typed);
    assert.equal(storedThenParsed('dotenv', typed), stored, typed);
  }
});

test('a typed value is only quoted when a bare one would read back short', () => {
  assert.equal(storableValue('dotenv', 'plain'), 'plain');
  assert.equal(storableValue('dotenv', 'hello world'), 'hello world');
  assert.equal(storableValue('dotenv', 'abc #def'), '"abc #def"');
  assert.equal(storableValue('dotenv', 'trailing '), '"trailing "');
  assert.equal(storableValue('dotenv', '"unclosed quote'), "'\"unclosed quote'");
  assert.equal(storableValue('dotenv', '"already quoted"'), '"already quoted"');
});

test('an opaque file stores a typed value verbatim: it has no line to quote', () => {
  assert.equal(storableValue('opaque', 'abc #def'), 'abc #def');
});

test('tfvars quotes a typed value the same way', () => {
  assert.equal(storedThenParsed('tfvars', 'abc // not a comment'), storableValue('tfvars', 'abc // not a comment'));
  assert.equal(storableValue('tfvars', 'abc // not a comment'), '"abc // not a comment"');
});
