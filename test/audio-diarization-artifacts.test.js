const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { AudioService } = require('../dist/main/main/audio/AudioService.js');
const {
  buildDiarizedText,
  buildSrtContent,
  formatSrtTime,
} = require('../dist/main/main/audio/AlignmentEngine.js');
const { engineSpec } = require('../dist/main/main/models/EngineCatalog.js');

test('EngineCatalog contains tiginal-diarize with Homebrew install hints', () => {
  const spec = engineSpec('tiginal-diarize');
  assert.equal(spec.id, 'tiginal-diarize');
  assert.equal(spec.name, 'Tiginal Diarize');
  assert.deepEqual(spec.probes[0].args, ['--version']);
  assert.ok(spec.installHints.darwin.some(h => h.includes('brew tap ZPVIP/tiginal-diarize')));
});

test('formatSrtTime produces standard HH:MM:SS,mmm formatting', () => {
  assert.equal(formatSrtTime(0), '00:00:00,000');
  assert.equal(formatSrtTime(160), '00:00:00,160');
  assert.equal(formatSrtTime(65432), '00:01:05,432');
  assert.equal(formatSrtTime(3661005), '01:01:01,005');
});

test('buildDiarizedText and buildSrtContent format diarized segments correctly', () => {
  const segments = [
    {
      speakerId: 0,
      speakerLabel: 'Speaker 1',
      startMs: 0,
      endMs: 1000,
      text: '你好世界。',
    },
    {
      speakerId: 1,
      speakerLabel: 'Speaker 2',
      startMs: 2000,
      endMs: 3500,
      text: '好的，收到。',
    },
  ];

  const diarText = buildDiarizedText(segments);
  assert.ok(diarText.includes('Speaker 1: 你好世界。'));
  assert.ok(diarText.includes('Speaker 2: 好的，收到。'));

  const srtText = buildSrtContent(segments);
  assert.ok(srtText.includes('[Speaker 1] 你好世界。'));
  assert.ok(srtText.includes('[Speaker 2] 好的，收到。'));
  assert.ok(srtText.includes('00:00:00,000 --> 00:00:01,000'));
});

test('AudioService.deleteRecording deletes all text artifacts and the audio file', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tiginal-audio-all-delete-'));
  t.after(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const stem = '2026-09-28_11-30-30ZM6';
  const wavPath = path.join(directory, `${stem}.wav`);
  const txtPath = path.join(directory, `${stem}.txt`);
  const diarPath = path.join(directory, `${stem}-diar.txt`);
  const srtPath = path.join(directory, `${stem}.srt`);

  fs.writeFileSync(wavPath, 'wav data');
  fs.writeFileSync(txtPath, 'plain text');
  fs.writeFileSync(diarPath, 'Speaker 1: hello');
  fs.writeFileSync(srtPath, '1\n00:00:00,160 --> 00:00:01,000\nhello\n');

  const service = new AudioService({}, {}, directory);

  // Check getRecordingArtifacts reads all text files
  const artifacts = service.getRecordingArtifacts(wavPath);
  assert.equal(artifacts.transcript, 'plain text');
  assert.equal(artifacts.speakers, 'Speaker 1: hello');
  assert.equal(artifacts.srt, '1\n00:00:00,160 --> 00:00:01,000\nhello\n');

  // Trigger deletion
  service.deleteRecording(wavPath);

  assert.equal(fs.existsSync(wavPath), false);
  assert.equal(fs.existsSync(txtPath), false);
  assert.equal(fs.existsSync(diarPath), false);
  assert.equal(fs.existsSync(srtPath), false);
});

