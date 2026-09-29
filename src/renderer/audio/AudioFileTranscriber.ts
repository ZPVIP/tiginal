import {
  BUILT_IN_WHISPER_ID,
  type AudioSessionEvent,
  type AudioSessionSnapshot,
  type CreateAudioSessionInput,
} from '../../shared/audio/types';
import { StreamingPcm16Framer } from '../../shared/audio/pcm';

export interface AudioFileMetadata {
  durationSeconds: number;
  channels: number;
}

export interface AudioFileTranscriberCallbacks {
  onProgress?(progress: number): void;
  onSessionEvent?(event: AudioSessionEvent): void;
}

// A file streams at the speech server's pace: after each burst, wait until the server has taken most of the queue.
const FRAMES_PER_BURST = 8;

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

  async start(file: File, input: Omit<CreateAudioSessionInput, 'source'>): Promise<void> {
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

    const filePath = (window as any).electron?.webUtils?.getPathForFile?.(file)
      || (file as any).path
      || undefined;

    const isWhisperDirect = input.providerId === BUILT_IN_WHISPER_ID && Boolean(filePath);
    if (isWhisperDirect) {
      try {
        this.session = await audio.createSession({
          ...input,
          source: { kind: 'file', name: file.name, path: filePath },
        });
        this.callbacks.onProgress?.(0.5);
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
      }
      return;
    }

    const { buffer, context } = await decodeFile(file);
    try {
      this.session = await audio.createSession({
        ...input,
        source: { kind: 'file', name: file.name, path: filePath },
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
    let framesInBurst = 0;

    for (let offset = 0; offset < totalSamples && !this.cancelled && !this.finishRequested && !this.finishedByService; offset += chunkSamples) {
      const length = Math.min(chunkSamples, totalSamples - offset);
      const frames = framer.push(monoChunk(buffer, offset, length));
      for (const frame of frames) {
        if (this.cancelled || this.finishRequested || this.finishedByService) break;
        const sessionId = this.session?.id;
        if (!sessionId) break;
        audio.pushPcmFrame({
          sessionId,
          frame: frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength) as ArrayBuffer,
        });
        framesInBurst += 1;
        if (framesInBurst >= FRAMES_PER_BURST) {
          framesInBurst = 0;
          await audio.waitForAudioCapacity(sessionId);
        }
      }
      this.callbacks.onProgress?.(Math.min(1, (offset + length) / totalSamples));
    }

    if (!this.cancelled && !this.finishRequested && !this.finishedByService) {
      for (const frame of framer.flush()) {
        const sessionId = this.session?.id;
        if (!sessionId) break;
        audio.pushPcmFrame({
          sessionId,
          frame: frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength) as ArrayBuffer,
        });
      }
      this.callbacks.onProgress?.(1);
    }
  }
}
