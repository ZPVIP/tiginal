import type {
  AudioCaptureDiagnostic,
  AudioCaptureTrackDiagnostic,
  AudioSessionEvent,
  AudioSessionSnapshot,
  CreateAudioSessionInput,
} from '../../shared/audio/types';
import { SYSTEM_AUDIO_DISPLAY_MEDIA_OPTIONS } from '../../shared/audio/types';
import {
  DEFAULT_MICROPHONE_SELECTION,
  type MicrophoneSelection,
} from './MicrophoneDevices';
import workletUrl from '../audio-worklet/pcm-capture.worklet.ts?worker&url';

const FLUSH_TIMEOUT_MS = 2_000;

export class SystemAudioTrackUnavailableError extends Error {
  constructor() {
    super('No system audio track was returned. In System Settings > Privacy & Security > Screen & System Audio Recording, add and enable Tiginal under System Audio Recording Only, then restart Tiginal.');
    this.name = 'SystemAudioTrackUnavailableError';
  }
}

export interface PcmCaptureCallbacks {
  onPeak?(peak: number): void;
  onPermissionGranted?(): void;
  onDevice?(label: string): void;
  onSessionEvent?(event: AudioSessionEvent): void;
}

export type LiveAudioSource =
  | { kind: 'microphone'; microphone: MicrophoneSelection }
  | { kind: 'system' }
  | { kind: 'mixed'; microphone: MicrophoneSelection };

const DEFAULT_LIVE_AUDIO_SOURCE: LiveAudioSource = {
  kind: 'microphone',
  microphone: DEFAULT_MICROPHONE_SELECTION,
};

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

function trackDiagnostic(track: MediaStreamTrack): AudioCaptureTrackDiagnostic {
  const settings = track.getSettings();
  return {
    kind: track.kind === 'audio' ? 'audio' : 'video',
    readyState: track.readyState,
    enabled: track.enabled,
    muted: track.muted,
    ...(typeof settings.sampleRate === 'number' ? { sampleRate: settings.sampleRate } : {}),
    ...(typeof settings.channelCount === 'number' ? { channelCount: settings.channelCount } : {}),
    ...(typeof settings.displaySurface === 'string' ? { displaySurface: settings.displaySurface } : {}),
  };
}

function reportCaptureDiagnostic(diagnostic: AudioCaptureDiagnostic): void {
  window.electron?.audio.reportCaptureDiagnostic(diagnostic);
}

export class PcmCapture {
  private readonly removeSessionListener: () => void;
  private session: AudioSessionSnapshot | null = null;
  private streams: MediaStream[] = [];
  private context: AudioContext | null = null;
  private sources: MediaStreamAudioSourceNode[] = [];
  private inputGains: GainNode[] = [];
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