test('existing audio file input does not create duplicate audio and saves artifacts with matching stem', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tiginal-existing-file-'));
  const userAudioDir = fs.mkdtempSync(path.join(os.tmpdir(), 'user-music-'));
  t.after(() => {
    fs.rmSync(directory, { recursive: true, force: true });
    fs.rmSync(userAudioDir, { recursive: true, force: true });
  });

  const userAudioPath = path.join(userAudioDir, 'tell-me-why.wav');
  fs.writeFileSync(userAudioPath, 'RIFF....WAVEfmt ');

  const fakeProvider = {
    id: 'prov-1',
    name: 'R2T2',
    protocol: 'r2t2',
    defaultLanguage: 'en',
    maxSessionSeconds: null,
    options: {},
  };

  const fakeStore = {
    require: () => ({ provider: fakeProvider, credential: null }),
  };

  const fakeRepo = {
    insert: () => {},
    updateStatus: () => {},
    updateTranscript: () => {},
    hasRecording: (p) => p === userAudioPath,
  };

  const { SpeechStreamClient } = require('../dist/main/main/audio/SpeechStreamClient.js');
  t.mock.method(SpeechStreamClient.prototype, 'connect', async () => {});
  t.mock.method(SpeechStreamClient.prototype, 'finish', async () => {});

  const service = new AudioService(fakeStore, fakeRepo, directory);

  // 1. Create session with source kind = 'file' and existing path
  const snapshot = await service.createSession(
    {
      providerId: 'prov-1',
      source: { kind: 'file', name: 'tell-me-why.wav', path: userAudioPath },
    },
    () => {},
  );

  assert.equal(snapshot.recordingPath, userAudioPath);
  // Verify Tiginal directory contains NO audio files generated
  const tiginalDirFiles = fs.readdirSync(directory);
  assert.equal(tiginalDirFiles.length, 0);

  // 2. Simulate provider speech events and finish session
  const activeSession = service['sessions'].get(snapshot.id);
  assert.ok(activeSession);
  assert.equal(activeSession.writer, null); // No duplicate wav writer!
  activeSession.committedText = 'Tell me why ain\'t nothing but a heartache.';

  await service.finishSession(snapshot.id);

  // Verify derived artifacts are generated in userAudioDir with matching stem
  const expectedTxt = path.join(userAudioDir, 'tell-me-why.txt');

  assert.equal(fs.existsSync(expectedTxt), true);
  assert.equal(fs.readFileSync(expectedTxt, 'utf-8'), 'Tell me why ain\'t nothing but a heartache.');

  // Check artifacts reading
  const artifacts = service.getRecordingArtifacts(userAudioPath);
  assert.equal(artifacts.transcript, 'Tell me why ain\'t nothing but a heartache.');

  // Test deletion of existing audio + all artifacts
  service.deleteRecording(userAudioPath);
  assert.equal(fs.existsSync(userAudioPath), false);
  assert.equal(fs.existsSync(expectedTxt), false);
});

test('AudioService.deleteRecordingArtifact deletes only the selected artifact file', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tiginal-artifact-delete-'));
  t.after(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const stem = '2026-09-29_00-09-14ZM6';
  const wavPath = path.join(directory, `${stem}.wav`);
  const txtPath = path.join(directory, `${stem}.txt`);
  const diarPath = path.join(directory, `${stem}-diar.txt`);
  const srtPath = path.join(directory, `${stem}.srt`);

  fs.writeFileSync(wavPath, 'wav data');
  fs.writeFileSync(txtPath, 'plain text');
  fs.writeFileSync(diarPath, 'Speaker 1: hello');
  fs.writeFileSync(srtPath, '1\n00:00:00,160 --> 00:00:01,000\nhello\n');

  const service = new AudioService({}, {}, directory);

  // 1. Delete SRT
  const afterSrt = service.deleteRecordingArtifact(wavPath, 'srt');
  assert.equal(fs.existsSync(srtPath), false);
  assert.equal(fs.existsSync(wavPath), true);
  assert.equal(fs.existsSync(txtPath), true);
  assert.equal(fs.existsSync(diarPath), true);
  assert.equal(afterSrt.srt, undefined);
  assert.equal(afterSrt.speakers, 'Speaker 1: hello');
  assert.equal(afterSrt.transcript, 'plain text');

  // 2. Delete Speakers
  const afterSpeakers = service.deleteRecordingArtifact(wavPath, 'speakers');
  assert.equal(fs.existsSync(diarPath), false);
  assert.equal(fs.existsSync(wavPath), true);
  assert.equal(fs.existsSync(txtPath), true);
  assert.equal(afterSpeakers.speakers, undefined);
  assert.equal(afterSpeakers.transcript, 'plain text');

  // 3. Delete Transcript
  const afterTxt = service.deleteRecordingArtifact(wavPath, 'transcript');
  assert.equal(fs.existsSync(txtPath), false);
  assert.equal(fs.existsSync(wavPath), true);
  assert.equal(afterTxt.transcript, undefined);
});

