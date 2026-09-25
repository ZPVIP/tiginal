const assert = require('node:assert/strict');
const test = require('node:test');
// The app's better-sqlite3 is built for Electron's ABI; Node's own SQLite has the same surface.
const { DatabaseSync } = require('node:sqlite');

const { DatabaseService } = require('../dist/main/services/database/database.js');

function sqliteWithBetterSqliteSurface() {
  const db = new DatabaseSync(':memory:');
  db.pragma = (statement, options) => {
    if (options?.simple) return Object.values(db.prepare(`PRAGMA ${statement}`).get())[0];
    db.exec(`PRAGMA ${statement}`);
    return undefined;
  };
  db.transaction = fn => (...args) => {
    db.exec('BEGIN');
    try {
      const result = fn(...args);
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  };
  return db;
}

test('migration v36 merges T3PO protocols, drops the untouched demo, and keeps session links', () => {
  const db = sqliteWithBetterSqliteSurface();
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE speech_providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      protocol TEXT NOT NULL CHECK (protocol IN ('r2t2-rstream', 'r2t2-native', 't3po-rstream', 't3po-native')),
      endpoint TEXT NOT NULL,
      auth_mode TEXT NOT NULL CHECK (auth_mode IN ('none', 'query-token', 'handshake-secret')),
      credential_encrypted TEXT,
      built_in_kind TEXT CHECK (built_in_kind IS NULL OR built_in_kind IN ('r2t2-online-trial', 't3po-online-trial')),
      user_modified INTEGER NOT NULL DEFAULT 0,
      max_session_seconds INTEGER,
      default_language TEXT NOT NULL,
      options_json TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE audio_sessions (
      id TEXT PRIMARY KEY,
      speech_provider_id TEXT,
      FOREIGN KEY (speech_provider_id) REFERENCES speech_providers(id) ON DELETE SET NULL
    );
    INSERT INTO speech_providers VALUES
      ('builtin-r2t2-online-demo', 'R2T2 Online Demo', 'r2t2-rstream', 'wss://r2t2.youdao.com/asr', 'query-token', NULL, 'r2t2-online-trial', 0, 30, 'zh', '{}', 1, 1, 1),
      ('builtin-t3po-online-demo', 'T3PO Online Demo', 't3po-rstream', 'wss://t3po.youdao.com/stream', 'query-token', NULL, 't3po-online-trial', 0, 30, 'zh', '{}', 1, 1, 1),
      ('local-t3po', 'Local T3PO', 't3po-native', 'ws://127.0.0.1:8273/ws/translate', 'handshake-secret', 'secret', NULL, 1, NULL, 'zh', '{}', 1, 1, 1);
    INSERT INTO audio_sessions VALUES ('session-1', 'builtin-r2t2-online-demo');
  `);

  const service = Object.create(DatabaseService.prototype);
  service.db = db;
  service.migrateV36();

  const rows = db.prepare('SELECT id, protocol, auth_mode, built_in_kind FROM speech_providers ORDER BY id').all();
  assert.deepEqual(rows.map(row => ({ ...row })), [
    { id: 'builtin-r2t2-online-demo', protocol: 'r2t2-rstream', auth_mode: 'query-token', built_in_kind: 'r2t2-online-trial' },
    { id: 'local-t3po', protocol: 't3po', auth_mode: 'query-token', built_in_kind: null },
  ]);
  assert.equal(db.prepare('SELECT speech_provider_id FROM audio_sessions').get().speech_provider_id, 'builtin-r2t2-online-demo');
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
  assert.throws(() => db.exec(`
    INSERT INTO speech_providers (id, name, protocol, endpoint, auth_mode, default_language, created_at, updated_at)
    VALUES ('old', 'Old', 't3po-rstream', 'ws://127.0.0.1/x', 'none', 'zh', 1, 1)
  `), /CHECK constraint failed/);
});

test('migration v36 keeps an edited T3PO demo as an ordinary provider', () => {
  const db = sqliteWithBetterSqliteSurface();
  db.exec(`
    CREATE TABLE speech_providers (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, protocol TEXT NOT NULL, endpoint TEXT NOT NULL,
      auth_mode TEXT NOT NULL, credential_encrypted TEXT, built_in_kind TEXT,
      user_modified INTEGER NOT NULL DEFAULT 0, max_session_seconds INTEGER, default_language TEXT NOT NULL,
      options_json TEXT NOT NULL DEFAULT '{}', enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE audio_sessions (id TEXT PRIMARY KEY, speech_provider_id TEXT);
    INSERT INTO speech_providers VALUES
      ('builtin-t3po-online-demo', 'My T3PO', 't3po-rstream', 'ws://127.0.0.1:8273/ws/translate', 'query-token', NULL, 't3po-online-trial', 1, NULL, 'zh', '{}', 1, 1, 1);
  `);

  const service = Object.create(DatabaseService.prototype);
  service.db = db;
  service.migrateV36();

  assert.deepEqual({ ...db.prepare('SELECT name, protocol, built_in_kind FROM speech_providers').get() }, {
    name: 'My T3PO',
    protocol: 't3po',
    built_in_kind: null,
  });
});

test('migration v36 removes a saved T3PO demo that still points at t3po.youdao.com', () => {
  const db = sqliteWithBetterSqliteSurface();
  db.exec(`
    CREATE TABLE speech_providers (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, protocol TEXT NOT NULL, endpoint TEXT NOT NULL,
      auth_mode TEXT NOT NULL, credential_encrypted TEXT, built_in_kind TEXT,
      user_modified INTEGER NOT NULL DEFAULT 0, max_session_seconds INTEGER, default_language TEXT NOT NULL,
      options_json TEXT NOT NULL DEFAULT '{}', enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE audio_sessions (id TEXT PRIMARY KEY, speech_provider_id TEXT);
    INSERT INTO speech_providers VALUES
      ('builtin-t3po-online-demo', 'T3PO Online Demo', 't3po-rstream', 'wss://t3po.youdao.com/asr', 'query-token', NULL, NULL, 1, 30, 'zh', '{}', 1, 1, 1);
  `);

  const service = Object.create(DatabaseService.prototype);
  service.db = db;
  service.migrateV36();

  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM speech_providers').get().count, 0);
});
