const assert = require('node:assert/strict');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');

const { DatabaseService } = require('../dist/main/services/database/database.js');
const {
  configurePlatformAudioCapture,
  getAudioInputCapabilities,
  getMacAudioCaptureDisabledFeatures,
  getMacAudioCaptureEnabledFeatures,
  getSystemAudioPermissionInfo,
  MAC_SYSTEM_AUDIO_SETTINGS_URL,
} = require('../dist/main/main/audio/PlatformAudioCapture.js');
const {
  SYSTEM_AUDIO_DISPLAY_MEDIA_OPTIONS,
  shouldShowSystemAudioPermissionGuide,
} = require('../dist/main/shared/audio/types.js');

function displayMediaSession() {
  const state = { handler: null, options: undefined };
  return {
    state,
    session: {
      setDisplayMediaRequestHandler(handler, options) {
        state.handler = handler;
        state.options = options;
      },
    },
  };
}

function displayRequest(overrides = {}) {
  return {
    frame: null,
    securityOrigin: 'file://',
    videoRequested: true,
    audioRequested: true,
    userGesture: true,
    ...overrides,
  };
}

function invokeDisplayHandler(handler, request) {
  return new Promise(resolve => handler(request, resolve));
}

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

test('audio input capabilities hide system capture on Linux', () => {
  assert.deepEqual(getAudioInputCapabilities('linux').sources, ['microphone', 'file']);
  assert.deepEqual(getAudioInputCapabilities('freebsd').sources, ['microphone', 'file']);
  assert.deepEqual(getAudioInputCapabilities('darwin').sources, ['microphone', 'system', 'mixed', 'file']);
  assert.deepEqual(getAudioInputCapabilities('win32').sources, ['microphone', 'system', 'mixed', 'file']);
});

test('system audio capture explicitly requests monitor and window audio', () => {
  assert.deepEqual(SYSTEM_AUDIO_DISPLAY_MEDIA_OPTIONS, {
    audio: true,
    video: true,
    systemAudio: 'include',
    windowAudio: 'system',
    audioSelection: 'preferred',
  });
});

test('macOS system audio capture enables Chromium loopback feature flags', () => {
  assert.deepEqual(getMacAudioCaptureEnabledFeatures(), [
    'MacLoopbackAudioForScreenShare',
    'MacSckSystemAudioLoopbackOverride',
  ]);
});

test('packaged Electron 44 uses CoreAudio Tap while development keeps the ScreenCaptureKit fallback', () => {
  assert.deepEqual(getMacAudioCaptureDisabledFeatures({ isPackaged: false, electronMajor: 44 }), [
    'MacCatapLoopbackAudioForScreenShare',
  ]);
  assert.deepEqual(getMacAudioCaptureDisabledFeatures({ isPackaged: true, electronMajor: 44 }), []);
  assert.deepEqual(getMacAudioCaptureDisabledFeatures({ isPackaged: false, electronMajor: 45 }), []);
});

