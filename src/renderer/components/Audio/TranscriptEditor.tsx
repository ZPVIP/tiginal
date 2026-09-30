import { useState } from 'react';
import { AlertCircle, LoaderCircle, Sparkles, Trash2, X } from 'lucide-react';
import type { AudioSessionArtifacts } from '../../../shared/audio/types';
import { CopyButton } from '../ui/CopyButton';

export type TranscriptTab = 'transcript' | 'speakers' | 'srt';

export function getTabFileName(recordingPath: string, tab: TranscriptTab): string {
  if (!recordingPath) return '';
  const base = recordingPath.split(/[/\\]/).pop() || '';
  const stem = base.replace(/(-diar)?\.[^/.]+$/i, '');
  if (!stem) return '';
  switch (tab) {
    case 'transcript':
      return `${stem}.txt`;
    case 'speakers':
      return `${stem}-diar.txt`;
    case 'srt':
      return `${stem}.srt`;
  }
}

interface TranscriptEditorProps {
  committedText: string;
  partialText: string;
  editableText: string;
  editable: boolean;
  dirty: boolean;
  busy: boolean;
  error?: string | null;
  artifacts?: AudioSessionArtifacts;
  activeTab?: TranscriptTab;
  recordingPath?: string;
  canRediarize?: boolean;
  isDiarizing?: boolean;
  onRediarize?(): void;
  onCancelDiarize?(): void;
  onTabChange?(tab: TranscriptTab): void;
  onChange(value: string): void;
  onCopy?(): void;
  onClear(): void;
  onDeleteArtifact?(tab: TranscriptTab): void;
}

