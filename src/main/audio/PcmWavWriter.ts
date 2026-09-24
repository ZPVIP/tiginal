import * as fs from 'fs';
import * as path from 'path';
import { R2T2_CHANNELS, R2T2_SAMPLE_RATE } from '../../shared/audio/r2t2';

const WAV_HEADER_BYTES = 44;
const PCM_BITS_PER_SAMPLE = 16;
const MAX_WAV_DATA_BYTES = 0xffffffff - 36;

export function createPcmWavHeader(
  dataBytes: number,
  sampleRate = R2T2_SAMPLE_RATE,
  channels = R2T2_CHANNELS,
): Buffer {
  if (!Number.isInteger(dataBytes) || dataBytes < 0 || dataBytes > MAX_WAV_DATA_BYTES) {
    throw new Error('WAV data length is out of range');
  }
  const bytesPerSample = PCM_BITS_PER_SAMPLE / 8;
  const blockAlign = channels * bytesPerSample;
  const header = Buffer.alloc(WAV_HEADER_BYTES);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * blockAlign, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(PCM_BITS_PER_SAMPLE, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(dataBytes, 40);
  return header;
}

export class PcmWavWriter {
  private readonly partialPath: string;
  private descriptor: number | null;
  private dataBytes = 0;
  private finalized = false;

  constructor(readonly finalPath: string) {
    fs.mkdirSync(path.dirname(finalPath), { recursive: true });
    this.partialPath = `${finalPath}.part`;
    this.descriptor = fs.openSync(this.partialPath, 'wx');
    fs.writeSync(this.descriptor, createPcmWavHeader(0));
  }

  write(frame: Int16Array): void {
    if (this.finalized || this.descriptor === null) throw new Error('WAV writer is closed');
    const bytes = Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength);
    if (this.dataBytes + bytes.length > MAX_WAV_DATA_BYTES) {
      throw new Error('Recording exceeds the WAV size limit');
    }
    fs.writeSync(this.descriptor, bytes);
    this.dataBytes += bytes.length;
  }

  durationMs(): number {
    const sampleCount = this.dataBytes / (PCM_BITS_PER_SAMPLE / 8) / R2T2_CHANNELS;
    return Math.round((sampleCount / R2T2_SAMPLE_RATE) * 1_000);
  }

  finalize(): string {
    if (this.finalized) return this.finalPath;
    if (this.descriptor === null) throw new Error('WAV writer is not open');
    fs.writeSync(this.descriptor, createPcmWavHeader(this.dataBytes), 0, WAV_HEADER_BYTES, 0);
    fs.fsyncSync(this.descriptor);
    fs.closeSync(this.descriptor);
    this.descriptor = null;
    fs.renameSync(this.partialPath, this.finalPath);
    this.finalized = true;
    return this.finalPath;
  }
}
