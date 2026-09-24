const assert = require('node:assert/strict');
const test = require('node:test');

const {
  floatToPcm16,
  StreamingLinearResampler,
  StreamingPcm16Framer,
} = require('../dist/main/shared/audio/pcm.js');

function resampleInChunks(sourceRate, sampleCount, chunkSizes) {
  const resampler = new StreamingLinearResampler(sourceRate, 16_000);
  const output = [];
  let offset = 0;
  let chunkIndex = 0;
  while (offset < sampleCount) {
    const end = Math.min(sampleCount, offset + chunkSizes[chunkIndex % chunkSizes.length]);
    output.push(...resampler.push(new Float32Array(end - offset).fill(0.25)));
    offset = end;
    chunkIndex += 1;
  }
  output.push(...resampler.flush());
  return output;
}

test('PCM16 conversion clips the full input range', () => {
  assert.deepEqual(
    [...floatToPcm16(Float32Array.from([-2, -1, -0.5, 0, 0.5, 1, 2]))],
    [-32768, -32768, -16384, 0, 16384, 32767, 32767],
  );
});

test('streaming resampling preserves one second across callback boundaries', () => {
  assert.equal(resampleInChunks(48_000, 48_000, [128]).length, 16_000);
  assert.equal(resampleInChunks(44_100, 44_100, [127, 113, 257]).length, 16_000);
  assert.equal(resampleInChunks(8_000, 8_000, [31, 67]).length, 16_000);
});

test('streaming resampling matches a single-buffer interpolation', () => {
  const input = Float32Array.from({ length: 4_410 }, (_, index) => Math.sin(index / 20));
  const run = chunkSizes => {
    const resampler = new StreamingLinearResampler(44_100, 16_000);
    const output = [];
    let offset = 0;
    let chunkIndex = 0;
    while (offset < input.length) {
      const end = Math.min(input.length, offset + chunkSizes[chunkIndex % chunkSizes.length]);
      output.push(...resampler.push(input.slice(offset, end)));
      offset = end;
      chunkIndex += 1;
    }
    output.push(...resampler.flush());
    return output;
  };

  const singleBuffer = run([input.length]);
  const callbackSized = run([127, 113, 257]);
  assert.equal(callbackSized.length, singleBuffer.length);
  for (let index = 0; index < singleBuffer.length; index += 1) {
    assert.ok(Math.abs(callbackSized[index] - singleBuffer[index]) < 0.000001);
  }
});

test('PCM framer emits 160 ms frames and one final remainder', () => {
  const framer = new StreamingPcm16Framer(44_100);
  const frames = [];
  let offset = 0;
  while (offset < 44_100) {
    const count = Math.min(131, 44_100 - offset);
    frames.push(...framer.push(new Float32Array(count).fill(0.1)));
    offset += count;
  }
  frames.push(...framer.flush());

  assert.deepEqual(frames.map(frame => frame.length), [2560, 2560, 2560, 2560, 2560, 2560, 640]);
  assert.equal(frames.reduce((sum, frame) => sum + frame.length, 0), 16_000);
});
