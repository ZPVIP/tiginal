import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, FileAudio, FolderOpen, Mic, Radio, Trash2, Waves } from 'lucide-react';
import type {
  AudioSessionEvent,
  SpeechProvider,
  TranslationEngineCandidate,
  TranslationLatencyMode,
} from '../../../shared/audio/types';
import { defaultT3POInstructions } from '../../../shared/audio/t3po-prompt';
import { PcmCapture } from '../../audio/PcmCapture';
import {
  AudioFileTranscriber,
  inspectAudioFile,
  type AudioFileMetadata,
} from '../../audio/AudioFileTranscriber';
import { AudioControlsPanel, type AudioInputSource } from './AudioControlsPanel';
import { AudioWaveformPlayer } from './AudioWaveformPlayer';
import { LiveWaveformCanvas } from './LiveWaveformCanvas';
import { TranscriptEditor } from './TranscriptEditor';
import { TranslationEditor } from './TranslationEditor';

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
    case 'requesting-permission': return 'Requesting microphone permission';
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
  const [source, setSource] = useState<AudioInputSource>('microphone');
  const [language, setLanguage] = useState('auto');
  const [terms, setTerms] = useState('');
  const [microphoneDevice, setMicrophoneDevice] = useState('System Default');
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
  const [state, setState] = useState<WorkbenchState>({ kind: 'idle' });

  // Translation states
  const [translationCandidates, setTranslationCandidates] = useState<TranslationEngineCandidate[]>([]);
  const [translationEngineId, setTranslationEngineId] = useState('');
  const [targetLanguage, setTargetLanguage] = useState('en');
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

  const captureRef = useRef<PcmCapture | null>(null);
  const fileTranscriberRef = useRef<AudioFileTranscriber | null>(null);
  const committedTextRef = useRef('');
  const activeSourceRef = useRef<AudioInputSource>('microphone');
  const activeRecordingPathRef = useRef('');
  const busy = isBusy(state);
  const editable = !busy;

  const selectedProvider = useMemo(
    () => providers.find(provider => provider.id === providerId),
    [providerId, providers],
  );

  // Update default instructions when languages change, unless user customized them
  useEffect(() => {
    if (!instructionsCustomized) {
      const src = language === 'auto' ? 'zh' : language;
      setTranslationInstructions(defaultT3POInstructions(src, targetLanguage));
    }
  }, [instructionsCustomized, language, targetLanguage]);

  useEffect(() => {
    const audio = window.electron?.audio;
    if (!audio) {
      setState({ kind: 'failed', message: 'Audio API is unavailable.' });
      return;
    }
    void audio.listSpeechProviders().then(items => {
      setProviders(items);
      const preferred = items.find(item => item.enabled);
      if (preferred) {
        setProviderId(previous => previous || preferred.id);
        setLanguage(previous => previous === 'auto' ? preferred.defaultLanguage : previous);
      }
    }).catch(error => setState({ kind: 'failed', message: messageFromError(error) }));

    void audio.listTranslationCandidates().then(items => {
      setTranslationCandidates(items);
      if (items.length > 0) {
        setTranslationEngineId(previous => previous || items[0].id);
      }
    }).catch(() => undefined);
  }, []);

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
    if (!window.confirm('Are you sure you want to delete this recording file?')) {
      return;
    }
    try {
      await window.electron?.audio?.deleteRecording(filePath);
      if (recordingPath === filePath) {
        setRecordingPath('');
        setRecordingUrl('');
      }
    } catch (err) {
      console.error('Failed to delete recording:', err);
    }
  }, [recordingPath]);

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
          setState(activeSourceRef.current === 'microphone'
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
          setState({ kind: 'failed', message: event.event.message });
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
      if (activeSourceRef.current === 'microphone' && recPath) void loadRecordingUrl(recPath);

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
      setState({ kind: 'failed', message: event.message });
      return;
    }
  }, [loadRecordingUrl]);

  const confirmDiscardEdits = useCallback((): boolean => {
    if (!transcriptDirty && !translationDirty) return true;
    return window.confirm('Discard your edits and start a new session?');
  }, [transcriptDirty, translationDirty]);

  const handleTranslationEngineChange = useCallback((id: string) => {
    setTranslationEngineId(id);
    setTranslationError(null);
    setTranslationStatus('idle');
  }, []);

  const handleResetInstructions = useCallback(() => {
    const src = language === 'auto' ? 'zh' : language;
    setTranslationInstructions(defaultT3POInstructions(src, targetLanguage));
    setInstructionsCustomized(false);
  }, [language, targetLanguage]);

  const startMicrophone = useCallback(async () => {
    if (captureRef.current || fileTranscriberRef.current || !selectedProvider || !confirmDiscardEdits()) return;
    resetTranscript();
    setRecordingUrl('');
    setRecordingPath('');
    setLivePeaks([]);
    activeSourceRef.current = 'microphone';
    setState({ kind: 'requesting-permission' });

    const capture = new PcmCapture({
      onPermissionGranted: () => setState({ kind: 'connecting' }),
      onDevice: setMicrophoneDevice,
      onPeak: peak => setLivePeaks(previous => [...previous.slice(-1_599), peak]),
      onSessionEvent: handleSessionEvent,
    });
    captureRef.current = capture;

    const candidate = translationCandidates.find(c => c.id === translationEngineId);
    const isWs = Boolean(
      candidate?.endpoint?.startsWith('ws://') ||
      candidate?.endpoint?.startsWith('wss://') ||
      candidate?.protocol?.startsWith('t3po-')
    );
    const translationConfig = (realtimeTranslation && translationEngineId && isWs) ? {
      engineId: translationEngineId,
      targetLanguage,
      latencyMode: translationLatency,
      instructions: translationInstructions,
      terminology: technicalTerms(terms),
    } : undefined;

    try {
      const snapshot = await capture.start({
        providerId: selectedProvider.id,
        language,
        bookedWords: technicalTerms(terms),
        translation: translationConfig,
      });
      const recPath = snapshot.recordingPath ?? '';
      activeRecordingPathRef.current = recPath;
      setRecordingPath(recPath);
    } catch (error) {
      captureRef.current = null;
      setState({ kind: 'failed', message: messageFromError(error) });
    }
  }, [
    confirmDiscardEdits,
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
      candidate?.protocol?.startsWith('t3po-')
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
      setState({ kind: 'failed', message: messageFromError(error) });
    } finally {
      fileTranscriberRef.current = null;
    }
  }, [
    audioFile,
    confirmDiscardEdits,
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
    if (source === 'microphone') void startMicrophone();
    else void startFileTranscription();
  }, [source, startFileTranscription, startMicrophone]);

  const stop = useCallback(async () => {
    setState({ kind: 'finalizing' });
    try {
      if (activeSourceRef.current === 'microphone') await captureRef.current?.stop();
      else fileTranscriberRef.current?.requestFinish();
    } catch (error) {
      setState({ kind: 'failed', message: messageFromError(error) });
    } finally {
      captureRef.current = null;
      if (activeSourceRef.current === 'microphone') fileTranscriberRef.current = null;
    }
  }, []);

  const cancel = useCallback(async () => {
    try {
      await Promise.all([
        captureRef.current?.abort(),
        fileTranscriberRef.current?.abort(),
      ]);
      const path = activeRecordingPathRef.current;
      if (path && activeSourceRef.current === 'microphone') await loadRecordingUrl(path);
      setEditableText(committedTextRef.current);
      setPartialText('');
      setState(committedTextRef.current ? { kind: 'ready' } : { kind: 'idle' });
      setTranslationStatus(committedTranslation ? 'completed' : 'idle');
    } catch (error) {
      setState({ kind: 'failed', message: messageFromError(error) });
    } finally {
      captureRef.current = null;
      fileTranscriberRef.current = null;
    }
  }, [committedTranslation, loadRecordingUrl]);

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
  const canStart = Boolean(selectedProvider?.enabled) && (source === 'microphone' || Boolean(audioFile));
  const fileProgress = state.kind === 'transcribing-file' ? state.progress : 0;

  const selectedEngine = useMemo(
    () => translationCandidates.find(c => c.id === translationEngineId),
    [translationCandidates, translationEngineId],
  );

  const isWsEngine = Boolean(
    selectedEngine?.endpoint?.startsWith('ws://') ||
    selectedEngine?.endpoint?.startsWith('wss://') ||
    selectedEngine?.protocol?.startsWith('t3po-') ||
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
          c.protocol?.startsWith('t3po-') ||
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
      <div className="audio-workspace-grid min-h-0 flex-1">
        <AudioControlsPanel
          source={source}
          onSourceChange={nextSource => {
            if (!busy) setSource(nextSource);
          }}
          microphoneDevice={microphoneDevice}
          file={audioFile}
          fileMetadata={fileMetadata}
          onFileChange={selectFile}
          language={language}
          onLanguageChange={setLanguage}
          providers={providers}
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
          onResetTranslationInstructions={handleResetInstructions}
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
            {source === 'microphone' ? <Mic size={13} /> : <FileAudio size={13} />}
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

        {state.kind === 'failed' && (
          <div className="mb-2 flex items-start gap-2 rounded-lg border border-accent-danger/30 bg-accent-danger/10 px-3 py-2 text-xs text-accent-danger">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span>{formatErrorMessage(state.message)}</span>
          </div>
        )}

        {source === 'microphone' && busy ? (
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
