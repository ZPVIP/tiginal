const assert = require('node:assert/strict');
const test = require('node:test');

const {
  BUILT_IN_R2T2_TRIAL_ENDPOINT,
  BUILT_IN_R2T2_TRIAL_ID,
  BUILT_IN_R2T2_TRIAL_TOKEN,
} = require('../dist/main/shared/audio/types.js');
const {
  normalizeSpeechEndpoint,
  parseSpeechProviderInput,
  SpeechProviderStore,
} = require('../dist/main/main/audio/SpeechProviderStore.js');

class FakeDatabase {
  constructor(initialRows) {
    this.rows = new Map(initialRows.map(row => [row.id, row]));
  }

  prepare(sql) {
    const statement = sql.replace(/\s+/g, ' ').trim();
    if (statement.startsWith('SELECT') && statement.includes('WHERE id = ?')) {
      return { get: id => this.rows.get(id) };
    }
    if (statement.startsWith('SELECT')) {
      return { all: () => [...this.rows.values()] };
    }
    if (statement.startsWith('INSERT INTO speech_providers')) {
      return { run: (...values) => {
        const [
          id, name, protocol, endpoint, authMode, credentialEncrypted,
          maxSessionSeconds, defaultLanguage, optionsJson, enabled, createdAt, updatedAt,
        ] = values;
        this.rows.set(id, {
          id,
          name,
          protocol,
          endpoint,
          auth_mode: authMode,
          credential_encrypted: credentialEncrypted,
          built_in_kind: null,
          user_modified: 1,
          max_session_seconds: maxSessionSeconds,
          default_language: defaultLanguage,
          options_json: optionsJson,
          enabled,
          created_at: createdAt,
          updated_at: updatedAt,
        });
      } };
    }
    if (statement.startsWith('UPDATE speech_providers')) {
      if (statement.includes("protocol = 'r2t2-rstream'")) {
        return { run: (name, endpoint, maxSessionSeconds, optionsJson, updatedAt, id) => {
          const current = this.rows.get(id);
          this.rows.set(id, {
            ...current,
            name,
            protocol: 'r2t2-rstream',
            endpoint,
            auth_mode: 'query-token',
            credential_encrypted: null,
            user_modified: 0,
            max_session_seconds: maxSessionSeconds,
            default_language: 'zh',
            options_json: optionsJson,
            enabled: 1,
            updated_at: updatedAt,
          });
        } };
      }
      return { run: (...values) => {
        const [
          name, protocol, endpoint, authMode, credentialEncrypted, userModified,
          maxSessionSeconds, defaultLanguage, optionsJson, enabled, updatedAt, id,
        ] = values;
        const current = this.rows.get(id);
        this.rows.set(id, {
          ...current,
          name,
          protocol,
          endpoint,
          auth_mode: authMode,
          credential_encrypted: credentialEncrypted,
          user_modified: userModified,
          max_session_seconds: maxSessionSeconds,
          default_language: defaultLanguage,
          options_json: optionsJson,
          enabled,
          updated_at: updatedAt,
        });
      } };
    }
    if (statement.startsWith('DELETE FROM speech_providers')) {
      return { run: id => this.rows.delete(id) };
    }
    throw new Error(`Unsupported fake SQL: ${statement}`);
  }
}

function createStore(unlocked = true) {
  const builtInRow = {
    id: BUILT_IN_R2T2_TRIAL_ID,
    name: 'R2T2 Online Demo',
    protocol: 'r2t2-rstream',
    endpoint: BUILT_IN_R2T2_TRIAL_ENDPOINT,
    auth_mode: 'query-token',
    credential_encrypted: null,
    built_in_kind: 'r2t2-online-trial',
    user_modified: 0,
    max_session_seconds: 30,
    default_language: 'zh',
    options_json: JSON.stringify({ bookedWords: [], useVad: false, smooth: true, mode: 'slow', systemPrompt: '' }),
    enabled: 1,
    created_at: 1,
    updated_at: 1,
  };
  const db = new FakeDatabase([builtInRow]);
  const cryptoService = {
    isUnlocked: () => unlocked,
    encrypt: value => `encrypted:${value}`,
    decrypt: value => value.slice('encrypted:'.length),
  };
  return { db, store: new SpeechProviderStore(db, cryptoService) };
}