export function TranscriptEditor(props: TranscriptEditorProps) {
  const streamingText = `${props.committedText}${props.partialText}`;
  const [internalTab, setInternalTab] = useState<TranscriptTab>('transcript');
  const selectedTab = props.activeTab ?? internalTab;
  const setTab = props.onTabChange ?? setInternalTab;

  const tabs: Array<{ id: TranscriptTab; label: string; enabled: boolean; tooltip: string }> = [
    {
      id: 'transcript',
      label: 'Transcript',
      enabled: true,
      tooltip: 'Full plain transcript (.txt)',
    },
    {
      id: 'speakers',
      label: 'Speakers',
      enabled: Boolean(props.artifacts?.speakers || props.canRediarize),
      tooltip: props.artifacts?.speakers
        ? 'Diarized transcript with speaker labels (-diar.txt)'
        : 'Available when Nemotron + MMS-Align diarization is generated',
    },
    {
      id: 'srt',
      label: 'SRT',
      enabled: Boolean(props.artifacts?.srt),
      tooltip: props.artifacts?.srt
        ? 'SubRip subtitle format with timestamps (.srt)'
        : 'Available when Nemotron + MMS-Align diarization is generated',
    },
  ];

  const currentTab = tabs.find(t => t.id === selectedTab)?.enabled ? selectedTab : 'transcript';

  const getCurrentTextToCopy = (): string => {
    switch (currentTab) {
      case 'speakers':
        return props.artifacts?.speakers || '';
      case 'srt':
        return props.artifacts?.srt || '';
      case 'transcript':
      default:
        return props.editable ? props.editableText : streamingText;
    }
  };

  const canDeleteCurrent = (): boolean => {
    if (props.busy) return false;
    switch (currentTab) {
      case 'speakers':
        return Boolean(props.artifacts?.speakers);
      case 'srt':
        return Boolean(props.artifacts?.srt);
      case 'transcript':
      default:
        return Boolean(props.editableText || streamingText || props.artifacts?.transcript);
    }
  };

  const getDeleteTitle = (): string => {
    const fileName = getTabFileName(props.recordingPath || '', currentTab);
    if (fileName) return `Delete ${fileName}`;
    switch (currentTab) {
      case 'speakers':
        return 'Delete speakers diarization';
      case 'srt':
        return 'Delete SRT subtitle';
      case 'transcript':
      default:
        return 'Clear transcript';
    }
  };

  const handleDeleteCurrent = () => {
    if (!canDeleteCurrent()) return;
    const fileName = getTabFileName(props.recordingPath || '', currentTab);
    const confirmMessage = fileName
      ? `是不是要真的删除 ${fileName}?`
      : (currentTab === 'transcript' ? '是不是要真的清空文本？' : `是不是要真的删除 ${currentTab}?`);

    if (!window.confirm(confirmMessage)) return;

    if (props.onDeleteArtifact) {
      props.onDeleteArtifact(currentTab);
    } else {
      props.onClear();
    }
  };

  return (
    <section className="flex min-h-0 min-w-0 w-full flex-1 flex-col bg-background overflow-hidden">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 rounded-lg border border-border/50 bg-surface-light/80 p-0.5">
            {tabs.map(tab => {
              const isSelected = tab.id === currentTab;
              return (
                <button
                  key={tab.id}
                  type="button"
                  title={tab.tooltip}
                  disabled={!tab.enabled}
                  onClick={() => setTab(tab.id)}
                  className={`rounded-md px-2.5 py-1 text-xs transition-all ${
                    isSelected
                      ? 'bg-surface font-medium text-text-main shadow-xs'
                      : tab.enabled
                        ? 'text-text-muted hover:text-text-main'
                        : 'cursor-not-allowed opacity-35'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
          {props.busy && <LoaderCircle size={14} className="animate-spin text-primary" />}
        </div>

        <div className="flex min-w-0 items-center gap-1">
          {props.error && (
            <span
              title={props.error}
              className="mr-1 flex min-w-0 items-center gap-1.5 rounded-md border border-accent-danger/30 bg-accent-danger/10 px-2 py-1 text-[11px] text-accent-danger"
            >
              <AlertCircle size={12} className="shrink-0" />
              <span className="truncate">{props.error}</span>
            </span>
          )}
          {currentTab === 'speakers' && props.canRediarize && (
            <div className="mr-1 flex items-center gap-1">
              <button
                type="button"
                title="Redo speaker diarization (Nemotron + MMS-Align) and generate Speakers, SRT"
                disabled={props.busy || props.isDiarizing}
                onClick={props.onRediarize}
                className="flex items-center gap-1.5 rounded-md border border-border bg-surface-light px-2 py-1 text-xs text-text-muted hover:border-primary hover:text-text-main disabled:opacity-40"
              >
                <Sparkles size={12} className={props.isDiarizing ? 'animate-spin text-primary' : 'text-primary'} />
                <span>{props.isDiarizing ? 'Diarizing...' : 'Diarize'}</span>
              </button>
              {props.isDiarizing && (
                <button
                  type="button"
                  title="Cancel diarization"
                  onClick={props.onCancelDiarize}
                  className="flex items-center gap-1 rounded-md border border-accent-danger/40 bg-accent-danger/10 px-2 py-1 text-xs text-accent-danger hover:bg-accent-danger/20 transition-colors"
                >
                  <X size={12} />
                  <span>Cancel</span>
                </button>
              )}
            </div>
          )}
          <CopyButton
            key={currentTab}
            title={`Copy ${currentTab}`}
            disabled={!getCurrentTextToCopy()}
            text={getCurrentTextToCopy}
            iconSize={14}
            className="rounded-md p-1.5 text-text-muted hover:bg-surface-light hover:text-text-main disabled:opacity-30"
          />
          <button
            type="button"
            title={getDeleteTitle()}
            disabled={!canDeleteCurrent()}
            onClick={handleDeleteCurrent}
            className="rounded-md p-1.5 text-text-muted hover:bg-red-400/10 hover:text-red-400 disabled:opacity-30"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </header>

      <div className="min-h-0 min-w-0 flex-1 w-full overflow-hidden p-4">
        {currentTab === 'transcript' ? (
          props.editable ? (
            <textarea
              value={props.editableText}
              onChange={event => props.onChange(event.target.value)}
              aria-label="Editable transcript"
              placeholder="The completed transcript will appear here."
              className="h-full min-h-48 w-full max-w-full resize-none rounded-xl border border-border bg-surface/60 p-4 text-sm leading-6 text-text-main placeholder:text-text-muted focus:border-primary overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words"
              style={{ wordBreak: 'break-word', overflowWrap: 'anywhere', overflowX: 'hidden' }}
            />
          ) : (
            <div
              className="h-full min-h-48 w-full max-w-full overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words rounded-xl border border-border bg-surface/40 p-4 text-sm leading-6 text-text-main"
              style={{ wordBreak: 'break-word', overflowWrap: 'anywhere', overflowX: 'hidden' }}
            >
              {props.committedText}
              {props.partialText && <span className="text-text-muted">{props.partialText}</span>}
              {!streamingText && (
                <span className="text-text-muted">
                  {props.busy ? 'Waiting for speech...' : 'Start a live audio session or transcribe an audio file.'}
                </span>
              )}
            </div>
          )
        ) : currentTab === 'speakers' ? (
          <div
            className="h-full min-h-48 w-full max-w-full overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words break-all rounded-xl border border-border bg-surface/60 p-4 text-sm leading-6 text-text-main"
            style={{ wordBreak: 'break-word', overflowWrap: 'anywhere', overflowX: 'hidden' }}
          >
            {props.artifacts?.speakers || 'No speaker diarization available.'}
          </div>
        ) : (
          <pre
            className="h-full min-h-48 w-full max-w-full overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words break-all rounded-xl border border-border bg-surface/60 p-4 font-mono text-xs leading-5 text-text-main"
            style={{ wordBreak: 'break-word', overflowWrap: 'anywhere', overflowX: 'hidden' }}
          >
            {props.artifacts?.srt || 'No SRT subtitles available.'}
          </pre>
        )}
      </div>
    </section>
  );
}
