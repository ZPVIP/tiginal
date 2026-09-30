export const SPEECH_PROVIDER_PROTOCOLS = [
  'r2t2-rstream',
  'r2t2-native',
  'whisper-local',
  't3po',
] as const;
export type SpeechProviderProtocol = typeof SPEECH_PROVIDER_PROTOCOLS[number];

export const SPEECH_PROVIDER_PROTOCOL_OPTIONS = [
  { protocol: 'r2t2-rstream', label: 'R2T2 rstream', defaultPath: '/asr' },
  { protocol: 'r2t2-native', label: 'R2T2 native', defaultPath: '/asr_stream_api_v1' },
  { protocol: 'whisper-local', label: 'Local Whisper (tiginal-diarize)', defaultPath: 'local://whisper' },
  { protocol: 't3po', label: 'T3PO', defaultPath: '/ws/translate' },
] as const satisfies readonly { protocol: SpeechProviderProtocol; label: string; defaultPath: string }[];

export type R2T2Protocol = Exclude<SpeechProviderProtocol, 't3po'>;

export function isR2T2Protocol(protocol: SpeechProviderProtocol): protocol is R2T2Protocol {
  return protocol !== 't3po';
}

export function isWhisperProtocol(protocol: SpeechProviderProtocol): boolean {
  return protocol === 'whisper-local';
}

export const R2T2_RECOGNITION_MODES = ['slow', 'fast'] as const;
export type R2T2RecognitionMode = typeof R2T2_RECOGNITION_MODES[number];

export const SPEECH_AUTH_MODES = ['none', 'query-token', 'handshake-secret'] as const;
export type SpeechAuthMode = typeof SPEECH_AUTH_MODES[number];

export const BUILT_IN_R2T2_TRIAL_ID = 'builtin-r2t2-online-demo';
export const BUILT_IN_R2T2_TRIAL_TOKEN = 'pwacGhcJQbZg0rzlOM0nrCVmmuU5S29iDIH1V2r2j6w';
export const BUILT_IN_R2T2_TRIAL_ENDPOINT = 'wss://r2t2.youdao.com/asr';
export const BUILT_IN_R2T2_TRIAL_MAX_SECONDS = 30;

export const BUILT_IN_WHISPER_ID = 'builtin-whisper-local';

export const TRANSLATION_LATENCY_MODES = ['low', 'native', 'high'] as const;
export type TranslationLatencyMode = typeof TRANSLATION_LATENCY_MODES[number];

export interface SpeechProviderOptions {
  /** R2T2: words the recognizer should favor. */
  bookedWords: string[];
  /** R2T2: adds the model's smooth-text instruction. */
  smooth: boolean;
  /** R2T2: stable-text commit policy. */
  mode: R2T2RecognitionMode;
  /** R2T2 native: recognition context. */
  systemPrompt: string;
  /** T3PO: default commit timing for simultaneous translation. */
  latencyMode: TranslationLatencyMode;
  /** T3PO: terminology entries written as `source=target`, or a single term kept unchanged. */
  terminology: string[];
}

export interface AudioSessionArtifacts {
  transcript?: string;
  speakers?: string;
  srt?: string;
}

export interface SpeechProvider {
  id: string;
  name: string;
  protocol: SpeechProviderProtocol;
  endpoint: string;
  authMode: SpeechAuthMode;
  hasCredential: boolean;
  builtInKind: 'r2t2-online-trial' | 'whisper-local' | null;
  userModified: boolean;
  maxSessionSeconds: number | null;
  defaultLanguage: string;
  options: SpeechProviderOptions;
  createdAt: number;
  updatedAt: number;
}

export interface SpeechProviderInput {
  id?: string;
  name: string;
  protocol: SpeechProviderProtocol;
  endpoint: string;
  authMode: SpeechAuthMode;
  credential?: string;
  maxSessionSeconds: number | null;
  defaultLanguage: string;
  options?: Partial<SpeechProviderOptions>;
}