function customInput(overrides = {}) {
  return {
    name: 'Local R2T2',
    protocol: 'r2t2-native',
    endpoint: 'ws://127.0.0.1:10086/asr_stream_api_v1',
    authMode: 'handshake-secret',
    credential: 'private-token',
    maxSessionSeconds: null,
    defaultLanguage: 'en',
    options: { bookedWords: [], useVad: true, smooth: true, mode: 'slow', systemPrompt: '' },
    enabled: true,
    ...overrides,
  };
}

test('bundled trial resolves the public token without storing it in SQLite', () => {
  const { db, store } = createStore();
  const resolved = store.require(BUILT_IN_R2T2_TRIAL_ID);
  assert.equal(resolved.provider.maxSessionSeconds, 30);
  assert.equal(resolved.credential, BUILT_IN_R2T2_TRIAL_TOKEN);
  assert.equal(db.rows.get(BUILT_IN_R2T2_TRIAL_ID).credential_encrypted, null);
});

test('custom provider tokens are encrypted and endpoint query tokens are removed', () => {
  const { db, store } = createStore();
  const added = store.add(customInput({
    protocol: 'r2t2-rstream',
    endpoint: 'wss://speech.example/asr?t=query-token',
    authMode: 'query-token',
    credential: undefined,
  }));
  const row = db.rows.get(added.id);
  assert.equal(row.endpoint, 'wss://speech.example/asr');
  assert.equal(row.credential_encrypted, 'encrypted:query-token');
  assert.equal(store.require(added.id).credential, 'query-token');
});

test('locked credential storage rejects new secrets and remote ws endpoints', () => {
  const { store } = createStore(false);
  assert.throws(() => store.add(customInput()), /Unlock credential storage/);
  assert.throws(() => normalizeSpeechEndpoint('ws://speech.example/asr'), /must use wss/);
  assert.equal(normalizeSpeechEndpoint('ws://localhost:10086/asr').endpoint, 'ws://localhost:10086/asr');
  assert.throws(
    () => parseSpeechProviderInput(customInput({ protocol: 'r2t2-native', authMode: 'query-token' })),
    /handshake-secret or no authentication/,
  );
});

test('demo preset is editable and deletable like any other speech provider', () => {
  const { db, store } = createStore();
  const updated = store.update({
    ...customInput({
      id: BUILT_IN_R2T2_TRIAL_ID,
      name: 'Changed Name',
      endpoint: 'wss://other.example/asr',
      maxSessionSeconds: 600,
      defaultLanguage: 'en',
    }),
    id: BUILT_IN_R2T2_TRIAL_ID,
  });
  assert.equal(updated.name, 'Changed Name');
  assert.equal(updated.endpoint, 'wss://other.example/asr');
  assert.equal(updated.maxSessionSeconds, 600);
  assert.equal(store.require(updated.id).credential, 'private-token');

  store.delete(BUILT_IN_R2T2_TRIAL_ID);
  assert.equal(db.rows.has(BUILT_IN_R2T2_TRIAL_ID), false);
});

test('demo token follows the configured endpoint', () => {
  const { store } = createStore();
  const renamed = store.update({
    ...customInput({
      id: BUILT_IN_R2T2_TRIAL_ID,
      name: 'My Demo',
      protocol: 'r2t2-rstream',
      endpoint: BUILT_IN_R2T2_TRIAL_ENDPOINT,
      authMode: 'query-token',
      credential: undefined,
      maxSessionSeconds: null,
    }),
    id: BUILT_IN_R2T2_TRIAL_ID,
  });
  assert.equal(renamed.name, 'My Demo');
  assert.equal(store.require(renamed.id).credential, BUILT_IN_R2T2_TRIAL_TOKEN);

  const moved = store.update({
    ...customInput({
      id: BUILT_IN_R2T2_TRIAL_ID,
      protocol: 'r2t2-rstream',
      endpoint: 'wss://other.example/asr',
      authMode: 'query-token',
      credential: undefined,
    }),
    id: BUILT_IN_R2T2_TRIAL_ID,
  });
  assert.equal(store.require(moved.id).credential, null);
});
