const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  createAudioRecordingPath,
  formatAudioFilename,
  formatTimezoneToken,
} = require('../dist/main/main/audio/AudioFilename.js');
const { PcmWavWriter } = require('../dist/main/main/audio/PcmWavWriter.js');
const { AudioService } = require('../dist/main/main/audio/AudioService.js');

test('timezone tokens cover whole-hour and fractional UTC offsets', () => {
  assert.equal(formatTimezoneToken(420), 'ZM7');
  assert.equal(formatTimezoneToken(-480), 'ZP8');
  assert.equal(formatTimezoneToken(-330), 'ZP5H30');
  assert.equal(formatTimezoneToken(-345), 'ZP5H45');
});

test('recording filenames use local time, portable separators, and collision suffixes', () => {
  const date = new Date(2026, 8, 23, 15, 59, 35);
  const zone = formatTimezoneToken(date.getTimezoneOffset());
  assert.equal(formatAudioFilename(date, 'darwin'), `2026-09-23_15-59-35${zone}.wav`);
  assert.equal(formatAudioFilename(date, 'win32'), `2026-09-23_15-59-35${zone}.wav`);

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tiginal-audio-name-'));
  const first = createAudioRecordingPath(directory, date, 'darwin');
  fs.writeFileSync(first, 'occupied');
  const second = createAudioRecordingPath(directory, date, 'darwin');
  assert.match(second, /_01\.wav$/);
});

test('recording deletion is limited to finalized WAV files in the audio directory', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tiginal-audio-delete-'));
  const outsideDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'tiginal-audio-outside-'));
  t.after(() => {
    fs.rmSync(directory, { recursive: true, force: true });
    fs.rmSync(outsideDirectory, { recursive: true, force: true });
  });
  const recordingPath = path.join(directory, 'recording.wav');
  const outsidePath = path.join(outsideDirectory, 'recording.wav');
  fs.writeFileSync(recordingPath, 'audio');
  fs.writeFileSync(outsidePath, 'audio');
  const service = new AudioService({}, {}, directory);

  service.deleteRecording(recordingPath);
  assert.equal(fs.existsSync(recordingPath), false);
  assert.throws(() => service.deleteRecording(outsidePath), /outside the Tiginal audio directory/);
  assert.equal(fs.existsSync(outsidePath), true);
});

test('streaming WAV writer patches a playable PCM header and atomically finalizes', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tiginal-audio-wav-'));
  const outputPath = path.join(directory, 'recording.wav');
  const writer = new PcmWavWriter(outputPath);
  writer.write(Int16Array.from([0, 1000, -1000]));
  writer.write(Int16Array.from([32767, -32768]));

  assert.equal(writer.durationMs(), 0);
  assert.equal(fs.existsSync(`${outputPath}.part`), true);
  assert.equal(writer.finalize(), outputPath);
  assert.equal(fs.existsSync(`${outputPath}.part`), false);

  const wav = fs.readFileSync(outputPath);
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  assert.equal(wav.readUInt16LE(20), 1);
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt32LE(24), 16_000);
  assert.equal(wav.readUInt16LE(34), 16);
  assert.equal(wav.readUInt32LE(40), 10);
  assert.equal(wav.length, 54);
  assert.deepEqual([...new Int16Array(wav.buffer, wav.byteOffset + 44, 5)], [0, 1000, -1000, 32767, -32768]);
});
