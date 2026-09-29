import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AudioLines, FileAudio, FolderOpen, Mic, Radio, Sparkles, Trash2, Volume2, Waves } from 'lucide-react';
import {
  isR2T2Protocol,
  shouldShowSystemAudioPermissionGuide,
  type AudioInputSourceKind,
  type AudioSessionEvent,
  type SpeechProvider,
  type SystemAudioPermissionInfo,
  type TranslationEngineCandidate,
  type TranslationLatencyMode,
} from '../../../shared/audio/types';
import { defaultT3POInstructions } from '../../../shared/audio/t3po-prompt';
import { PcmCapture } from '../../audio/PcmCapture';
import {
  DEFAULT_MICROPHONE_SELECTION,
  listMicrophoneDevices,
  microphoneSelectionValue,
  type MicrophoneDeviceOption,
  type MicrophoneSelection,
} from '../../audio/MicrophoneDevices';
import {
  AudioFileTranscriber,
  inspectAudioFile,
  type AudioFileMetadata,
} from '../../audio/AudioFileTranscriber';
import { AudioControlsPanel } from './AudioControlsPanel';
import { AudioWaveformPlayer } from './AudioWaveformPlayer';
import { LiveWaveformCanvas } from './LiveWaveformCanvas';
import { SystemAudioPermissionDialog } from './SystemAudioPermissionDialog';
import { TranscriptEditor, type TranscriptTab } from './TranscriptEditor';
import { TranslationEditor } from './TranslationEditor';
import type { AudioSessionArtifacts } from '../../../shared/audio/types';

const SYSTEM_AUDIO_PERMISSION_GUIDE_DISMISSED_KEY = 'tiginal:system-audio-permission-guide-dismissed';

type WorkbenchState =
  | { kind: 'idle' }
  | { kind: 'requesting-permission' }
  | { kind: 'connecting' }
  | { kind: 'recording' }
  | { kind: 'transcribing-file'; progress: number }
  | { kind: 'finalizing' }
  | { kind: 'ready' }
  | { kind: 'failed'; message: string };

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function storageHasFlag(storage: Storage, key: string): boolean {
  try {
    return storage.getItem(key) === 'true';
  } catch {
    return false;
  }
}

function setStorageFlag(storage: Storage, key: string, enabled: boolean): void {
  try {
    if (enabled) storage.setItem(key, 'true');
    else storage.removeItem(key);
  } catch {
    // Storage can be unavailable in restricted renderer contexts.
  }
}

function technicalTerms(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map(term => term.trim())
    .filter(Boolean);
}

function isBusy(state: WorkbenchState): boolean {
  return state.kind === 'requesting-permission'
    || state.kind === 'connecting'
    || state.kind === 'recording'
    || state.kind === 'transcribing-file'
    || state.kind === 'finalizing';
}

