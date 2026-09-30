const assert = require('node:assert/strict');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');

const { DatabaseService } = require('../dist/main/services/database/database.js');
const { BUILT_IN_WHISPER_ID } = require('../dist/main/shared/audio/types.js');

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

test('migration v40 updates speech_providers table to allow whisper-local and inserts built-in provider', () => {
  const db = sqliteWithBetterSqliteSurface();
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE speech_providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      protocol TEXT NOT NULL CHECK (protocol IN ('r2t2-rstream', 'r2t2-native', 't3po')),
      endpoint TEXT NOT NULL,
      auth_mode TEXT NOT NULL CHECK (auth_mode IN ('none', 'query-token', 'handshake-secret')),
      credential_encrypted TEXT,
      built_in_kind TEXT CHECK (built_in_kind IS NULL OR built_in_kind IN ('r2t2-online-trial')),
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
      ('builtin-r2t2-online-demo', 'R2T2 Online Demo', 'r2t2-rstream', 'wss://r2t2.youdao.com/asr', 'query-token', NULL, 'r2t2-online-trial', 0, 30, 'zh', '{}', 1, 1, 1);
    INSERT INTO audio_sessions VALUES ('session-1', 'builtin-r2t2-online-demo');
  `);

  const service = Object.create(DatabaseService.prototype);
  service.db = db;
  service.migrateV40();

  const rows = db.prepare('SELECT id, name, protocol, auth_mode, built_in_kind FROM speech_providers ORDER BY id').all();
  assert.deepEqual(rows.map(row => ({ ...row })), [
    {
      id: 'builtin-r2t2-online-demo',
      name: 'R2T2 Online Demo',
      protocol: 'r2t2-rstream',
      auth_mode: 'query-token',
      built_in_kind: 'r2t2-online-trial',
    },
    {
      id: BUILT_IN_WHISPER_ID,
      name: 'Local Whisper (tiginal-diarize)',
      protocol: 'whisper-local',
      auth_mode: 'none',
      built_in_kind: 'whisper-local',
    },
  ]);

  // Session link is preserved
  assert.equal(db.prepare('SELECT speech_provider_id FROM audio_sessions WHERE id = ?').get('session-1').speech_provider_id, 'builtin-r2t2-online-demo');
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
});
