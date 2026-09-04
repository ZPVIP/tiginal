/**
 * End-to-end security harness for the Developer Credential Manager.
 *
 * Runs the real main-process services and the real `tiginal cred` CLI against a
 * throwaway HOME, so every check below exercises the shipped code path rather
 * than a mock. It is the executable form of the plan's section 28 security
 * tests, and the thing a reviewer reruns.
 *
 *   npm run build:main && node scripts/credential-harness.cjs
 *
 * The wrapper re-execs itself under Electron with an isolated HOME, because the
 * services reach the existing CryptoService, which needs safeStorage.
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');

const REPO = path.resolve(__dirname, '..');

const REAL = {
  redisPassword: 'r3dis-REAL-pw-4c1f',
  cloudflareToken: 'cf-REAL-token-9b2e',
  kamalPassword: 'kamal-REAL-registry-7a3d',
};

if (!process.env.TIGINAL_HARNESS_HOME) {
  const electron = require('electron');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tiginal-harness-'));

  const child = spawnSync(electron, [__filename], {
    cwd: REPO,
    stdio: 'inherit',
    env: {
      ...process.env,
      HOME: home,
      TIGINAL_HARNESS_HOME: home,
      TIGINAL_NODE_EXEC_PATH: process.execPath,
      ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
      OS_ACTIVITY_MODE: 'disable',
    },
  });

  fs.rmSync(home, { recursive: true, force: true });
  process.exit(child.status === null ? 1 : child.status);
}

const { app } = require('electron');

const HOME = process.env.TIGINAL_HARNESS_HOME;
const CONFIG_HOME = process.env.HOME;
const NODE_EXEC = process.env.TIGINAL_NODE_EXEC_PATH || process.execPath;
const PROJECT = path.join(HOME, 'projects', 'acme-app');
const SESSION_ROOT = path.join(os.tmpdir(), 'tiginal-cred');

app.setPath('userData', path.join(HOME, `user-data-${process.pid}`));

let passed = 0;
let failed = 0;

/** Runs immediately: later checks depend on what earlier ones left behind. */
function check(name, fn) {
  try {
    fn();
    passed += 1;
    process.stdout.write(`  ok  ${name}\n`);
  } catch (error) {
    failed += 1;
    process.stdout.write(`FAIL  ${name}\n      ${error.message}\n`);
  }
}

async function checkAsync(name, fn) {
  try {
    await fn();
    passed += 1;
    process.stdout.write(`  ok  ${name}\n`);
  } catch (error) {
    failed += 1;
    process.stdout.write(`FAIL  ${name}\n      ${error.message}\n`);
  }
}

function write(relative, content, mode) {
  const target = path.join(PROJECT, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, mode === undefined ? undefined : { mode });
  return target;
}

const readFile = (relative) => fs.readFileSync(path.join(PROJECT, relative), 'utf8');

function assertNoRealSecret(label, text) {
  for (const [name, value] of Object.entries(REAL)) {
    assert.equal(text.includes(value), false, `${label} must not contain the real ${name}`);
  }
}

function sessionDirs() {
  return fs.existsSync(SESSION_ROOT) ? fs.readdirSync(SESSION_ROOT) : [];
}