function statusLabel(state: WorkbenchState): string {
  switch (state.kind) {
    case 'idle': return 'Ready';
    case 'requesting-permission': return 'Requesting audio permission';
    case 'connecting': return 'Connecting to speech provider';
    case 'recording': return 'Listening';
    case 'transcribing-file': return `Transcribing ${Math.round(state.progress * 100)}%`;
    case 'finalizing': return 'Finalizing transcript and recording';
    case 'ready': return 'Complete';
    case 'failed': return 'Session failed';
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

function formatTildePath(fullPath: string): string {
  if (!fullPath) return '';
  return fullPath.replace(/^(\/Users\/[^/]+|\/home\/[^/]+|[a-zA-Z]:\\Users\\[^\\]+)/, '~');
}

function formatErrorMessage(err: unknown): string | null {
  if (!err) return null;
  if (typeof err !== 'string') {
    return JSON.stringify(err);
  }
  try {
    const parsed = JSON.parse(err);
    if (typeof parsed === 'string') return parsed;
    if (parsed && typeof parsed === 'object') {
      if (typeof parsed.detail === 'string') return parsed.detail;
      if (typeof parsed.message === 'string') return parsed.message;
      if (parsed.error) {
        if (typeof parsed.error === 'string') return parsed.error;
        if (typeof parsed.error.message === 'string') return parsed.error.message;
      }
      return JSON.stringify(parsed);
    }
  } catch {
    // not JSON
  }
  return err;
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
const isWin = typeof navigator !== 'undefined' && /Win/.test(navigator.platform);
const revealTitle = isMac ? 'Reveal in Finder' : isWin ? 'Reveal in File Explorer' : 'Open containing folder';

export function AudioWorkspace() {
  const [providers, setProviders] = useState<SpeechProvider[]>([]);
  const [providerId, setProviderId] = useState('');
  const [source, setSource] = useState<AudioInputSourceKind>('microphone');
  const [availableSources, setAvailableSources] = useState<readonly AudioInputSourceKind[]>(['microphone', 'file']);
  const [language, setLanguage] = useState('en');
  const [terms, setTerms] = useState('');
  const [microphoneSelection, setMicrophoneSelection] = useState<MicrophoneSelection>(DEFAULT_MICROPHONE_SELECTION);
  const [microphoneOptions, setMicrophoneOptions] = useState<MicrophoneDeviceOption[]>([
    { selection: DEFAULT_MICROPHONE_SELECTION, label: 'System Default' },
  ]);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [fileMetadata, setFileMetadata] = useState<AudioFileMetadata | null>(null);
  const [fileUrl, setFileUrl] = useState('');
  const [recordingUrl, setRecordingUrl] = useState('');
  const [recordingPath, setRecordingPath] = useState('');
  const [livePeaks, setLivePeaks] = useState<number[]>([]);
  const [committedText, setCommittedText] = useState('');
  const [partialText, setPartialText] = useState('');
  const [editableText, setEditableText] = useState('');
  const [transcriptDirty, setTranscriptDirty] = useState(false);
  const [artifacts, setArtifacts] = useState<AudioSessionArtifacts>({});
  const [transcriptTab, setTranscriptTab] = useState<TranscriptTab>('transcript');
  const [isDiarizing, setIsDiarizing] = useState(false);
  const [state, setState] = useState<WorkbenchState>({ kind: 'idle' });

  // Translation states
  const [translationCandidates, setTranslationCandidates] = useState<TranslationEngineCandidate[]>([]);
  const [translationEngineId, setTranslationEngineId] = useState('');
  const [targetLanguage, setTargetLanguage] = useState('zh');
  const [realtimeTranslation, setRealtimeTranslation] = useState(false);
  const [translationLatency, setTranslationLatency] = useState<TranslationLatencyMode>('native');
  const [instructionsCustomized, setInstructionsCustomized] = useState(false);
  const [translationInstructions, setTranslationInstructions] = useState(() => defaultT3POInstructions('zh', 'en'));
  const [committedTranslation, setCommittedTranslation] = useState('');
  const [editableTranslation, setEditableTranslation] = useState('');
  const [translationDirty, setTranslationDirty] = useState(false);
  const [translationStatus, setTranslationStatus] = useState<'idle' | 'deciding' | 'waiting' | 'translating' | 'completed' | 'failed'>('idle');
  const [translationError, setTranslationError] = useState<string | null>(null);
  const [isStaticTranslating, setIsStaticTranslating] = useState(false);
  const [systemAudioPermissionInfo, setSystemAudioPermissionInfo] = useState<
    Extract<SystemAudioPermissionInfo, { kind: 'macos' }> | null
  >(null);
  const [systemAudioPermissionDialogOpen, setSystemAudioPermissionDialogOpen] = useState(false);

  const captureRef = useRef<PcmCapture | null>(null);
  const fileTranscriberRef = useRef<AudioFileTranscriber | null>(null);
  const committedTextRef = useRef('');
  const activeSourceRef = useRef<AudioInputSourceKind>('microphone');
  const microphonePermissionGrantedRef = useRef(false);
  const activeRecordingPathRef = useRef('');
  const busy = isBusy(state);
  const editable = !busy;

  // T3PO providers translate text, so only R2T2 providers can transcribe audio.
  const recognitionProviders = useMemo(
    () => providers.filter(provider => isR2T2Protocol(provider.protocol)),
    [providers],
  );

  const selectedProvider = useMemo(
    () => recognitionProviders.find(provider => provider.id === providerId),
    [providerId, recognitionProviders],
  );

  // A T3PO provider's latency mode is the default; the workspace selector overrides it per session.
  useEffect(() => {
    const t3po = providers.find(provider => `speech-provider:${provider.id}` === translationEngineId);
    if (t3po) setTranslationLatency(t3po.options.latencyMode);
  }, [providers, translationEngineId]);

  // Update default instructions when languages change, unless user customized them
  useEffect(() => {
    if (!instructionsCustomized) {
      const src = language === 'auto' ? 'zh' : language;
      setTranslationInstructions(defaultT3POInstructions(src, targetLanguage));
    }
  }, [instructionsCustomized, language, targetLanguage]);

  const reloadProviders = useCallback(async () => {
    const audio = window.electron?.audio;
    if (!audio) return;
    try {
      const items = await audio.listSpeechProviders();
      setProviders(items);
      const recognizers = items.filter(item => isR2T2Protocol(item.protocol));
      const preferred = recognizers[0];
      if (preferred) {
        setProviderId(previous => {
          if (previous && recognizers.some(item => item.id === previous)) {
            return previous;
          }
          return preferred.id;
        });
        setLanguage(previous => (previous === 'auto' ? preferred.defaultLanguage : previous));
      } else {
        setProviderId('');
      }
    } catch (error) {
      setState({ kind: 'failed', message: messageFromError(error) });
    }
  }, []);

  const reloadTranslationCandidates = useCallback(async () => {
    const audio = window.electron?.audio;
    if (!audio) return;
    try {
      const items = await audio.listTranslationCandidates();
      setTranslationCandidates(items);
      if (items.length > 0) {
        setTranslationEngineId(previous => {
          if (previous && items.some(item => item.id === previous)) {
            return previous;
          }
          return items[0].id;
        });
      } else {
        setTranslationEngineId('');
      }
    } catch {
      // ignore
    }
  }, []);

  const reloadMicrophoneDevices = useCallback(async (requestPermission = false) => {
    const options = await listMicrophoneDevices(requestPermission);
    if (requestPermission) microphonePermissionGrantedRef.current = true;
    setMicrophoneOptions(options);
    setMicrophoneSelection(current => (
      options.some(option => microphoneSelectionValue(option.selection) === microphoneSelectionValue(current))
        ? current
        : DEFAULT_MICROPHONE_SELECTION
    ));
  }, []);

  const requestMicrophoneDevices = useCallback(() => {
    if (busy) return;
    void reloadMicrophoneDevices(!microphonePermissionGrantedRef.current).catch(error => {
      setState({ kind: 'failed', message: messageFromError(error) });
    });
  }, [busy, reloadMicrophoneDevices]);

  useEffect(() => {
    const audio = window.electron?.audio;
    if (!audio) {
      setState({ kind: 'failed', message: 'Audio API is unavailable.' });
      return;
    }

    void reloadProviders();
    void reloadTranslationCandidates();
    void audio.getInputCapabilities()
      .then(capabilities => {
        setAvailableSources(capabilities.sources);
        setSource(current => capabilities.sources.includes(current) ? current : 'microphone');
      })
      .catch(() => setAvailableSources(['microphone', 'file']));
    void audio.getSystemAudioPermissionInfo()
      .then(info => {
        if (info.kind !== 'macos') return;
        setSystemAudioPermissionInfo(info);
        const dismissed = storageHasFlag(window.sessionStorage, SYSTEM_AUDIO_PERMISSION_GUIDE_DISMISSED_KEY);
        if (shouldShowSystemAudioPermissionGuide(info, dismissed)) {
          setSystemAudioPermissionDialogOpen(true);
        }
      })
      .catch(() => undefined);
    void reloadMicrophoneDevices().catch(() => undefined);

    const handleSpeechUpdate = () => {
      void reloadProviders();
    };

    const handleAiUpdate = () => {
      void reloadProviders();
      void reloadTranslationCandidates();
    };

    const handleSettingsClosed = () => {
      void reloadProviders();
      void reloadTranslationCandidates();
    };

    const handleFocus = () => {
      void reloadProviders();
      void reloadTranslationCandidates();
    };

    window.addEventListener('speech-providers-updated', handleSpeechUpdate);
    window.addEventListener('ai-providers-updated', handleAiUpdate);
    window.addEventListener('settings-closed', handleSettingsClosed);
    window.addEventListener('focus', handleFocus);

    return () => {
      window.removeEventListener('speech-providers-updated', handleSpeechUpdate);
      window.removeEventListener('ai-providers-updated', handleAiUpdate);
      window.removeEventListener('settings-closed', handleSettingsClosed);
      window.removeEventListener('focus', handleFocus);
    };
  }, [reloadMicrophoneDevices, reloadProviders, reloadTranslationCandidates]);

  useEffect(() => {
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.addEventListener) return;
    const handleDeviceChange = () => {
      void reloadMicrophoneDevices().catch(() => undefined);
    };
    mediaDevices.addEventListener('devicechange', handleDeviceChange);
    return () => mediaDevices.removeEventListener('devicechange', handleDeviceChange);
  }, [reloadMicrophoneDevices]);

  useEffect(() => () => {
    void captureRef.current?.abort();
    void fileTranscriberRef.current?.abort();
  }, []);

  useEffect(() => () => {
    if (fileUrl) URL.revokeObjectURL(fileUrl);
  }, [fileUrl]);

  const resetTranscript = useCallback(() => {
    committedTextRef.current = '';
    setCommittedText('');
    setPartialText('');
    setEditableText('');
    setTranscriptDirty(false);
    setArtifacts({});
    setTranscriptTab('transcript');
    setCommittedTranslation('');
    setEditableTranslation('');
    setTranslationDirty(false);
    setTranslationStatus('idle');
    setTranslationError(null);
  }, []);

  const loadRecordingUrl = useCallback(async (path: string) => {
    const audio = window.electron?.audio;
    if (!audio || !path) return;
    try {
      setRecordingUrl(await audio.getRecordingUrl(path));
    } catch {
      setRecordingUrl('');
    }
  }, []);

  const loadRecordingArtifacts = useCallback(async (path: string) => {
    const audio = window.electron?.audio;
    if (!audio || !path) return;
    try {
      const loaded = await audio.getRecordingArtifacts(path);
      setArtifacts(loaded || {});
    } catch {
      setArtifacts({});
    }
  }, []);

  const handleRevealInFolder = useCallback(async (filePath: string) => {
    if (!filePath) return;
    try {
      await window.electron?.invoke('shell:show-item-in-folder', filePath);
    } catch (err) {
      console.error('Failed to reveal file:', err);
    }
  }, []);

  const handleDeleteRecording = useCallback(async (filePath: string) => {
    if (!filePath) return;
    if (!window.confirm('Are you sure you want to delete this recording and all its text/subtitle files?')) {
      return;
    }
    try {
      await window.electron?.audio?.deleteRecording(filePath);
      if (recordingPath === filePath) {
        setRecordingPath('');
        setRecordingUrl('');
        setArtifacts({});
        setCommittedText('');
        setPartialText('');
        setEditableText('');
        setTranscriptDirty(false);
        setTranscriptTab('transcript');
      }
    } catch (err) {
      console.error('Failed to delete recording:', err);
    }
  }, [recordingPath]);

  const handleRediarize = useCallback(async (filePath: string) => {
    const audio = window.electron?.audio;
    if (!audio || !filePath) return;
    setIsDiarizing(true);
    try {
      const updated = await audio.rediarizeRecording(filePath);
      setArtifacts(updated);
      setTranscriptTab('speakers');
    } catch (err) {
      console.error('Failed to rediarize recording:', err);
      window.alert(`Diarization failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsDiarizing(false);
    }
  }, []);

  // A failed session keeps what was already transcribed, now in the editable transcript box.
  const failWithTranscript = useCallback((message: string) => {
    setEditableText(committedTextRef.current);
    setPartialText('');
    setState({ kind: 'failed', message });
  }, []);

  const handleSessionEvent = useCallback((event: AudioSessionEvent) => {
    if (event.kind === 'session-created') {
      const recPath = event.session.recordingPath ?? '';
      activeRecordingPathRef.current = recPath;
      setRecordingPath(recPath);
      return;
    }

    if (event.kind === 'translation-event') {
      const transEvt = event.event;
      switch (transEvt.kind) {
        case 'status-change':
          if (transEvt.status === 'flushing') {
            setTranslationStatus('translating');
          } else if (transEvt.status === 'failed') {
            setTranslationStatus('failed');
          } else if (transEvt.status === 'complete') {
            setTranslationStatus('completed');
          } else if (transEvt.status === 'deciding' || transEvt.status === 'waiting') {
            setTranslationStatus(transEvt.status);
          }
          return;
        case 'deciding':
          setTranslationStatus('deciding');
          return;
        case 'wait':
          setTranslationStatus('waiting');
          return;
        case 'trans':
          setTranslationStatus('translating');
          setCommittedTranslation(transEvt.fullTranslation);
          return;
        case 'complete':
          setTranslationStatus('completed');
          setCommittedTranslation(transEvt.fullTranslation);
          setEditableTranslation(transEvt.fullTranslation);
          setTranslationDirty(false);
          return;
        case 'error':
          setTranslationStatus('failed');
          setTranslationError(formatErrorMessage(transEvt.message));
          return;
        default:
          return;
      }
    }

    if (event.kind === 'provider-event') {
      switch (event.event.kind) {
        case 'connected':
          setState(activeSourceRef.current !== 'file'
            ? { kind: 'recording' }
            : { kind: 'transcribing-file', progress: 0 });
          return;
        case 'committed':
          committedTextRef.current = event.event.fullText;
          setCommittedText(event.event.fullText);
          setPartialText('');
          return;
        case 'partial':
          setPartialText(event.event.text);
          return;
        case 'segment-reset':
          setPartialText('');
          return;
        case 'final':
          committedTextRef.current = event.event.text;
          setCommittedText(event.event.text);
          setPartialText('');
          return;
        case 'metrics':
          return;
        case 'error':
          failWithTranscript(event.event.message);
          return;
        default: {
          const _exhaustive: never = event.event;
          return _exhaustive;
        }
      }
    }

    if (event.kind === 'completed') {
      const finalText = committedTextRef.current;
      captureRef.current = null;
      setEditableText(finalText);
      setPartialText('');
      const recPath = event.recordingPath ?? '';
      setRecordingPath(recPath);
      activeRecordingPathRef.current = recPath;
      if (activeSourceRef.current !== 'file' && recPath) void loadRecordingUrl(recPath);

      if (event.artifacts) {
        setArtifacts(event.artifacts);
      } else if (recPath) {
        void loadRecordingArtifacts(recPath);
      }

      if (event.translation) {
        setEditableTranslation(event.translation);
        setCommittedTranslation(event.translation);
        setTranslationDirty(false);
        setTranslationStatus('completed');
      }
      setState({ kind: 'ready' });
      return;
    }

    if (event.kind === 'failed') {
      captureRef.current = null;
      setRecordingPath(event.recordingPath || '');
      failWithTranscript(event.message);
      return;
    }
  }, [failWithTranscript, loadRecordingArtifacts, loadRecordingUrl]);

  const confirmDiscardEdits = useCallback((): boolean => {
    if (!transcriptDirty && !translationDirty) return true;
    return window.confirm('Discard your edits and start a new session?');
  }, [transcriptDirty, translationDirty]);

  const handleTranslationEngineChange = useCallback((id: string) => {
    setTranslationEngineId(id);
    setTranslationError(null);
    setTranslationStatus('idle');
  }, []);

  const startLiveCapture = useCallback(async () => {
    if (captureRef.current || fileTranscriberRef.current || !selectedProvider || !confirmDiscardEdits()) return;
    resetTranscript();
    setRecordingUrl('');
    setRecordingPath('');
    setLivePeaks([]);
    activeSourceRef.current = source;
    setState({ kind: 'requesting-permission' });

    const capture = new PcmCapture({
      onPermissionGranted: () => {
        if (source === 'system' || source === 'mixed') {
          setSystemAudioPermissionDialogOpen(false);
        }
        setState({ kind: 'connecting' });
      },
      onDevice: () => void reloadMicrophoneDevices().catch(() => undefined),
      onPeak: peak => setLivePeaks(previous => [...previous.slice(-1_599), peak]),
      onSessionEvent: handleSessionEvent,
    });
    captureRef.current = capture;

    const candidate = translationCandidates.find(c => c.id === translationEngineId);
    const isWs = Boolean(
      candidate?.endpoint?.startsWith('ws://') ||
      candidate?.endpoint?.startsWith('wss://') ||
      candidate?.protocol === 't3po'
    );
    const translationConfig = (realtimeTranslation && translationEngineId && isWs) ? {
      engineId: translationEngineId,
      targetLanguage,
      latencyMode: translationLatency,
      instructions: translationInstructions,
      terminology: technicalTerms(terms),
    } : undefined;

    try {
      const liveSource = source === 'mixed'
        ? { kind: 'mixed' as const, microphone: microphoneSelection }
        : source === 'system'
          ? { kind: 'system' as const }
          : { kind: 'microphone' as const, microphone: microphoneSelection };
      const snapshot = await capture.start(
        {
          providerId: selectedProvider.id,
          language,
          bookedWords: technicalTerms(terms),
          translation: translationConfig,
        },
        liveSource,
      );
      const recPath = snapshot.recordingPath ?? '';
      activeRecordingPathRef.current = recPath;
      setRecordingPath(recPath);
    } catch (error) {
      captureRef.current = null;
      failWithTranscript(messageFromError(error));
    }
  }, [
    confirmDiscardEdits,
    failWithTranscript,
    handleSessionEvent,
    language,
    microphoneSelection,
    realtimeTranslation,
    resetTranscript,
    reloadMicrophoneDevices,
    selectedProvider,
    source,
    targetLanguage,
    terms,
    translationCandidates,
    translationEngineId,
    translationInstructions,
    translationLatency,
  ]);

  const startFileTranscription = useCallback(async () => {
    if (captureRef.current || fileTranscriberRef.current || !audioFile || !selectedProvider || !confirmDiscardEdits()) return;
    resetTranscript();
    setRecordingUrl('');
    setRecordingPath('');
    activeSourceRef.current = 'file';
    setState({ kind: 'connecting' });
    const transcriber = new AudioFileTranscriber({
      onProgress: progress => setState(current => (
        current.kind === 'connecting' || current.kind === 'transcribing-file'
          ? { kind: 'transcribing-file', progress }
          : current
      )),
      onSessionEvent: handleSessionEvent,
    });
    fileTranscriberRef.current = transcriber;

    const candidate = translationCandidates.find(c => c.id === translationEngineId);
    const isWs = Boolean(
      candidate?.endpoint?.startsWith('ws://') ||
      candidate?.endpoint?.startsWith('wss://') ||
      candidate?.protocol === 't3po'
    );
    const translationConfig = (realtimeTranslation && translationEngineId && isWs) ? {
      engineId: translationEngineId,
      targetLanguage,
      latencyMode: translationLatency,
      instructions: translationInstructions,
      terminology: technicalTerms(terms),
    } : undefined;

    try {
      await transcriber.start(audioFile, {
        providerId: selectedProvider.id,
        language,
        bookedWords: technicalTerms(terms),
        translation: translationConfig,
      });
    } catch (error) {
      failWithTranscript(messageFromError(error));
    } finally {
      fileTranscriberRef.current = null;
    }
  }, [
    audioFile,
    confirmDiscardEdits,
    failWithTranscript,
    handleSessionEvent,
    language,
    realtimeTranslation,
    resetTranscript,
    selectedProvider,
    targetLanguage,
    terms,
    translationCandidates,
    translationEngineId,
    translationInstructions,
    translationLatency,
  ]);

  const start = useCallback(() => {
    if (source === 'file') void startFileTranscription();
    else void startLiveCapture();
  }, [source, startFileTranscription, startLiveCapture]);

  const stop = useCallback(async () => {
    setState({ kind: 'finalizing' });
    try {
      if (activeSourceRef.current !== 'file') await captureRef.current?.stop();
      else fileTranscriberRef.current?.requestFinish();
    } catch (error) {
      failWithTranscript(messageFromError(error));
    } finally {
      captureRef.current = null;
      if (activeSourceRef.current !== 'file') fileTranscriberRef.current = null;
    }
  }, [failWithTranscript]);

  const cancel = useCallback(async () => {
    try {
      await Promise.all([
        captureRef.current?.abort(),
        fileTranscriberRef.current?.abort(),
      ]);
      const path = activeRecordingPathRef.current;
      if (path && activeSourceRef.current !== 'file') await loadRecordingUrl(path);
      setEditableText(committedTextRef.current);
      setPartialText('');
      setState(committedTextRef.current ? { kind: 'ready' } : { kind: 'idle' });
      setTranslationStatus(committedTranslation ? 'completed' : 'idle');
    } catch (error) {
      failWithTranscript(messageFromError(error));
    } finally {
      captureRef.current = null;
      fileTranscriberRef.current = null;
    }
  }, [failWithTranscript, committedTranslation, loadRecordingUrl]);

  const selectFile = useCallback((file: File | null) => {
    if (busy) return;
    setAudioFile(file);
    setFileMetadata(null);
    setRecordingUrl('');
    if (!file) {
      setFileUrl('');
      return;
    }
    setFileUrl(URL.createObjectURL(file));
    void inspectAudioFile(file)
      .then(setFileMetadata)
      .catch(error => setState({ kind: 'failed', message: `This audio file could not be decoded. ${messageFromError(error)}` }));
  }, [busy]);

  const clearTranscript = useCallback(() => {
    if (transcriptDirty && !window.confirm('Discard your transcript edits?')) return;
    resetTranscript();
    if (!busy) setState({ kind: 'idle' });
  }, [busy, resetTranscript, transcriptDirty]);

  const copyTranscript = useCallback(() => {
    const text = editable ? editableText : `${committedText}${partialText}`;
    if (text) void navigator.clipboard.writeText(text);
  }, [committedText, editable, editableText, partialText]);

  const handleTranslateStatic = useCallback(async () => {
    const textToTranslate = (editableText || committedText || partialText).trim();
    if (!textToTranslate || !translationEngineId) return;

    setIsStaticTranslating(true);
    setTranslationStatus('translating');
    setTranslationError(null);

    try {
      const audio = window.electron?.audio;
      if (!audio) throw new Error('Audio API is unavailable');
      const result = await audio.translateStatic({
        engineId: translationEngineId,
        text: textToTranslate,
        sourceLanguage: language === 'auto' ? 'zh' : language,
        targetLanguage,
        instructions: translationInstructions,
        latencyMode: translationLatency,
        terminology: technicalTerms(terms),
      });
      const translated = (result.translatedText || (result as any).translation || '').trim();
      if (!translated) {
        throw new Error('No translation returned by the model');
      }
      setEditableTranslation(translated);
      setCommittedTranslation(translated);
      setTranslationDirty(false);
      setTranslationStatus('completed');
    } catch (error) {
      const message = formatErrorMessage(messageFromError(error));
      setTranslationError(message);
      setTranslationStatus('failed');
    } finally {
      setIsStaticTranslating(false);
    }
  }, [
    committedText,
    editable,
    editableText,
    language,
    partialText,
    targetLanguage,
    terms,
    translationEngineId,
    translationInstructions,
    translationLatency,
  ]);

  const playerUrl = source === 'file' ? fileUrl : recordingUrl;
  const canStart = Boolean(selectedProvider) && (source !== 'file' || Boolean(audioFile));
  const fileProgress = state.kind === 'transcribing-file' ? state.progress : 0;

  const selectedEngine = useMemo(
    () => translationCandidates.find(c => c.id === translationEngineId),
    [translationCandidates, translationEngineId],
  );

  const isWsEngine = Boolean(
    selectedEngine?.endpoint?.startsWith('ws://') ||
    selectedEngine?.endpoint?.startsWith('wss://') ||
    selectedEngine?.protocol === 't3po' ||
    selectedEngine?.isSimultaneous
  );

  const unsupportedStreaming = Boolean(realtimeTranslation && translationEngineId && !isWsEngine);

  useEffect(() => {
    if (realtimeTranslation) {
      const isCandidateStreaming = (c: TranslationEngineCandidate) =>
        Boolean(
          c.endpoint?.startsWith('ws://') ||
          c.endpoint?.startsWith('wss://') ||
          c.protocol?.startsWith('ws') ||
          c.protocol === 't3po' ||
          c.isSimultaneous
        );
      const streaming = translationCandidates.filter(isCandidateStreaming);
      if (streaming.length === 0) {
        setRealtimeTranslation(false);
      } else if (!streaming.some(c => c.id === translationEngineId)) {
        setTranslationEngineId(streaming[0].id);
      }
    }
  }, [realtimeTranslation, translationCandidates, translationEngineId]);

  const isRecording = busy;
  const transcriptToTranslate = (editableText || committedText || partialText).trim();
  const hasTranscriptContent = Boolean(transcriptToTranslate);

  let translateDisabled = false;
  let translateTooltip = `Translate to ${targetLanguage.toUpperCase()}`;

  if (realtimeTranslation) {
    translateDisabled = true;
    translateTooltip = 'Real-time translation is active';
  } else if (isRecording) {
    translateDisabled = true;
    translateTooltip = 'Dictation in progress, stop to translate';
  } else if (isStaticTranslating) {
    translateDisabled = true;
    translateTooltip = 'Translating...';
  } else if (!translationEngineId) {
    translateDisabled = true;
    translateTooltip = 'Select a translation engine';
  } else if (!hasTranscriptContent) {
    translateDisabled = true;
    translateTooltip = 'No transcript to translate';
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <SystemAudioPermissionDialog
        isOpen={systemAudioPermissionDialogOpen}
        permissionInfo={systemAudioPermissionInfo}
        onClose={() => {
          setStorageFlag(window.sessionStorage, SYSTEM_AUDIO_PERMISSION_GUIDE_DISMISSED_KEY, true);
          setSystemAudioPermissionDialogOpen(false);
        }}
        onOpenSettings={() => {
          void window.electron?.audio.openSystemAudioSettings().catch(error => {
            setState({ kind: 'failed', message: messageFromError(error) });
          });
        }}
      />
      <div className="audio-workspace-grid min-h-0 flex-1">
        <AudioControlsPanel
          source={source}
          availableSources={availableSources}
          onSourceChange={nextSource => {
            if (!busy) setSource(nextSource);
          }}
          microphoneSelection={microphoneSelection}
          microphoneOptions={microphoneOptions}
          onMicrophoneSelectionChange={setMicrophoneSelection}
          onRequestMicrophoneDevices={requestMicrophoneDevices}
          file={audioFile}
          fileMetadata={fileMetadata}
          onFileChange={selectFile}
          language={language}
          onLanguageChange={setLanguage}
          providers={recognitionProviders}
          providerId={providerId}
          onProviderChange={setProviderId}
          technicalTerms={terms}
          onTechnicalTermsChange={setTerms}
          translationCandidates={translationCandidates}
          translationEngineId={translationEngineId}
          onTranslationEngineChange={handleTranslationEngineChange}
          targetLanguage={targetLanguage}
          onTargetLanguageChange={setTargetLanguage}
          realtimeTranslation={realtimeTranslation}
          onRealtimeTranslationChange={setRealtimeTranslation}
          translationLatency={translationLatency}
          onTranslationLatencyChange={setTranslationLatency}
          translationInstructions={translationInstructions}
          onTranslationInstructionsChange={value => {
            setTranslationInstructions(value);
            setInstructionsCustomized(true);
          }}
          isActive={busy}
          canStart={canStart}
          isFinalizing={state.kind === 'finalizing'}
          fileProgress={fileProgress}
          onStart={start}
          onStop={() => void stop()}
          onCancel={() => void cancel()}
        />
        <TranscriptEditor
          committedText={committedText}
          partialText={partialText}
          editableText={editableText}
          editable={editable}
          dirty={transcriptDirty}
          busy={busy}
          error={state.kind === 'failed' ? formatErrorMessage(state.message) : null}
          artifacts={artifacts}
          activeTab={transcriptTab}
          canRediarize={Boolean(recordingPath && (editableText || committedText))}
          isDiarizing={isDiarizing}
          onRediarize={() => void handleRediarize(recordingPath)}
          onTabChange={setTranscriptTab}
          onChange={value => {
            setEditableText(value);
            setTranscriptDirty(true);
          }}
          onCopy={copyTranscript}
          onClear={clearTranscript}
        />
        <TranslationEditor
          committedText={committedTranslation}
          editableText={editableTranslation}
          editable={editable}
          dirty={translationDirty}
          isRealtimeActive={busy && realtimeTranslation && isWsEngine}
          status={translationStatus}
          error={translationError}
          unsupportedStreaming={unsupportedStreaming}
          isTranslating={isStaticTranslating}
          translateDisabled={translateDisabled}
          translateTooltip={translateTooltip}
          targetLanguage={targetLanguage}
          onChange={value => {
            setEditableTranslation(value);
            setTranslationDirty(true);
          }}
          onTranslate={() => void handleTranslateStatic()}
          onCopy={() => {
            const text = editable ? editableTranslation : committedTranslation;
            if (text) void navigator.clipboard.writeText(text);
          }}
          onClear={() => {
            setCommittedTranslation('');
            setEditableTranslation('');
            setTranslationDirty(false);
            setTranslationStatus('idle');
            setTranslationError(null);
          }}
        />
      </div>

      <footer className="shrink-0 border-t border-border bg-surface/70 px-4 py-3">
        <div className="mb-2 flex items-center justify-between gap-3 text-[11px] text-text-muted">
          <div className="flex min-w-0 items-center gap-2">
            {source === 'file'
              ? <FileAudio size={13} />
              : source === 'system'
                ? <Volume2 size={13} />
                : source === 'mixed'
                  ? <AudioLines size={13} />
                  : <Mic size={13} />}
            <span className="shrink-0">{statusLabel(state)}</span>
            {state.kind === 'recording' && <Radio size={12} className="animate-pulse text-red-400" />}
            {recordingPath && (
              <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
                <button
                  type="button"
                  title={revealTitle}
                  onClick={() => void handleRevealInFolder(recordingPath)}
                  className="rounded p-0.5 text-text-muted transition-colors hover:bg-surface-light hover:text-text-main"
                >
                  <FolderOpen size={13} />
                </button>
                <button
                  type="button"
                  title="Redo speaker diarization (Nemotron-3)"
                  disabled={isDiarizing || busy}
                  onClick={() => void handleRediarize(recordingPath)}
                  className="rounded p-0.5 text-text-muted transition-colors hover:bg-surface-light hover:text-text-main disabled:opacity-40"
                >
                  <Sparkles size={13} className={isDiarizing ? 'animate-spin text-primary' : ''} />
                </button>
                <span className="truncate font-mono text-[11px]" title={recordingPath}>
                  {formatTildePath(recordingPath)}
                </span>
                <button
                  type="button"
                  title="Delete recording"
                  onClick={() => void handleDeleteRecording(recordingPath)}
                  className="rounded p-0.5 text-text-muted transition-colors hover:bg-red-400/10 hover:text-red-400"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            )}
          </div>
          {selectedProvider && <span className="shrink-0">{selectedProvider.name}</span>}
        </div>

        {source !== 'file' && busy ? (
          <div className="flex items-center gap-3">
            <Waves size={16} className="shrink-0 text-primary" />
            <LiveWaveformCanvas peaks={livePeaks} active />
          </div>
        ) : playerUrl ? (
          <AudioWaveformPlayer audioUrl={playerUrl} />
        ) : (
          <div className="flex h-16 items-center justify-center gap-2 rounded-lg bg-surface-light text-xs text-text-muted">
            <Waves size={16} /> The audio waveform will appear here.
          </div>
        )}
      </footer>
    </div>
  );
}
