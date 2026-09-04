const test = require('node:test');
const assert = require('node:assert/strict');

const {
  toCredentialTreePath,
} = require('../dist/main/shared/credentials/platform-paths.js');
const {
  credentialConfigDir,
  credentialSocketPathFor,
} = require('../dist/main/shared/credentials/local-endpoint.js');

test('POSIX credential paths keep every physical path segment', () => {
  assert.equal(
    toCredentialTreePath('/Users/alice/work/app/.env', 'darwin'),
    'Filesystem/Users/alice/work/app/.env',
  );
  assert.equal(
    toCredentialTreePath('/home/alice/work/app/.env', 'linux'),
    'Filesystem/home/alice/work/app/.env',
  );
});

test('Windows drive paths use the drive as the tree root', () => {
  assert.equal(
    toCredentialTreePath('C:\\Users\\alice\\work\\app\\.env', 'win32'),
    'C:/Users/alice/work/app/.env',
  );
});

test('Windows UNC paths retain server and share names', () => {
  assert.equal(
    toCredentialTreePath('\\\\server\\share\\team\\app\\.env', 'win32'),
    'Network/server/share/team/app/.env',
  );
});

test('credential service endpoints use native per-user locations', () => {
  assert.equal(
    credentialSocketPathFor({
      platform: 'darwin',
      homeDir: '/Users/alice',
      username: 'alice',
    }),
    '/Users/alice/.config/tiginal/cred.sock',
  );
  assert.equal(
    credentialConfigDir({
      platform: 'win32',
      homeDir: 'C:\\Users\\alice',
      appData: 'C:\\Users\\alice\\AppData\\Roaming',
      username: 'DOMAIN\\alice',
    }),
    'C:\\Users\\alice\\AppData\\Roaming\\Tiginal',
  );
  assert.equal(
    credentialSocketPathFor({
      platform: 'win32',
      homeDir: 'C:\\Users\\alice',
      appData: 'C:\\Users\\alice\\AppData\\Roaming',
      username: 'DOMAIN\\alice',
    }),
    '\\\\.\\pipe\\tiginal-cred-DOMAIN_alice',
  );
});
