const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { AudioService } = require('../dist/main/main/audio/AudioService.js');
const { ChunkTimelineWriter } = require('../dist/main/main/audio/ChunkTimelineWriter.js');
const {
  alignChunksWithSpeakers,
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

test('ChunkTimelineWriter creates tab-separated timestamp and text entries', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tiginal-chunk-test-'));
  t.after(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const chunkFile = path.join(directory, 'test-chunk.txt');
  const writer = new ChunkTimelineWriter(chunkFile, 160);

  writer.recordDelta(160, '今');
  writer.recordDelta(320, '天我');
  writer.recordDelta(480, '去上班');
  writer.finalize();

  assert.equal(fs.existsSync(chunkFile), true);
  const content = fs.readFileSync(chunkFile, 'utf-8');
  assert.equal(content, '160\t今\n320\t天我\n480\t去上班\n');
});

test('formatSrtTime produces standard HH:MM:SS,mmm formatting', () => {
  assert.equal(formatSrtTime(0), '00:00:00,000');
  assert.equal(formatSrtTime(160), '00:00:00,160');
  assert.equal(formatSrtTime(65432), '00:01:05,432');
  assert.equal(formatSrtTime(3661005), '01:01:01,005');
});

test('alignChunksWithSpeakers, buildDiarizedText and buildSrtContent align text with speaker turns', () => {
  const entries = [
    { timestampMs: 300, text: '你好' },
    { timestampMs: 600, text: '世界。' },
    { timestampMs: 2500, text: '好的，' },
    { timestampMs: 3000, text: '收到。' },
  ];

  const turns = [
    { speaker: 0, start: 0.0, end: 1.0, start_ms: 0, end_ms: 1000 },
    { speaker: 1, start: 2.0, end: 3.5, start_ms: 2000, end_ms: 3500 },
  ];

  const segments = alignChunksWithSpeakers(entries, turns, 160, 300);
  assert.equal(segments.length, 2);
  assert.equal(segments[0].speakerLabel, 'Speaker 1');
  assert.equal(segments[0].text, '你好世界。');
  assert.equal(segments[1].speakerLabel, 'Speaker 2');
  assert.equal(segments[1].text, '好的，收到。');

  const diarText = buildDiarizedText(segments);
  assert.ok(diarText.includes('Speaker 1: 你好世界。'));
  assert.ok(diarText.includes('Speaker 2: 好的，收到。'));

  const srtText = buildSrtContent(segments);
  assert.ok(srtText.includes('[Speaker 1] 你好世界。'));
  assert.ok(srtText.includes('[Speaker 2] 好的，收到。'));
  assert.ok(srtText.includes('-->'));
});

test('AudioService.deleteRecording deletes all 4 text artifacts and the audio file', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tiginal-audio-all-delete-'));
  t.after(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const stem = '2026-09-28_11-30-30ZM6';
  const wavPath = path.join(directory, `${stem}.wav`);
  const txtPath = path.join(directory, `${stem}.txt`);
  const chunkPath = path.join(directory, `${stem}-chunk.txt`);
  const diarPath = path.join(directory, `${stem}-diar.txt`);
  const srtPath = path.join(directory, `${stem}.srt`);

  fs.writeFileSync(wavPath, 'wav data');
  fs.writeFileSync(txtPath, 'plain text');
  fs.writeFileSync(chunkPath, '160\tchunk');
  fs.writeFileSync(diarPath, 'Speaker 1: hello');
  fs.writeFileSync(srtPath, '1\n00:00:00,160 --> 00:00:01,000\nhello\n');

  const service = new AudioService({}, {}, directory);

  // Check getRecordingArtifacts reads all 4 text files
  const artifacts = service.getRecordingArtifacts(wavPath);
  assert.equal(artifacts.transcript, 'plain text');
  assert.equal(artifacts.chunks, '160\tchunk');
  assert.equal(artifacts.speakers, 'Speaker 1: hello');
  assert.equal(artifacts.srt, '1\n00:00:00,160 --> 00:00:01,000\nhello\n');

  // Trigger deletion
  service.deleteRecording(wavPath);

  assert.equal(fs.existsSync(wavPath), false);
  assert.equal(fs.existsSync(txtPath), false);
  assert.equal(fs.existsSync(chunkPath), false);
  assert.equal(fs.existsSync(diarPath), false);
  assert.equal(fs.existsSync(srtPath), false);
});

test('ensureChunkEntriesFromTranscript reconstructs timeline intervals from punctuation', () => {
  const { ensureChunkEntriesFromTranscript } = require('../dist/main/main/audio/AlignmentEngine.js');
  const transcript = '今天我去上班了。遇到一个老朋友，聊得很开心！';
  const entries = ensureChunkEntriesFromTranscript(transcript, 3000, 160);
  assert.ok(entries.length >= 2);
  assert.equal(entries[entries.length - 1].timestampMs, 3000);
  assert.ok(entries.some(e => e.text.includes('上班了')));
  assert.ok(entries.some(e => e.text.includes('开心')));
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
    options: { chunkSizeMs: 160 },
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
  const expectedChunk = path.join(userAudioDir, 'tell-me-why-chunk.txt');
  const expectedDiar = path.join(userAudioDir, 'tell-me-why-diar.txt');
  const expectedSrt = path.join(userAudioDir, 'tell-me-why.srt');

  assert.equal(fs.existsSync(expectedTxt), true);
  assert.equal(fs.existsSync(expectedChunk), true);
  assert.equal(fs.readFileSync(expectedTxt, 'utf-8'), 'Tell me why ain\'t nothing but a heartache.');

  // Check artifacts reading
  const artifacts = service.getRecordingArtifacts(userAudioPath);
  assert.equal(artifacts.transcript, 'Tell me why ain\'t nothing but a heartache.');
  assert.ok(artifacts.chunks);

  // Test deletion of existing audio + all 4 artifacts
  service.deleteRecording(userAudioPath);
  assert.equal(fs.existsSync(userAudioPath), false);
  assert.equal(fs.existsSync(expectedTxt), false);
  assert.equal(fs.existsSync(expectedChunk), false);
  assert.equal(fs.existsSync(expectedDiar), false);
  assert.equal(fs.existsSync(expectedSrt), false);
});