export interface SpeechProviderTestInput extends SpeechProviderInput {
  id?: string;
}

export type TranscriptEvent =
  | { kind: 'connected' }
  | { kind: 'committed'; text: string; fullText: string }
  | { kind: 'partial'; text: string }
  | { kind: 'segment-reset' }
  | { kind: 'final'; text: string }
  | { kind: 'metrics'; ackedSamples?: number; serverBufferedMs?: number }
  | { kind: 'error'; code: string; message: string };

export interface TranslationEngineCandidate {
  id: string;
  label: string;
  description: string;
  source: 'speech-provider' | 'remote' | 'local';
  capabilities: readonly string[];
  isSimultaneous: boolean;
  endpoint?: string;
  protocol?: string;
  defaultLanguage?: string;
}

export interface T3POHistoryPair {
  source: string;
  target: string;
}

export interface TranslationRequest {
  engineId: string;
  text: string;
  sourceLanguage: string;
  targetLanguage: string;
  instructions?: string;
  latencyMode?: TranslationLatencyMode;
  terminology?: readonly { source: string; target: string }[] | string[];
}

export interface TranslationResult {
  translatedText: string;
  engineId: string;
  durationMs: number;
}

export type TranslationSessionEvent =
  | { kind: 'status-change'; status: 'idle' | 'deciding' | 'waiting' | 'flushing' | 'complete' | 'failed'; currentInput?: string }
  | { kind: 'trans'; segment: string; fullTranslation: string; history: T3POHistoryPair[] }
  | { kind: 'wait'; currentInput: string }
  | { kind: 'complete'; fullTranslation: string; durationMs: number }
  | { kind: 'error'; message: string };

export interface AudioSessionTranslationConfig {
  engineId: string;
  targetLanguage: string;
  latencyMode: TranslationLatencyMode;
  instructions?: string;
  terminology?: string[];
}

export const AUDIO_INPUT_SOURCE_KINDS = ['microphone', 'system', 'mixed', 'file'] as const;
export type AudioInputSourceKind = typeof AUDIO_INPUT_SOURCE_KINDS[number];

export type AudioSessionSource =
  | { kind: 'microphone' }
  | { kind: 'system' }
  | { kind: 'mixed' }
  | { kind: 'file'; name: string; path?: string };

export interface AudioInputCapabilities {
  sources: readonly AudioInputSourceKind[];
}

export const SYSTEM_AUDIO_DISPLAY_MEDIA_OPTIONS = {
  audio: true,
  video: true,
  systemAudio: 'include',
  windowAudio: 'system',
  audioSelection: 'preferred',
} as const;

export interface AudioCaptureTrackDiagnostic {
  kind: 'audio' | 'video';
  readyState: 'live' | 'ended';
  enabled: boolean;
  muted: boolean;
  sampleRate?: number;
  channelCount?: number;
  displaySurface?: string;
}

export type AudioCaptureDiagnostic =
  | {
    event: 'capture-requested';
    captureId: string;
    source: 'system' | 'mixed';
  }
  | {
    event: 'stream-state';
    captureId: string;
    phase: 'returned' | 'settled' | 'track-muted' | 'track-unmuted' | 'track-ended';
    tracks: AudioCaptureTrackDiagnostic[];
  }
  | {
    event: 'capture-failed';
    captureId: string;
    name: string;
    message: string;
  };

export const MAC_MEDIA_ACCESS_STATUSES = [
  'not-determined',
  'granted',
  'denied',
  'restricted',
  'unknown',
] as const;
export type MacMediaAccessStatus = typeof MAC_MEDIA_ACCESS_STATUSES[number];

export type SystemAudioPermissionInfo =
  | { kind: 'unsupported' }
  | {
    kind: 'macos';
    screenStatus: MacMediaAccessStatus;
    permissionOwner: 'application' | 'launcher';
  };

