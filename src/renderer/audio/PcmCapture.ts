import type {
  AudioSessionEvent,
  AudioSessionSnapshot,
  CreateAudioSessionInput,
} from '../../shared/audio/types';
import workletUrl from '../audio-worklet/pcm-capture.worklet.ts?worker&url';

const FLUSH_TIMEOUT_MS = 2_000;

export interface PcmCaptureCallbacks {
  onPeak?(peak: number): void;
  onPermissionGranted?(): void;
  onDevice?(label: string): void;
  onSessionEvent?(event: AudioSessionEvent): void;
}

type WorkletMessage =
  | { kind: 'frame'; frame: ArrayBuffer }
  | { kind: 'peak'; value: number }
  | { kind: 'flushed' };

function parseWorkletMessage(value: unknown): WorkletMessage | null {
  if (typeof value !== 'object' || value === null) return null;
  const kind = Reflect.get(value, 'kind');
  if (kind === 'frame') {
    const frame = Reflect.get(value, 'frame');
    return frame instanceof ArrayBuffer ? { kind, frame } : null;
  }
  if (kind === 'peak') {
    const peak = Reflect.get(value, 'value');
    return typeof peak === 'number' && Number.isFinite(peak) ? { kind, value: peak } : null;
  }
  return kind === 'flushed' ? { kind } : null;
}

export class PcmCapture {
  private readonly removeSessionListener: () => void;
  private session: AudioSessionSnapshot | null = null;
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private worklet: AudioWorkletNode | null = null;
  private mutedOutput: GainNode | null = null;
  private flushResolver: (() => void) | null = null;
  private stopPromise: Promise<void> | null = null;

  constructor(private readonly callbacks: PcmCaptureCallbacks = {}) {
    const audio = window.electron?.audio;
    if (!audio) throw new Error('Audio API is unavailable');
    this.removeSessionListener = audio.onSessionEvent(event => {
      const belongsToCapture = event.kind === 'session-created' || event.sessionId === this.session?.id;
      if (!belongsToCapture) return;
      this.callbacks.onSessionEvent?.(event);
      if (event.kind === 'completed' || event.kind === 'failed') {
        this.session = null;
        void this.cleanupCaptureGraph().catch(() => undefined);
        this.removeSessionListener();
      }
    });
  }

  async start(input: CreateAudioSessionInput): Promise<AudioSessionSnapshot> {
    if (this.session || this.stopPromise) throw new Error('Microphone capture is already active');
    const audio = window.electron?.audio;
    if (!audio) throw new Error('Audio API is unavailable');

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      this.callbacks.onPermissionGranted?.();
      const deviceLabel = this.stream.getAudioTracks()[0]?.label;
      if (deviceLabel) this.callbacks.onDevice?.(deviceLabel);
      this.context = new AudioContext();
      await this.context.audioWorklet.addModule(workletUrl);
      this.worklet = new AudioWorkletNode(this.context, 'tiginal-pcm-capture', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      this.source = this.context.createMediaStreamSource(this.stream);
      this.mutedOutput = this.context.createGain();
      this.mutedOutput.gain.value = 0;
      this.worklet.port.onmessage = event => this.handleWorkletMessage(event.data);
      this.session = await audio.createSession({ ...input, source: { kind: 'microphone' } });
      this.source.connect(this.worklet);
      this.worklet.connect(this.mutedOutput);
      this.mutedOutput.connect(this.context.destination);
      await this.context.resume();
      return this.session;
    } catch (error) {
      const sessionId = this.session?.id;
      this.session = null;
      if (sessionId) await audio.abortSession(sessionId);
      await this.cleanupCaptureGraph();
      this.removeSessionListener();
      throw error;
    }
  }

  stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    this.stopPromise = this.stopCapture();
    return this.stopPromise;
  }

  async abort(): Promise<void> {
    const audio = window.electron?.audio;
    const sessionId = this.session?.id;
    this.session = null;
    try {
      if (sessionId && audio) await audio.abortSession(sessionId);
    } finally {
      await this.cleanupCaptureGraph();
      this.removeSessionListener();
    }
  }

  private async stopCapture(): Promise<void> {
    const audio = window.electron?.audio;
    const sessionId = this.session?.id;
    if (!audio || !sessionId) {
      await this.cleanupCaptureGraph();
      return;
    }

    this.source?.disconnect();
    this.stopTracks();
    try {
      await this.flushWorklet();
      await audio.finishSession(sessionId);
      this.session = null;
    } catch (error) {
      await audio.abortSession(sessionId);
      this.session = null;
      throw error;
    } finally {
      await this.cleanupCaptureGraph();
      this.removeSessionListener();
    }
  }

  private handleWorkletMessage(value: unknown): void {
    const message = parseWorkletMessage(value);
    if (!message) return;
    if (message.kind === 'frame') {
      const sessionId = this.session?.id;
      if (sessionId) window.electron?.audio.pushPcmFrame({ sessionId, frame: message.frame });
    } else if (message.kind === 'peak') {
      this.callbacks.onPeak?.(message.value);
    } else {
      this.flushResolver?.();
      this.flushResolver = null;
    }
  }

  private flushWorklet(): Promise<void> {
    if (!this.worklet) return Promise.resolve();
    return new Promise(resolve => {
      let settled = false;
      let timeoutId = 0;
      const finish = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        this.flushResolver = null;
        resolve();
      };
      this.flushResolver = finish;
      this.worklet?.port.postMessage({ kind: 'flush' });
      timeoutId = window.setTimeout(finish, FLUSH_TIMEOUT_MS);
    });
  }

  private stopTracks(): void {
    for (const track of this.stream?.getTracks() ?? []) track.stop();
  }

  private async cleanupCaptureGraph(): Promise<void> {
    this.stopTracks();
    this.source?.disconnect();
    this.worklet?.disconnect();
    this.mutedOutput?.disconnect();
    this.worklet = null;
    this.source = null;
    this.mutedOutput = null;
    this.stream = null;
    const context = this.context;
    this.context = null;
    if (context && context.state !== 'closed') await context.close();
  }
}
