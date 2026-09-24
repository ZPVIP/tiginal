import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, FileAudio, Mic, Radio, Waves } from 'lucide-react';
import type { AudioSessionEvent, SpeechProvider } from '../../../shared/audio/types';
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
  const captureRef = useRef<PcmCapture | null>(null);
  const fileTranscriberRef = useRef<AudioFileTranscriber | null>(null);
  const committedTextRef = useRef('');
  const activeSourceRef = useRef<AudioInputSource>('microphone');
  const activeRecordingPathRef = useRef('');
  const busy = isBusy(state);
  const editable = state.kind === 'ready' || state.kind === 'failed';

  const selectedProvider = useMemo(
    () => providers.find(provider => provider.id === providerId),
    [providerId, providers],
  );

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

  const handleSessionEvent = useCallback((event: AudioSessionEvent) => {
    if (event.kind === 'session-created') {
      activeRecordingPathRef.current = event.session.recordingPath;
      setRecordingPath(event.session.recordingPath);
      return;
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

    const finalText = committedTextRef.current;
    captureRef.current = null;
    setEditableText(finalText);
    setPartialText('');
    setRecordingPath(event.recordingPath);
    activeRecordingPathRef.current = event.recordingPath;
    if (activeSourceRef.current === 'microphone') void loadRecordingUrl(event.recordingPath);

    if (event.kind === 'completed') {
      setState({ kind: 'ready' });
    } else {
      setState({ kind: 'failed', message: event.message });
    }
  }, [loadRecordingUrl]);

  const confirmDiscardEdits = useCallback((): boolean => {
    if (!transcriptDirty) return true;
    return window.confirm('Discard your transcript edits and start a new session?');
  }, [transcriptDirty]);

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
    try {
      const snapshot = await capture.start({
        providerId: selectedProvider.id,
        language,
        bookedWords: technicalTerms(terms),
      });
      activeRecordingPathRef.current = snapshot.recordingPath;
      setRecordingPath(snapshot.recordingPath);
    } catch (error) {
      captureRef.current = null;
      setState({ kind: 'failed', message: messageFromError(error) });
    }
  }, [confirmDiscardEdits, handleSessionEvent, language, resetTranscript, selectedProvider, terms]);

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
    try {
      await transcriber.start(audioFile, {
        providerId: selectedProvider.id,
        language,
        bookedWords: technicalTerms(terms),
      });
    } catch (error) {
      setState({ kind: 'failed', message: messageFromError(error) });
    } finally {
      fileTranscriberRef.current = null;
    }
  }, [audioFile, confirmDiscardEdits, handleSessionEvent, language, resetTranscript, selectedProvider, terms]);

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
    } catch (error) {
      setState({ kind: 'failed', message: messageFromError(error) });
    } finally {
      captureRef.current = null;
      fileTranscriberRef.current = null;
    }
  }, [loadRecordingUrl]);

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

  const playerUrl = source === 'file' ? fileUrl : recordingUrl;
  const canStart = Boolean(selectedProvider?.enabled) && (source === 'microphone' || Boolean(audioFile));
  const fileProgress = state.kind === 'transcribing-file' ? state.progress : 0;

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
        <TranslationEditor transcriptReady={editable && Boolean(editableText.trim())} />
      </div>

      <footer className="shrink-0 border-t border-border bg-surface/70 px-4 py-3">
        <div className="mb-2 flex items-center justify-between gap-3 text-[11px] text-text-muted">
          <div className="flex min-w-0 items-center gap-2">
            {source === 'microphone' ? <Mic size={13} /> : <FileAudio size={13} />}
            <span className="shrink-0">{statusLabel(state)}</span>
            {state.kind === 'recording' && <Radio size={12} className="animate-pulse text-red-400" />}
            {recordingPath && (
              <span className="truncate" title={recordingPath}>{recordingPath}</span>
            )}
          </div>
          {selectedProvider && <span className="shrink-0">{selectedProvider.name}</span>}
        </div>

        {state.kind === 'failed' && (
          <div className="mb-2 flex items-start gap-2 rounded-lg border border-accent-danger/30 bg-accent-danger/10 px-3 py-2 text-xs text-accent-danger">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span>{state.message}</span>
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
