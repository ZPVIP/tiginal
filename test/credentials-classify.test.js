const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const DIST_ROOT = process.env.TIGINAL_TEST_DIST_ROOT
  ? path.resolve(process.env.TIGINAL_TEST_DIST_ROOT)
  : path.resolve(__dirname, '../dist/main');

const {
  MASK,
  FAKE_OPAQUE,
  classify,
  fakeValueFor,
  isSecret,
} = require(path.join(DIST_ROOT, 'shared/credentials/classify.js'));
const {
  FORMAT_HANDLERS,
  rewriteValues,
} = require(path.join(DIST_ROOT, 'shared/credentials/formats.js'));

/** Import a file the way the Materializer does, and return the safe content. */
function toSafe(content, format) {
  const values = new Map();
  for (const entry of FORMAT_HANDLERS[format].parse(content)) {
    const key = entry.key || 'WHOLE_FILE';
    const classification = classify(key, entry.value);
    if (!isSecret(classification)) continue;
    values.set(key, fakeValueFor(entry.value, classification, format));
  }
  return rewriteValues(content, format, values).content;
}

test('masks a password value completely', () => {
  const c = classify('REDIS_PASSWORD', 'REAL_PASSWORD');
  assert.equal(c.secretType, 'password');
  assert.equal(fakeValueFor('REAL_PASSWORD', c, 'dotenv'), MASK);
});

test('masks only the password inside a connection URL', () => {
  const value = 'redis://:REAL_PASSWORD@localhost:6379/1';
  const c = classify('REDIS_URL', value);

  assert.equal(c.secretType, 'url_password');
  assert.deepEqual(c.spans, [{ start: 9, end: 22 }]);
  assert.equal(fakeValueFor(value, c, 'dotenv'), 'redis://:********@localhost:6379/1');
});

test('masks the password in a URL that also carries a username', () => {
  const value = 'postgres://app:s3cret@db.internal:5432/prod';
  const c = classify('DATABASE_URL', value);
  assert.equal(fakeValueFor(value, c, 'dotenv'), 'postgres://app:********@db.internal:5432/prod');
});

test('leaves the non-secret Redis settings alone', () => {
  for (const [key, value] of [
    ['REDIS_HOST', 'localhost'],
    ['REDIS_PORT', '6379'],
    ['REDIS_DB', '1'],
    ['REDIS_SSL', 'false'],
  ]) {
    assert.equal(isSecret(classify(key, value)), false, `${key} must not be treated as a secret`);
  }
});

test('leaves a URL with no credentials alone', () => {
  assert.equal(isSecret(classify('APP_URL', 'https://example.com/health')), false);
  assert.equal(isSecret(classify('REDIS_URL', 'redis://localhost:6379/1')), false);
});

test('leaves key names that only look secret alone', () => {
  for (const [key, value] of [
    ['PUBLIC_KEY', 'ssh-ed25519 AAAA'],
    ['SECRET_KEY_BASE_FILE', 'config/secret'],
    ['SSH_KEY_PATH', 'id_ed25519'],
    ['LOG_PATH', 'logs/app.log'],
    ['AWS_SHARED_CREDENTIALS_FILE', 'credentials'],
    ['CACHE_DIR', 'tmp/cache'],
    ['AWS_ACCESS_KEY_ID_ENABLED', 'true'],
  ]) {
    assert.equal(isSecret(classify(key, value)), false, `${key} must not be treated as a secret`);
  }
});

test('leaves a secret-looking key alone when its value is a filesystem path', () => {
  assert.equal(isSecret(classify('TLS_CERT', '/etc/ssl/cert.pem')), false);
  assert.equal(isSecret(classify('API_KEY', '~/.config/key')), false);
});

test('detects a token, an api key, and a PEM body', () => {
  assert.equal(classify('CLOUDFLARE_API_TOKEN', 'cf-abc').secretType, 'token');
  assert.equal(classify('AWS_ACCESS_KEY_ID', 'AKIAEXAMPLE').secretType, 'api_key');
  assert.equal(classify('ANYTHING', '-----BEGIN OPENSSH PRIVATE KEY-----\nx\n').secretType, 'private_key');
});

test('returns no spans for a value that is already masked', () => {
  for (const value of [MASK, FAKE_OPAQUE, '****', 'changeme']) {
    assert.equal(
      isSecret(classify('REDIS_PASSWORD', value)),
      false,
      `re-importing ${value} must not encrypt a mask`,
    );
  }
});

test('returns no spans for an empty value', () => {
  assert.equal(isSecret(classify('API_KEY', '')), false);
  assert.equal(isSecret(classify('API_KEY', '   ')), false);
});

test('gives a whole-file secret the named placeholder and a dotenv secret the mask', () => {
  const opaque = classify('KAMAL_REGISTRY_PASSWORD', 'REAL_KAMAL_PASSWORD');
  assert.equal(fakeValueFor('REAL_KAMAL_PASSWORD', opaque, 'opaque'), FAKE_OPAQUE);
  assert.equal(fakeValueFor('REAL_KAMAL_PASSWORD', opaque, 'dotenv'), MASK);
});

test('treats every opaque file as a whole-file secret', () => {
  const classification = classify(
    'PRODUCTION_COGNITO_USER_POOL_ID',
    'us-west-2_example',
    'opaque',
  );

  assert.equal(isSecret(classification), true);
  assert.equal(
    fakeValueFor('us-west-2_example', classification, 'opaque'),
    FAKE_OPAQUE,
  );
});

test('produces the plan section 6.1 safe block from its real block', () => {
  const real = [
    'REDIS_URL=redis://:REAL_PASSWORD@localhost:6379/1',
    'REDIS_HOST=localhost',
    'REDIS_PORT=6379',
    'REDIS_PASSWORD=REAL_PASSWORD',
    'REDIS_DB=1',
    'REDIS_SSL=false',
    '',
  ].join('\n');
  const safe = [
    'REDIS_URL=redis://:********@localhost:6379/1',
    'REDIS_HOST=localhost',
    'REDIS_PORT=6379',
    'REDIS_PASSWORD=********',
    'REDIS_DB=1',
    'REDIS_SSL=false',
    '',
  ].join('\n');

  assert.equal(toSafe(real, 'dotenv'), safe);
});

test('produces the plan section 6.3 safe block from its real block', () => {
  const real = [
    'aws_region = "us-west-2"',
    'cloudflare_api_token = "REAL_TOKEN"',
    'domain_name = "example.com"',
    '',
  ].join('\n');
  const safe = [
    'aws_region = "us-west-2"',
    'cloudflare_api_token = "********"',
    'domain_name = "example.com"',
    '',
  ].join('\n');

  assert.equal(toSafe(real, 'tfvars'), safe);
});

test('produces the plan section 6.2 safe Kamal key file', () => {
  assert.equal(toSafe('REAL_KAMAL_PASSWORD\n', 'opaque'), 'FAKE_SECRET\n');
});

test('materializing an already safe file changes nothing', () => {
  const safe = 'REDIS_PASSWORD=********\nREDIS_HOST=localhost\n';
  assert.equal(toSafe(safe, 'dotenv'), safe);
  assert.equal(toSafe('FAKE_SECRET\n', 'opaque'), 'FAKE_SECRET\n');
});
