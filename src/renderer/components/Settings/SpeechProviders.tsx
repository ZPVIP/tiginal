import { useCallback, useEffect, useRef, useState } from 'react';
import { Edit2, Mic, Mic2, Plus, Radio, Square, Trash2 } from 'lucide-react';
import type { SpeechProvider } from '../../../shared/audio/types';
import { PcmCapture } from '../../audio/PcmCapture';
import { SpeechProviderModal } from './SpeechProviderModal';

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function SpeechProviders() {
  const [providers, setProviders] = useState<SpeechProvider[]>([]);
  const [editing, setEditing] = useState<SpeechProvider | null | undefined>(undefined);
  const [editingCredential, setEditingCredential] = useState('');
  const [error, setError] = useState('');
  const [recordingProviderId, setRecordingProviderId] = useState<string | null>(null);
  const [recordingStatus, setRecordingStatus] = useState('');
  const [recordingPath, setRecordingPath] = useState<string | null>(null);
  const captureRef = useRef<PcmCapture | null>(null);

  const load = useCallback(async () => {
    const audio = window.electron?.audio;
    if (!audio) return;
    try {
      setProviders(await audio.listSpeechProviders());
      setError('');
    } catch (loadError) {
      setError(messageFromError(loadError));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => () => {
    void captureRef.current?.abort();
  }, []);

  const startMicrophoneTest = async (provider: SpeechProvider) => {
    if (captureRef.current || !provider.enabled) return;
    setError('');
    setRecordingStatus('Connecting...');
    setRecordingPath(null);
    const capture = new PcmCapture({
      onSessionEvent: event => {
        if (event.kind === 'provider-event') {
          if (event.event.kind === 'connected') setRecordingStatus('Listening...');
          if (event.event.kind === 'partial') setRecordingStatus(event.event.text || 'Listening...');
          if (event.event.kind === 'committed') setRecordingStatus(event.event.fullText);
        } else if (event.kind === 'completed') {
          setRecordingStatus(`Saved to ${event.recordingPath}`);
          setRecordingPath(event.recordingPath);
          captureRef.current = null;
          setRecordingProviderId(null);
        } else if (event.kind === 'failed') {
          setError(event.message);
          setRecordingStatus(`Recording saved to ${event.recordingPath}`);
          setRecordingPath(event.recordingPath);
          captureRef.current = null;
          setRecordingProviderId(null);
        }
      },
    });
    captureRef.current = capture;
    setRecordingProviderId(provider.id);
    try {
      await capture.start({ providerId: provider.id, language: provider.defaultLanguage });
    } catch (startError) {
      captureRef.current = null;
      setRecordingProviderId(null);
      setRecordingStatus('');
      setError(messageFromError(startError));
    }
  };

  const stopMicrophoneTest = async () => {
    const capture = captureRef.current;
    if (!capture) return;
    setRecordingStatus('Finalizing...');
    try {
      await capture.stop();
    } catch (stopError) {
      setError(messageFromError(stopError));
    } finally {
      captureRef.current = null;
      setRecordingProviderId(null);
    }
  };

  const deleteProvider = async (provider: SpeechProvider) => {
    const audio = window.electron?.audio;
    if (!audio) return;
    if (!window.confirm(`Delete speech provider "${provider.name}"?`)) return;
    try {
      await audio.deleteSpeechProvider(provider.id);
      await load();
    } catch (deleteError) {
      setError(messageFromError(deleteError));
    }
  };

  const editProvider = async (provider: SpeechProvider) => {
    const audio = window.electron?.audio;
    if (!audio) return;
    setEditingCredential(await audio.getSpeechProviderCredential(provider.id) ?? '');
    setEditing(provider);
  };

  const deleteRecording = async () => {
    const audio = window.electron?.audio;
    if (!audio || !recordingPath) return;
    if (!window.confirm(`Delete recording "${recordingPath}"?`)) return;
    try {
      await audio.deleteRecording(recordingPath);
      setRecordingPath(null);
      setRecordingStatus('');
    } catch (deleteError) {
      setError(messageFromError(deleteError));
    }
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Mic2 size={18} className="text-primary" />
          <div>
            <h3 className="text-sm font-semibold text-text-main">Speech Recognition Providers</h3>
            <p className="text-xs text-text-muted">WebSocket speech endpoints used by microphone sessions.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            setEditingCredential('');
            setEditing(null);
          }}
          className="flex h-8 items-center gap-2 rounded-lg bg-primary px-3 text-sm text-primary-foreground hover:opacity-90"
        >
          <Plus size={15} /> Add Speech Provider
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-accent-danger/30 bg-accent-danger/10 px-3 py-2 text-xs text-accent-danger">
          {error}
        </div>
      )}

      <div className="grid gap-2">
        {providers.map(provider => (
          <div
            key={provider.id}
            className="group flex items-center justify-between rounded-lg border border-border bg-surface px-3 py-2"
          >
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Radio size={16} />
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-text-main">{provider.name}</span>
                  {!provider.enabled && (
                    <span className="rounded bg-surface-light px-1.5 py-0.5 text-[10px] uppercase text-text-muted">Disabled</span>
                  )}
                </div>
                <p className="truncate text-[10px] text-text-muted">
                  {provider.endpoint} | {provider.protocol} | {provider.maxSessionSeconds === null ? 'No time limit' : `${provider.maxSessionSeconds}s limit`}
                </p>
              </div>
            </div>
            <div className={`flex items-center gap-1 transition-opacity ${recordingProviderId === provider.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
              <button
                type="button"
                disabled={!provider.enabled || (recordingProviderId !== null && recordingProviderId !== provider.id)}
                title={recordingProviderId === provider.id ? 'Stop microphone test' : 'Start microphone test'}
                onClick={() => recordingProviderId === provider.id
                  ? void stopMicrophoneTest()
                  : void startMicrophoneTest(provider)}
                className="rounded-lg p-1.5 text-text-muted hover:bg-primary/10 hover:text-primary disabled:cursor-not-allowed disabled:opacity-30"
              >
                {recordingProviderId === provider.id ? <Square size={14} /> : <Mic size={14} />}
              </button>
              <button
                type="button"
                title="Edit speech provider"
                onClick={() => void editProvider(provider)}
                className="rounded-lg p-1.5 text-text-muted hover:bg-surface-hover hover:text-text-main"
              >
                <Edit2 size={14} />
              </button>
              <button
                type="button"
                title="Delete speech provider"
                onClick={() => void deleteProvider(provider)}
                className="rounded-lg p-1.5 text-text-muted hover:bg-red-400/10 hover:text-red-400"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {recordingStatus && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface-light px-3 py-2 text-xs text-text-muted">
          <span className="min-w-0 break-all">{recordingStatus}</span>
          {recordingPath && (
            <button
              type="button"
              title="Delete recording"
              onClick={() => void deleteRecording()}
              className="shrink-0 rounded-md p-1 text-text-muted hover:bg-red-400/10 hover:text-red-400"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      )}

      {editing !== undefined && (
        <SpeechProviderModal
          provider={editing ?? undefined}
          initialCredential={editingCredential}
          onClose={() => {
            setEditingCredential('');
            setEditing(undefined);
          }}
          onSaved={() => {
            setEditingCredential('');
            setEditing(undefined);
            void load();
          }}
        />
      )}
    </section>
  );
}