function runCli(args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(NODE_EXEC, [path.join(REPO, 'bin', 'tiginal.js'), ...args], {
      cwd: opts.cwd || PROJECT,
      env: { ...process.env, HOME: CONFIG_HOME, ...(opts.env || {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    const timeout = setTimeout(() => child.kill('SIGTERM'), 30000);
    child.on('error', () => {
      clearTimeout(timeout);
      resolve({ status: null, stdout, stderr });
    });
    child.on('close', (status) => {
      clearTimeout(timeout);
      resolve({ status, stdout, stderr });
    });
  });
}

function buildFixture() {
  fs.mkdirSync(PROJECT, { recursive: true });
  write('Gemfile', "source 'https://rubygems.org'\n");
  write(
    '.env',
    [
      '# Redis',
      `REDIS_URL=redis://:${REAL.redisPassword}@localhost:6379/1`,
      'REDIS_HOST=localhost',
      'REDIS_PORT=6379',
      `REDIS_PASSWORD=${REAL.redisPassword}`,
      'REDIS_DB=1',
      'REDIS_SSL=false',
      '',
    ].join('\n'),
  );
  write('.env.example', 'REDIS_PASSWORD=changeme\n');
  write('.kamal/keys/KAMAL_REGISTRY_PASSWORD.key', `${REAL.kamalPassword}\n`, 0o600);
  write(
    'infra/production/terraform.tfvars',
    [
      'aws_region = "us-west-2"',
      `cloudflare_api_token = "${REAL.cloudflareToken}"`,
      'domain_name = "example.com"',
      '',
    ].join('\n'),
  );
}

async function run() {
  await app.whenReady();
  buildFixture();

  const { getCrypto } = require('../dist/main/services/ssh/CryptoService.js');
  const { getDatabase } = require('../dist/main/services/database/database.js');
  const { getCredentialStore } = require('../dist/main/main/services/credentials/CredentialStore.js');
  const { getMaterializer } = require('../dist/main/main/services/credentials/Materializer.js');
  const { getCredentialRuntime } = require('../dist/main/main/services/credentials/CredentialRuntime.js');
  const socketModule = require('../dist/main/main/services/credentials/CredentialSocket.js');
  const { scanProject } = require('../dist/main/main/services/credentials/discovery.js');

  const crypto = getCrypto();
  await crypto.initialize('harness-master-password', crypto.generateSalt());
  assert.equal(crypto.isUnlocked(), true, 'crypto must be unlocked before the harness starts');

  const db = getDatabase();
  const store = getCredentialStore();
  const materializer = getMaterializer();
  const runtime = getCredentialRuntime();

  const root = store.createGroup({
    parentId: null,
    slug: 'acme-app',
    name: 'Acme App',
    scope: 'project',
    kind: 'generic',
    rootPath: PROJECT,
    allowedCommands: [],
  });
  const rails = store.createGroup({
    parentId: root.id,
    slug: 'rails',
    name: 'Rails',
    scope: 'project',
    kind: 'rails',
    rootPath: null,
    allowedCommands: [],
  });
  const kamal = store.createGroup({
    parentId: root.id,
    slug: 'kamal',
    name: 'Kamal',
    scope: 'project',
    kind: 'kamal',
    rootPath: null,
    allowedCommands: [],
  });
  const terraform = store.createGroup({
    parentId: root.id,
    slug: 'terraform',
    name: 'Terraform',
    scope: 'project',
    kind: 'terraform',
    rootPath: null,
    allowedCommands: [],
  });

  check('discovery finds the managed files and skips the Gemfile and .env.example', () => {
    const found = scanProject(PROJECT).map((d) => d.relativePath).sort();
    assert.deepEqual(found, [
      '.env',
      '.kamal/keys/KAMAL_REGISTRY_PASSWORD.key',
      'infra/production/terraform.tfvars',
    ]);
  });

  check('discovery refuses to scan a home directory root', () => {
    assert.throws(() => scanProject(os.homedir()));
  });

  const envFile = materializer.importFile(rails.id, path.join(PROJECT, '.env'), {});
  const kamalFile = materializer.importFile(
    kamal.id,
    path.join(PROJECT, '.kamal/keys/KAMAL_REGISTRY_PASSWORD.key'),
    {},
  );
  const tfFile = materializer.importFile(
    terraform.id,
    path.join(PROJECT, 'infra/production/terraform.tfvars'),
    {},
  );

  check('importing the same path twice is refused', () => {
    assert.throws(() => materializer.importFile(rails.id, path.join(PROJECT, '.env'), {}));
  });

  check('safe mode leaves no real secret in .env', () => {
    const content = readFile('.env');
    assertNoRealSecret('.env', content);
    assert.match(content, /REDIS_PASSWORD=\*{8}/);
    assert.match(content, /REDIS_URL=redis:\/\/:\*{8}@localhost:6379\/1/);
  });

  check('safe mode preserves every non-secret line of .env verbatim', () => {
    const content = readFile('.env');
    assert.match(content, /^# Redis$/m);
    assert.match(content, /^REDIS_HOST=localhost$/m);
    assert.match(content, /^REDIS_PORT=6379$/m);
    assert.match(content, /^REDIS_DB=1$/m);
    assert.match(content, /^REDIS_SSL=false$/m);
  });

  check('safe mode replaces a Kamal key file with FAKE_SECRET', () => {
    const content = readFile('.kamal/keys/KAMAL_REGISTRY_PASSWORD.key');
    assertNoRealSecret('kamal key file', content);
    assert.match(content, /FAKE_SECRET/);
  });

  check('safe mode masks only the secret tfvars field', () => {
    const content = readFile('infra/production/terraform.tfvars');
    assertNoRealSecret('terraform.tfvars', content);
    assert.match(content, /^aws_region = "us-west-2"$/m);
    assert.match(content, /^domain_name = "example\.com"$/m);
    assert.match(content, /^cloudflare_api_token = "\*{8}"$/m);
  });

  check('safe mode keeps the original file permissions', () => {
    const mode = fs.statSync(path.join(PROJECT, '.kamal/keys/KAMAL_REGISTRY_PASSWORD.key')).mode;
    assert.equal(mode & 0o777, 0o600);
  });

  check('no plaintext secret reaches the SQLite file', () => {
    db.getDb().pragma('wal_checkpoint(TRUNCATE)');
    for (const suffix of ['', '-wal', '-shm']) {
      const file = db.getDbPath() + suffix;
      if (!fs.existsSync(file)) continue;
      assertNoRealSecret(path.basename(file), fs.readFileSync(file, 'latin1'));
    }
  });

  check('materializing safe twice converges', () => {
    const before = readFile('.env');
    materializer.materializeSafe(envFile.fileId);
    materializer.materializeSafe(envFile.fileId);
    assert.equal(readFile('.env'), before);
  });

  check('a freshly imported file inspects as safe', () => {
    assert.equal(materializer.inspect(envFile.fileId).state.kind, 'safe');
  });

  check('inspect carries no value, real or fake', () => {
    const text = JSON.stringify(materializer.inspect(envFile.fileId));
    assertNoRealSecret('inspect payload', text);
    assert.equal(text.includes('****'), false, 'inspect must not carry fake values either');
  });

  check('an edit to a comment reads as safe-edited, then settles to safe', () => {
    const original = readFile('.env');
    fs.writeFileSync(path.join(PROJECT, '.env'), original.replace('# Redis', '# Redis cache'));
    assert.equal(materializer.inspect(envFile.fileId).state.kind, 'safe-edited');
    assert.equal(materializer.inspect(envFile.fileId).state.kind, 'safe');
  });

  check('a real value put back by hand reads as drift and is not overwritten', () => {
    const content = readFile('.env');
    fs.writeFileSync(
      path.join(PROJECT, '.env'),
      content.replace(/REDIS_PASSWORD=\*{8}/, 'REDIS_PASSWORD=hand-edited-value'),
    );
    const state = materializer.inspect(envFile.fileId).state;
    assert.equal(state.kind, 'drifted');
    assert.deepEqual(state.changedKeys, ['REDIS_PASSWORD']);
    assert.throws(() => materializer.materializeSafe(envFile.fileId), /drift/i);
    assert.match(readFile('.env'), /REDIS_PASSWORD=hand-edited-value/);
  });

  check('restore safe clears drift when forced', () => {
    materializer.materializeSafe(envFile.fileId, { force: true });
    assert.equal(materializer.inspect(envFile.fileId).state.kind, 'safe');
    assert.match(readFile('.env'), /REDIS_PASSWORD=\*{8}/);
  });

  check('a vanished managed key reads as drift', () => {
    const content = readFile('.env');
    fs.writeFileSync(
      path.join(PROJECT, '.env'),
      content.split('\n').filter((line) => !line.startsWith('REDIS_PASSWORD=')).join('\n'),
    );
    const state = materializer.inspect(envFile.fileId).state;
    assert.equal(state.kind, 'drifted');
    assert.deepEqual(state.missingKeys, ['REDIS_PASSWORD']);
    fs.writeFileSync(path.join(PROJECT, '.env'), content);
    materializer.materializeSafe(envFile.fileId, { force: true });
  });

  check('a missing file reads as missing', () => {
    const target = path.join(PROJECT, 'infra/production/terraform.tfvars');
    const saved = fs.readFileSync(target);
    fs.unlinkSync(target);
    assert.equal(materializer.inspect(tfFile.fileId).state.kind, 'missing');
    fs.writeFileSync(target, saved);
    assert.equal(materializer.inspect(tfFile.fileId).state.kind, 'safe');
  });

  check('an expired session stops counting as active', () => {
    const session = store.createSession({
      groupId: root.id,
      accessMode: 'command',
      approvedBy: 'harness',
      expiresAt: Date.now() - 60_000,
      commandSummary: 'true (0 args)',
    });
    store.expireStaleSessions(Date.now());
    assert.equal(store.getSession(session.id).status, 'expired');
    assert.equal(store.activeSessionFor(root.id), null);
  });

  check('the startup sweep removes an orphaned session directory', () => {
    fs.mkdirSync(SESSION_ROOT, { recursive: true, mode: 0o700 });
    const session = store.createSession({
      groupId: root.id,
      accessMode: 'command',
      approvedBy: 'harness',
      expiresAt: Date.now() + 60_000,
      commandSummary: 'true (0 args)',
    });
    const orphanDir = path.join(SESSION_ROOT, session.id);
    fs.mkdirSync(orphanDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(orphanDir, 'leftover'), REAL.redisPassword, { mode: 0o600 });
    store.setSessionTmpDir(session.id, orphanDir);

    runtime.sweepOrphans();

    assert.equal(fs.existsSync(orphanDir), false, 'the orphan directory must be removed');
    assert.equal(store.getSession(session.id).status, 'expired');
  });

  check('the audit trail records events without any secret value', () => {
    const rows = store.listAudit(500);
    assert.ok(rows.length > 0, 'the audit trail must not be empty');
    assertNoRealSecret('audit trail', JSON.stringify(rows));
  });

  check('a UI file session restores original paths and revoke masks them again', () => {
    const grant = runtime.startOriginalFileSession({
      groupId: root.id,
      groupIds: [root.id, rails.id, kamal.id, terraform.id],
      ttlMs: 5 * 60 * 1000,
      mode: 'original-files',
    });

    try {
      assert.equal(grant.mode, 'original-files');
      assert.equal(readFile('.env').includes(REAL.redisPassword), true);
      assert.equal(
        readFile('.kamal/keys/KAMAL_REGISTRY_PASSWORD.key').includes(REAL.kamalPassword),
        true,
      );
      assert.equal(
        readFile('infra/production/terraform.tfvars').includes(REAL.cloudflareToken),
        true,
      );
      assertNoRealSecret('UI file session grant', JSON.stringify(grant));
    } finally {
      runtime.revoke(grant.sessionId);
    }

    assertNoRealSecret('.env after UI revoke', readFile('.env'));
    assertNoRealSecret(
      'kamal key after UI revoke',
      readFile('.kamal/keys/KAMAL_REGISTRY_PASSWORD.key'),
    );
    assertNoRealSecret(
      'tfvars after UI revoke',
      readFile('infra/production/terraform.tfvars'),
    );
    assert.equal(store.getSession(grant.sessionId).status, 'revoked');
  });

  await socketModule.startCredentialSocket();

  await checkAsync('the CLI lists the group tree', async () => {
    const out = await runCli(['cred', 'list']);
    assert.equal(out.status, 0, `list failed: ${out.stderr}`);
    assert.match(out.stdout, /acme-app/);
    assert.match(out.stdout, /kamal/);
    assertNoRealSecret('cred list output', out.stdout + out.stderr);
  });

  await checkAsync('the CLI reports group status with masked values only', async () => {
    const out = await runCli(['cred', 'status', 'acme-app/rails']);
    assert.equal(out.status, 0, `status failed: ${out.stderr}`);
    assert.match(out.stdout, /REDIS_PASSWORD/);
    assert.match(out.stdout, /\*{8}/);
    assertNoRealSecret('cred status output', out.stdout + out.stderr);
  });

  await checkAsync('a run with no -- separator is rejected', async () => {
    assert.equal((await runCli(['cred', 'run', 'acme-app'])).status, 2);
  });

  const dumpPath = path.join(HOME, 'child-env.json');
  const dumpScript = path.join(HOME, 'dump-env.js');
  fs.writeFileSync(
    dumpScript,
    `const fs = require('fs');
const wanted = ['REDIS_PASSWORD', 'REDIS_URL', 'KAMAL_REGISTRY_PASSWORD', 'TF_VAR_cloudflare_api_token', 'TIGINAL_CRED_SESSION'];
const out = {};
for (const key of wanted) if (process.env[key] !== undefined) out[key] = process.env[key];
out.__files = Object.keys(process.env).filter((k) => k.startsWith('TIGINAL_CRED_FILE_')).map((k) => process.env[k]);
out.__fileContents = out.__files.map((file) => fs.readFileSync(file, 'utf8'));
fs.writeFileSync(${JSON.stringify(dumpPath)}, JSON.stringify(out));
`,
  );

  let grantedFiles = [];

  await checkAsync('a live run hands the real secrets to the child process', async () => {
    const out = await runCli([
      'cred', 'run', 'acme-app', '--yes', '--ttl', '5m',
      '--', NODE_EXEC, dumpScript,
    ]);
    assert.equal(out.status, 0, `run failed: ${out.stderr}`);

    const seen = JSON.parse(fs.readFileSync(dumpPath, 'utf8'));
    assert.equal(seen.REDIS_PASSWORD, REAL.redisPassword, 'the child must receive the real password');
    assert.ok(
      seen.__fileContents.some((content) => content.includes(REAL.kamalPassword)),
      'the child must read the real Kamal password from an ephemeral file',
    );
    assert.equal(
      seen.TF_VAR_cloudflare_api_token,
      REAL.cloudflareToken,
      'the child must receive the real Cloudflare token as a TF_VAR',
    );
    assert.ok(seen.TIGINAL_CRED_SESSION, 'the child must know its session id');
    grantedFiles = seen.__files || [];
  });

  await checkAsync('the CLI prints env var names but never a value', async () => {
    const out = await runCli([
      'cred', 'run', 'acme-app', '--yes',
      '--', NODE_EXEC, '-e', 'process.exit(0)',
    ]);
    assertNoRealSecret('cred run output', out.stdout + out.stderr);
    assert.match(out.stderr, /REDIS_PASSWORD/, 'the injected env var name should be reported');
  });

  check('the project files still hold masks after a live run', () => {
    assertNoRealSecret('.env after run', readFile('.env'));
    assertNoRealSecret('kamal key after run', readFile('.kamal/keys/KAMAL_REGISTRY_PASSWORD.key'));
    assertNoRealSecret('tfvars after run', readFile('infra/production/terraform.tfvars'));
  });

  check('ephemeral files are gone once the command exits', () => {
    for (const file of grantedFiles) {
      assert.equal(fs.existsSync(file), false, `${file} must be removed after the run`);
    }
    assert.deepEqual(sessionDirs(), [], 'no session directory may survive a normal exit');
  });

  await checkAsync('the command exit code is passed through', async () => {
    const out = await runCli([
      'cred', 'run', 'acme-app', '--yes',
      '--', NODE_EXEC, '-e', 'process.exit(7)',
    ]);
    assert.equal(out.status, 7);
  });

  const interrupted = await new Promise((resolve, reject) => {
    const child = spawn(
      NODE_EXEC,
      [
        path.join(REPO, 'bin', 'tiginal.js'), 'cred', 'run', 'acme-app', '--yes',
        '--', NODE_EXEC, '-e', 'setInterval(() => {}, 1000)',
      ],
      { cwd: PROJECT, env: { ...process.env, HOME: CONFIG_HOME }, stdio: ['ignore', 'pipe', 'pipe'] },
    );

    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);

    const killAt = setTimeout(() => child.kill('SIGTERM'), 2500);
    child.on('close', () => {
      clearTimeout(killAt);
      setTimeout(() => resolve(stderr), 500);
    });
  });

  check('a SIGTERM mid-command still cleans up the session directory', () => {
    assertNoRealSecret('interrupted run output', interrupted);
    assert.deepEqual(sessionDirs(), [], 'SIGTERM must leave no session directory behind');
  });

  await checkAsync('a locked master key denies a new session', async () => {
    crypto.lock();
    const out = await runCli([
      'cred', 'run', 'acme-app', '--yes',
      '--', NODE_EXEC, '-e', 'process.exit(0)',
    ]);
    assert.notEqual(out.status, 0, 'a locked app must refuse to grant credentials');
    assert.match(out.stderr, /lock/i);
  });

  socketModule.stopCredentialSocket();
  runtime.disposeAll();
}

run()
  .then(() => {
    process.stdout.write(`\n${passed}/${passed + failed} checks passed\n`);
    app.exit(failed === 0 ? 0 : 1);
  })
  .catch((error) => {
    process.stdout.write(`\nharness aborted after ${passed} checks: ${error && error.stack}\n`);
    app.exit(1);
  });
