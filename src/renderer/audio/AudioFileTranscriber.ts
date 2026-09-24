import type {
  AudioSessionEvent,
  AudioSessionSnapshot,
  CreateAudioSessionInput,
} from '../../shared/audio/types';
import { StreamingPcm16Framer } from '../../shared/audio/pcm';
import { R2T2_FRAME_DURATION_MS } from '../../shared/audio/r2t2';

export interface AudioFileMetadata {
  durationSeconds: number;
  channels: number;
}

export interface AudioFileTranscriberCallbacks {
  onProgress?(progress: number): void;
  onSessionEvent?(event: AudioSessionEvent): void;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, milliseconds));
}

async function decodeFile(file: File): Promise<{ buffer: AudioBuffer; context: AudioContext }> {
  const context = new AudioContext();
  try {
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    return { buffer, context };
  } catch (error) {
    await context.close();
    throw error;
  }
}

function monoChunk(buffer: AudioBuffer, start: number, length: number): Float32Array {
  const output = new Float32Array(length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const samples = buffer.getChannelData(channel);
    for (let index = 0; index < length; index += 1) {
      output[index] += (samples[start + index] ?? 0) / buffer.numberOfChannels;
    }
  }
  return output;
}

export async function inspectAudioFile(file: File): Promise<AudioFileMetadata> {
  const { buffer, context } = await decodeFile(file);
  try {
    return {
      durationSeconds: buffer.duration,
      channels: buffer.numberOfChannels,
    };
  } finally {
    await context.close();
  }
}

export class AudioFileTranscriber {
  private session: AudioSessionSnapshot | null = null;
  private removeSessionListener: (() => void) | null = null;
  private cancelled = false;
  private finishRequested = false;
  private finishedByService = false;

  constructor(private readonly callbacks: AudioFileTranscriberCallbacks = {}) {}

  async start(file: File, input: CreateAudioSessionInput): Promise<void> {
    if (this.session || this.removeSessionListener) throw new Error('Audio file transcription is already active');
    const audio = window.electron?.audio;
    if (!audio) throw new Error('Audio API is unavailable');

    this.cancelled = false;
    this.finishRequested = false;
    this.finishedByService = false;
    this.removeSessionListener = audio.onSessionEvent(event => {
      const belongsToSession = event.kind === 'session-created' || event.sessionId === this.session?.id;
      if (!belongsToSession) return;
      this.callbacks.onSessionEvent?.(event);
      if (event.kind === 'completed' || event.kind === 'failed') {
        this.finishedByService = true;
        this.session = null;
      }
    });

    const { buffer, context } = await decodeFile(file);
    try {
      this.session = await audio.createSession({
        ...input,
        source: { kind: 'file', name: file.name },
      });
      await this.sendBuffer(buffer);
      const sessionId = this.session?.id;
      if (!this.cancelled && !this.finishedByService && sessionId) {
        await audio.finishSession(sessionId);
      }
    } catch (error) {
      const sessionId = this.session?.id;
      if (sessionId) await audio.abortSession(sessionId);
      throw error;
    } finally {
      this.session = null;
      this.removeSessionListener?.();
      this.removeSessionListener = null;
      await context.close();
    }
  }

  async abort(): Promise<void> {
    this.cancelled = true;
    const sessionId = this.session?.id;
    this.session = null;
    if (sessionId) await window.electron?.audio.abortSession(sessionId);
    this.removeSessionListener?.();
    this.removeSessionListener = null;
  }

  requestFinish(): void {
    this.finishRequested = true;
  }

  private async sendBuffer(buffer: AudioBuffer): Promise<void> {
    const audio = window.electron?.audio;
    if (!audio) throw new Error('Audio API is unavailable');
    const framer = new StreamingPcm16Framer(buffer.sampleRate);
    const chunkSamples = 4_096;
    const totalSamples = buffer.length;

    for (let offset = 0; offset < totalSamples && !this.cancelled && !this.finishRequested && !this.finishedByService; offset += chunkSamples) {
      const length = Math.min(chunkSamples, totalSamples - offset);
      const frames = framer.push(monoChunk(buffer, offset, length));
      for (const frame of frames) {
        if (this.cancelled || this.finishRequested || this.finishedByService) break;
        const sessionId = this.session?.id;
        if (!sessionId) break;
        audio.pushPcmFrame({
          sessionId,
          frame: frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength),
        });
        await wait(R2T2_FRAME_DURATION_MS);
      }
      this.callbacks.onProgress?.(Math.min(1, (offset + length) / totalSamples));
    }

    if (!this.cancelled && !this.finishRequested && !this.finishedByService) {
      for (const frame of framer.flush()) {
        const sessionId = this.session?.id;
        if (!sessionId) break;
        audio.pushPcmFrame({
          sessionId,
          frame: frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength),
        });
      }
      this.callbacks.onProgress?.(1);
    }
  }
}