export function shouldShowSystemAudioPermissionGuide(
  permissionInfo: SystemAudioPermissionInfo,
  dismissedForSession: boolean,
): boolean {
  if (permissionInfo.kind !== 'macos' || dismissedForSession) return false;

  switch (permissionInfo.screenStatus) {
    case 'not-determined':
    case 'denied':
    case 'restricted':
      return true;
    case 'granted':
    case 'unknown':
      return false;
    default: {
      const _exhaustive: never = permissionInfo.screenStatus;
      return _exhaustive;
    }
  }
}

export interface CreateAudioSessionInput {
  providerId: string;
  language?: string;
  bookedWords?: string[];
  source: AudioSessionSource;
  translation?: AudioSessionTranslationConfig;
}

export interface AudioSessionSnapshot {
  id: string;
  providerId: string;
  recordingPath: string | null;
  startedAt: number;
  maxSessionSeconds: number | null;
  translation?: AudioSessionTranslationConfig;
}

export interface FinishSessionResult {
  sessionId: string;
  recordingPath: string | null;
  durationMs: number;
  translation?: string;
  artifacts?: AudioSessionArtifacts;
}

export type AudioSessionEvent =
  | { kind: 'session-created'; session: AudioSessionSnapshot }
  | { kind: 'provider-event'; sessionId: string; event: TranscriptEvent }
  | { kind: 'translation-event'; sessionId: string; event: TranslationSessionEvent }
  | { kind: 'progress'; sessionId: string; progress: number; phase?: string }
  | ({ kind: 'completed' } & FinishSessionResult)
  | { kind: 'failed'; sessionId: string; recordingPath: string | null; message: string };

export interface PushPcmFrameInput {
  sessionId: string;
  frame: ArrayBuffer;
}

export interface SpeechConnectionTestResult {
  success: boolean;
  error?: string;
}

export interface AudioRendererApi {
  getInputCapabilities(): Promise<AudioInputCapabilities>;
  getSystemAudioPermissionInfo(): Promise<SystemAudioPermissionInfo>;
  openSystemAudioSettings(): Promise<void>;
  reportCaptureDiagnostic(diagnostic: AudioCaptureDiagnostic): void;
  listSpeechProviders(): Promise<SpeechProvider[]>;
  getSpeechProviderCredential(id: string): Promise<string | null>;
  addSpeechProvider(input: SpeechProviderInput): Promise<SpeechProvider>;
  updateSpeechProvider(input: SpeechProviderInput & { id: string }): Promise<SpeechProvider>;
  deleteSpeechProvider(id: string): Promise<void>;
  testSpeechProvider(input: SpeechProviderTestInput): Promise<SpeechConnectionTestResult>;
  listTranslationCandidates(): Promise<TranslationEngineCandidate[]>;
  translateStatic(request: TranslationRequest): Promise<TranslationResult>;
  createSession(input: CreateAudioSessionInput): Promise<AudioSessionSnapshot>;
  pushPcmFrame(input: PushPcmFrameInput): void;
  /** Resolves once the speech server has taken most of the queued audio; IPC keeps it ordered after earlier frames. */
  waitForAudioCapacity(sessionId: string): Promise<void>;
  finishSession(sessionId: string): Promise<FinishSessionResult | null>;
  abortSession(sessionId: string): Promise<void>;
  deleteRecording(recordingPath: string): Promise<void>;
  deleteRecordingArtifact(recordingPath: string, artifactType: 'transcript' | 'speakers' | 'srt'): Promise<AudioSessionArtifacts>;
  getRecordingUrl(recordingPath: string): Promise<string>;
  getRecordingArtifacts(recordingPath: string): Promise<AudioSessionArtifacts>;
  rediarizeRecording(recordingPath: string): Promise<AudioSessionArtifacts>;
  cancelRediarize(): Promise<void>;
  onSessionEvent(listener: (event: AudioSessionEvent) => void): () => void;
}
