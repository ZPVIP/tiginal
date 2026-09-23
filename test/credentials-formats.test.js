const test = require('node:test');
const assert = require('node:assert/strict');

const {
  FORMAT_HANDLERS,
  detectFormat,
  isValidKeyName,
  opaqueKeyFromPath,
  rewriteValues,
} = require('../dist/main/shared/credentials/formats.js');

const parseDotenv = (content) => FORMAT_HANDLERS.dotenv.parse(content);
const parseTfvars = (content) => FORMAT_HANDLERS.tfvars.parse(content);

test('detects a format from the file name', () => {
  assert.equal(detectFormat('/p/.env'), 'dotenv');
  assert.equal(detectFormat('/p/.env.production'), 'dotenv');
  assert.equal(detectFormat('/p/infra/production/terraform.tfvars'), 'tfvars');
  assert.equal(detectFormat('/p/.kamal/keys/KAMAL_REGISTRY_PASSWORD.key'), 'opaque');
  assert.equal(detectFormat('/p/environment.txt'), 'opaque');
});

test('locates the value span of every dotenv assignment', () => {
  const content = 'REDIS_URL=redis://:REAL_PASSWORD@localhost:6379/1\nREDIS_HOST=localhost\n';
  const entries = parseDotenv(content);

  assert.deepEqual(entries.map((e) => e.key), ['REDIS_URL', 'REDIS_HOST']);
  assert.equal(entries[0].value, 'redis://:REAL_PASSWORD@localhost:6379/1');
  assert.equal(content.slice(entries[0].valueStart, entries[0].valueEnd), entries[0].value);
  assert.equal(content.slice(entries[1].valueStart, entries[1].valueEnd), 'localhost');
});

test('reads export prefixes and indentation, and keeps a quoted value quoted', () => {
  const content = 'export A=1\nB="two words"\n  C=\'three\'\n';
  const entries = parseDotenv(content);

  assert.deepEqual(entries.map((e) => [e.key, e.value]), [
    ['A', '1'],
    ['B', '"two words"'],
    ['C', "'three'"],
  ]);
  for (const entry of entries) {
    assert.equal(content.slice(entry.valueStart, entry.valueEnd), entry.value);
  }
});

test('a quoted value round-trips through a rewrite because its span covers the quotes', () => {
  const content = 'B="two words"\n';
  const [entry] = parseDotenv(content);
  const masked = rewriteValues(content, 'dotenv', new Map([['B', '********']]));

  assert.equal(masked.content, 'B=********\n');
  assert.equal(rewriteValues(masked.content, 'dotenv', new Map([['B', entry.value]])).content, content);
});

test('skips dotenv comments, blank lines, and lines with no assignment', () => {
  const entries = parseDotenv('# a comment\n\nnot an assignment\nA=1\n');
  assert.deepEqual(entries.map((e) => e.key), ['A']);
});

test('drops a trailing comment from an unquoted dotenv value but keeps a hash inside one', () => {
  assert.equal(parseDotenv('A=value # trailing\n')[0].value, 'value');
  assert.equal(parseDotenv('A="value # kept"\n')[0].value, '"value # kept"');
  assert.equal(parseDotenv('A=pa#ss\n')[0].value, 'pa#ss');
});

test('rewrites only the named keys and reports the ones absent from the file', () => {
  const content = 'A=1\nB=2\n';
  const result = rewriteValues(content, 'dotenv', new Map([['A', 'x'], ['MISSING', 'y']]));

  assert.equal(result.content, 'A=x\nB=2\n');
  assert.deepEqual(result.missingKeys, ['MISSING']);
  assert.deepEqual(result.appendedKeys, []);
});

test('appendMissing writes a managed key back instead of reporting it absent', () => {
  const result = rewriteValues(
    '# note\nA=1\n',
    'dotenv',
    new Map([['A', 'x'], ['GONE', 'y']]),
    { appendMissing: true },
  );

  assert.equal(result.content, '# note\nA=x\nGONE=y\n');
  assert.deepEqual(result.appendedKeys, ['GONE']);
  assert.deepEqual(result.missingKeys, []);
});