  async start(
    input: Omit<CreateAudioSessionInput, 'source'>,
    liveSource: LiveAudioSource = DEFAULT_LIVE_AUDIO_SOURCE,
  ): Promise<AudioSessionSnapshot> {
    if (this.session || this.stopPromise) throw new Error('Live audio capture is already active');
    const audio = window.electron?.audio;
    if (!audio) throw new Error('Audio API is unavailable');

    try {
      this.streams = await this.acquireStreams(liveSource);
      this.callbacks.onPermissionGranted?.();
      this.context = new AudioContext();
      await this.context.audioWorklet.addModule(workletUrl);
      this.worklet = new AudioWorkletNode(this.context, 'tiginal-pcm-capture', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      this.mutedOutput = this.context.createGain();
      this.mutedOutput.gain.value = 0;
      this.worklet.port.onmessage = event => this.handleWorkletMessage(event.data);
      this.session = await audio.createSession({ ...input, source: { kind: liveSource.kind } });
      const inputGain = liveSource.kind === 'mixed' ? 0.5 : 1;
      for (const stream of this.streams) {
        const source = this.context.createMediaStreamSource(stream);
        const gain = this.context.createGain();
        gain.gain.value = inputGain;
        source.connect(gain);
        gain.connect(this.worklet);
        this.sources.push(source);
        this.inputGains.push(gain);
      }
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

    for (const source of this.sources) source.disconnect();
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
    for (const stream of this.streams) {
      for (const track of stream.getTracks()) track.stop();
    }
  }

  private async cleanupCaptureGraph(): Promise<void> {
    this.stopTracks();
    for (const source of this.sources) source.disconnect();
    for (const gain of this.inputGains) gain.disconnect();
    this.worklet?.disconnect();
    this.mutedOutput?.disconnect();
    this.worklet = null;
    this.sources = [];
    this.inputGains = [];
    this.mutedOutput = null;
    this.streams = [];
    const context = this.context;
    this.context = null;
    if (context && context.state !== 'closed') await context.close();
  }

  private async acquireStreams(source: LiveAudioSource): Promise<MediaStream[]> {
    const streams: MediaStream[] = [];
    try {
      if (source.kind === 'system' || source.kind === 'mixed') {
        streams.push(await this.acquireSystemAudio(source.kind));
      }
      if (source.kind === 'microphone' || source.kind === 'mixed') {
        const microphone = await this.acquireMicrophone(source.microphone);
        streams.push(microphone);
        const deviceLabel = microphone.getAudioTracks()[0]?.label;
        if (deviceLabel) this.callbacks.onDevice?.(deviceLabel);
      }
      return streams;
    } catch (error) {
      for (const stream of streams) {
        for (const track of stream.getTracks()) track.stop();
      }
      throw error;
    }
  }

  private async acquireMicrophone(selection: MicrophoneSelection): Promise<MediaStream> {
    const constraints: MediaTrackConstraints = {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      ...(selection.kind === 'device' ? { deviceId: { exact: selection.deviceId } } : {}),
    };
    return navigator.mediaDevices.getUserMedia({ audio: constraints });
  }

  private async acquireSystemAudio(source: 'system' | 'mixed'): Promise<MediaStream> {
    const captureId = globalThis.crypto.randomUUID();
    reportCaptureDiagnostic({ event: 'capture-requested', captureId, source });
    if (!navigator.mediaDevices?.getDisplayMedia) {
      const error = new Error('System audio capture is unavailable on this platform');
      reportCaptureDiagnostic({
        event: 'capture-failed',
        captureId,
        name: error.name,
        message: error.message,
      });
      throw error;
    }
    let displayStream: MediaStream;
    try {
      displayStream = await navigator.mediaDevices.getDisplayMedia(SYSTEM_AUDIO_DISPLAY_MEDIA_OPTIONS);
    } catch (error) {
      reportCaptureDiagnostic({
        event: 'capture-failed',
        captureId,
        name: error instanceof Error ? error.name : 'UnknownError',
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    const reportStreamState = (phase: Extract<AudioCaptureDiagnostic, { event: 'stream-state' }>['phase']) => {
      reportCaptureDiagnostic({
        event: 'stream-state',
        captureId,
        phase,
        tracks: displayStream.getTracks().map(trackDiagnostic),
      });
    };
    reportStreamState('returned');
    for (const track of displayStream.getTracks()) {
      track.addEventListener('mute', () => reportStreamState('track-muted'));
      track.addEventListener('unmute', () => reportStreamState('track-unmuted'));
      track.addEventListener('ended', () => reportStreamState('track-ended'));
    }

    const audioTracks = displayStream.getAudioTracks();
    // ScreenCaptureKit couples the audio and video tracks to one capture session on macOS.
    // Keep the video track alive until cleanup, or stopping it also ends system audio.
    await new Promise(resolve => window.setTimeout(resolve, 100));
    reportStreamState('settled');
    const liveAudioTracks = audioTracks.filter(track => track.readyState === 'live');
    if (liveAudioTracks.length === 0) {
      for (const track of displayStream.getTracks()) track.stop();
      const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform);
      const error = isMac
        ? new SystemAudioTrackUnavailableError()
        : new Error('The selected source did not provide a live system audio track');
      reportCaptureDiagnostic({
        event: 'capture-failed',
        captureId,
        name: error.name,
        message: error.message,
      });
      throw error;
    }
    return displayStream;
  }
}