test('system audio permission guidance identifies the macOS permission owner', () => {
  assert.deepEqual(getSystemAudioPermissionInfo('linux', false, 'unknown'), { kind: 'unsupported' });
  assert.deepEqual(getSystemAudioPermissionInfo('darwin', true, 'granted'), {
    kind: 'macos',
    screenStatus: 'granted',
    permissionOwner: 'application',
  });
  assert.deepEqual(getSystemAudioPermissionInfo('darwin', false, 'denied'), {
    kind: 'macos',
    screenStatus: 'denied',
    permissionOwner: 'launcher',
  });
  assert.equal(
    MAC_SYSTEM_AUDIO_SETTINGS_URL,
    'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  );
});

test('system audio permission guide respects the macOS permission status', () => {
  assert.equal(shouldShowSystemAudioPermissionGuide({ kind: 'unsupported' }, false), false);
  assert.equal(shouldShowSystemAudioPermissionGuide({
    kind: 'macos',
    screenStatus: 'granted',
    permissionOwner: 'application',
  }, false), false);
  assert.equal(shouldShowSystemAudioPermissionGuide({
    kind: 'macos',
    screenStatus: 'unknown',
    permissionOwner: 'application',
  }, false), false);
  assert.equal(shouldShowSystemAudioPermissionGuide({
    kind: 'macos',
    screenStatus: 'denied',
    permissionOwner: 'application',
  }, false), true);
  assert.equal(shouldShowSystemAudioPermissionGuide({
    kind: 'macos',
    screenStatus: 'not-determined',
    permissionOwner: 'application',
  }, true), false);
});

test('macOS system audio capture grants a screen with loopback audio without system picker', async () => {
  const fake = displayMediaSession();
  const screen = { id: 'screen:1:0', name: 'Entire Screen' };
  configurePlatformAudioCapture({
    platform: 'darwin',
    displayMediaSession: fake.session,
    getScreenSources: async () => [screen],
  });

  assert.equal(typeof fake.state.handler, 'function');
  assert.equal(fake.state.options, undefined);
  assert.deepEqual(await invokeDisplayHandler(fake.state.handler, displayRequest()), {
    video: screen,
    audio: 'loopback',
  });
});

test('Windows system audio capture grants a screen with loopback audio', async () => {
  const fake = displayMediaSession();
  const screen = { id: 'screen:1:0', name: 'Entire Screen' };
  configurePlatformAudioCapture({
    platform: 'win32',
    displayMediaSession: fake.session,
    getScreenSources: async () => [screen],
  });

  assert.deepEqual(await invokeDisplayHandler(fake.state.handler, displayRequest()), {
    video: screen,
    audio: 'loopback',
  });
  assert.deepEqual(
    await invokeDisplayHandler(fake.state.handler, displayRequest({ userGesture: false })),
    {},
  );
});

test('Linux display media requests are denied', async () => {
  const fake = displayMediaSession();
  configurePlatformAudioCapture({
    platform: 'linux',
    displayMediaSession: fake.session,
    getScreenSources: async () => {
      throw new Error('should not enumerate screens');
    },
  });

  assert.deepEqual(await invokeDisplayHandler(fake.state.handler, displayRequest()), {});
});

test('migration v38 accepts system and mixed sources without changing existing sessions', () => {
  const db = sqliteWithBetterSqliteSurface();
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE speech_providers (id TEXT PRIMARY KEY);
    INSERT INTO speech_providers VALUES ('provider-1');
    CREATE TABLE audio_sessions (
      id TEXT PRIMARY KEY,
      source_kind TEXT NOT NULL CHECK (source_kind IN ('microphone', 'file')),
      source_path TEXT,
      recording_path TEXT,
      speech_provider_id TEXT,
      recognition_language TEXT NOT NULL,
      transcript TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK (status IN ('connecting', 'recording', 'finalizing', 'completed', 'failed', 'aborted')),
      duration_ms INTEGER NOT NULL DEFAULT 0,
      started_at_iso TEXT NOT NULL,
      timezone_offset_minutes INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (speech_provider_id) REFERENCES speech_providers(id) ON DELETE SET NULL
    );
    CREATE INDEX idx_audio_sessions_created ON audio_sessions(created_at DESC);
    INSERT INTO audio_sessions (
      id, source_kind, source_path, recording_path, speech_provider_id, recognition_language,
      status, started_at_iso, timezone_offset_minutes, created_at, updated_at
    ) VALUES
      ('mic-1', 'microphone', NULL, '/tmp/mic.wav', 'provider-1', 'en', 'completed', '2026-01-01T00:00:00.000Z', 0, 1, 1),
      ('file-1', 'file', 'sample.mp3', NULL, 'provider-1', 'en', 'completed', '2026-01-01T00:00:00.000Z', 0, 2, 2);
  `);

  const service = Object.create(DatabaseService.prototype);
  service.db = db;
  service.migrateV38();

  assert.deepEqual(
    db.prepare('SELECT id, source_kind, source_path FROM audio_sessions ORDER BY id').all().map(row => ({ ...row })),
    [
      { id: 'file-1', source_kind: 'file', source_path: 'sample.mp3' },
      { id: 'mic-1', source_kind: 'microphone', source_path: null },
    ],
  );

  const insert = db.prepare(`
    INSERT INTO audio_sessions (
      id, source_kind, speech_provider_id, recognition_language, status,
      started_at_iso, timezone_offset_minutes, created_at, updated_at
    ) VALUES (?, ?, 'provider-1', 'en', 'connecting', '2026-01-01T00:00:00.000Z', 0, 3, 3)
  `);
  insert.run('system-1', 'system');
  insert.run('mixed-1', 'mixed');
  assert.throws(() => insert.run('invalid-1', 'network'), /CHECK constraint failed/);
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
  assert.equal(db.prepare('PRAGMA foreign_key_list(audio_sessions)').get().table, 'speech_providers');
});