test('accepts the key names each parser reads back and rejects the rest', () => {
  assert.equal(isValidKeyName('dotenv', 'REDIS_PASSWORD'), true);
  assert.equal(isValidKeyName('dotenv', 'app.token'), true);
  assert.equal(isValidKeyName('dotenv', 'my-token'), false);
  assert.equal(isValidKeyName('tfvars', 'my-token'), true);
  assert.equal(isValidKeyName('tfvars', 'my.token'), false);
  for (const key of ['', '1ST', 'HAS SPACE', 'A=B']) {
    assert.equal(isValidKeyName('dotenv', key), false, `${key} must be rejected`);
  }
  assert.equal(isValidKeyName('opaque', 'ANYTHING'), false);
});

test('rewriting a dotenv file leaves every other byte alone, CRLF included', () => {
  const content = '# head\r\nexport A="one"\r\n\r\nB=two # note\r\nC=three\r\n';
  const result = rewriteValues(content, 'dotenv', new Map([['B', 'MASKED']]));

  assert.equal(result.content, '# head\r\nexport A="one"\r\n\r\nB=MASKED # note\r\nC=three\r\n');
});

test('rewriting twice with the same values is idempotent', () => {
  const content = 'A=1\nB=2\n';
  const values = new Map([['A', 'x'], ['B', 'y']]);
  const once = rewriteValues(content, 'dotenv', values).content;
  const twice = rewriteValues(once, 'dotenv', values).content;

  assert.equal(once, 'A=x\nB=y\n');
  assert.equal(twice, once);
});

test('rewrites every occurrence of a duplicated dotenv key', () => {
  const result = rewriteValues('A=1\nB=2\nA=3\n', 'dotenv', new Map([['A', 'x']]));
  assert.equal(result.content, 'A=x\nB=2\nA=x\n');
});

test('locates scalar tfvars values and preserves the surrounding layout', () => {
  const content = [
    'aws_region = "us-west-2"',
    'cloudflare_api_token = "REAL_TOKEN"',
    'domain_name = "example.com"',
    '',
  ].join('\n');
  const result = rewriteValues(content, 'tfvars', new Map([['cloudflare_api_token', '********']]));

  assert.equal(result.content, [
    'aws_region = "us-west-2"',
    'cloudflare_api_token = ********',
    'domain_name = "example.com"',
    '',
  ].join('\n'));
});

test('skips a tfvars list, map, and heredoc value instead of mangling it', () => {
  const content = [
    'zones = ["a", "b"]',
    'tags = {',
    '  env = "prod"',
    '}',
    'body = <<EOT',
    'text',
    'EOT',
    'token = "REAL"',
  ].join('\n');
  const entries = parseTfvars(content);

  assert.deepEqual(entries.map((e) => e.key), ['env', 'token']);
});

test('skips tfvars comments in both syntaxes', () => {
  const entries = parseTfvars('# hash\n// slash\na = "1"\n');
  assert.deepEqual(entries.map((e) => e.key), ['a']);
});

test('treats a Kamal key file as one whole-file secret named after its basename', () => {
  const entries = FORMAT_HANDLERS.opaque.parse('REAL_KAMAL_PASSWORD\n');

  assert.equal(entries.length, 1);
  assert.equal(entries[0].key, '');
  assert.equal(entries[0].value, 'REAL_KAMAL_PASSWORD');
  assert.equal(
    opaqueKeyFromPath('/p/.kamal/keys/KAMAL_REGISTRY_PASSWORD.key'),
    'KAMAL_REGISTRY_PASSWORD',
  );
  assert.equal(opaqueKeyFromPath('/p/private.pem'), 'private');
});

test('rewrites a whole-file secret regardless of the key name it was stored under', () => {
  const result = rewriteValues(
    'REAL_KAMAL_PASSWORD\n',
    'opaque',
    new Map([['KAMAL_REGISTRY_PASSWORD', 'FAKE_SECRET']]),
  );

  assert.equal(result.content, 'FAKE_SECRET\n');
  assert.deepEqual(result.missingKeys, []);
});

test('reports a whole-file secret as missing when the file is empty', () => {
  const result = rewriteValues('', 'opaque', new Map([['K', 'FAKE_SECRET']]));
  assert.deepEqual(result.missingKeys, ['K']);
});

test('leaves a malformed unterminated quote untouched', () => {
  assert.deepEqual(parseDotenv('A="unterminated\n'), []);
});
