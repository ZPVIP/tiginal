export const SPEECH_PROVIDER_PROTOCOLS = [
  'r2t2-rstream',
  'r2t2-native',
  't3po-rstream',
  't3po-native',
] as const;
export type SpeechProviderProtocol = typeof SPEECH_PROVIDER_PROTOCOLS[number];

export const SPEECH_AUTH_MODES = ['none', 'query-token', 'handshake-secret'] as const;
export type SpeechAuthMode = typeof SPEECH_AUTH_MODES[number];

export const BUILT_IN_R2T2_TRIAL_ID = 'builtin-r2t2-online-demo';
export const BUILT_IN_R2T2_TRIAL_TOKEN = 'pwacGhcJQbZg0rzlOM0nrCVmmuU5S29iDIH1V2r2j6w';
export const BUILT_IN_R2T2_TRIAL_ENDPOINT = 'wss://r2t2.youdao.com/asr';
export const BUILT_IN_R2T2_TRIAL_MAX_SECONDS = 30;

export const BUILT_IN_T3PO_TRIAL_ID = 'builtin-t3po-online-demo';
export const BUILT_IN_T3PO_TRIAL_TOKEN = 'pwacGhcJQbZg0rzlOM0nrCVmmuU5S29iDIH1V2r2j6w';
export const BUILT_IN_T3PO_TRIAL_ENDPOINT = 'wss://t3po.youdao.com/stream';
export const BUILT_IN_T3PO_TRIAL_MAX_SECONDS = 30;

export interface R2T2ProviderOptions {
  bookedWords: string[];
  useVad: boolean;
  smooth: boolean;
  mode: string;
  systemPrompt: string;
}

export interface SpeechProvider {
  id: string;
  name: string;
  protocol: SpeechProviderProtocol;
  endpoint: string;
  authMode: SpeechAuthMode;
  hasCredential: boolean;
  builtInKind: 'r2t2-online-trial' | 't3po-online-trial' | null;
  userModified: boolean;
  maxSessionSeconds: number | null;
  defaultLanguage: string;
  options: R2T2ProviderOptions;
  enabled: boolean;
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
  options?: Partial<R2T2ProviderOptions>;
  enabled?: boolean;
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

export type TranslationLatencyMode = 'low' | 'native' | 'high';

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

export interface CreateAudioSessionInput {
  providerId: string;
  language?: string;
  bookedWords?: string[];
  source?:
    | { kind: 'microphone' }
    | { kind: 'file'; name: string };
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

export type AudioSessionEvent =
  | { kind: 'session-created'; session: AudioSessionSnapshot }
  | { kind: 'provider-event'; sessionId: string; event: TranscriptEvent }
  | { kind: 'translation-event'; sessionId: string; event: TranslationSessionEvent }
  | { kind: 'completed'; sessionId: string; recordingPath: string | null; durationMs: number; translation?: string }
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
  finishSession(sessionId: string): Promise<void>;
  abortSession(sessionId: string): Promise<void>;
  deleteRecording(recordingPath: string): Promise<void>;
  getRecordingUrl(recordingPath: string): Promise<string>;
  onSessionEvent(listener: (event: AudioSessionEvent) => void): () => void;
}
