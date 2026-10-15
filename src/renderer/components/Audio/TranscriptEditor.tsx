import { useState } from 'react';
import { AlertCircle, Check, LoaderCircle, Pencil, Play, Sparkles, Trash2, User, Users, X } from 'lucide-react';
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

export function extractUniqueSpeakers(diarText?: string): string[] {
  if (!diarText) return [];
  const speakers: string[] = [];
  const paragraphs = diarText.split(/\n\s*\n/);
  for (const para of paragraphs) {
    const firstLine = para.trim().split('\n')[0];
    if (!firstLine) continue;
    const colonIdx = firstLine.indexOf(':');
    if (colonIdx > 0) {
      const spk = firstLine.slice(0, colonIdx).trim();
      if (spk && spk.length < 50 && !speakers.includes(spk)) {
        speakers.push(spk);
      }
    }
  }
  return speakers;
}

import { parseSrtBlocks, parseSrtTimeToSeconds, type SrtBlock } from '../../../shared/audio/textUtils';
export { parseSrtBlocks, parseSrtTimeToSeconds, type SrtBlock };

function renderSubtitleText(text: string) {
  const bracketMatch = text.match(/^(\[[^\]]+\]:?)\s*(.*)/s);
  if (bracketMatch) {
    return (
      <>
        <span className="font-semibold text-primary mr-1.5 select-none">{bracketMatch[1]}</span>
        <span>{bracketMatch[2]}</span>
      </>
    );
  }
  const colonMatch = text.match(/^([^:\n]+:)\s*(.*)/s);
  if (colonMatch && colonMatch[1].length < 40) {
    return (
      <>
        <span className="font-semibold text-primary mr-1.5 select-none">{colonMatch[1]}</span>
        <span>{colonMatch[2]}</span>
      </>
    );
  }
  return <span>{text}</span>;
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
  onRenameSpeaker?(oldName: string, newName: string): Promise<void> | void;
  onSeekTime?(timeInSeconds: number): void;
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

  const [editingSpeaker, setEditingSpeaker] = useState<string | null>(null);
  const [editSpeakerValue, setEditSpeakerValue] = useState<string>('');

  const uniqueSpeakers = extractUniqueSpeakers(props.artifacts?.speakers);
  const parsedSrtBlocks = parseSrtBlocks(props.artifacts?.srt);

  const handleSaveRename = async (oldName: string, newName: string) => {
    const trimmed = newName.trim();
    setEditingSpeaker(null);
    if (!trimmed || trimmed === oldName) return;
    if (props.onRenameSpeaker) {
      await props.onRenameSpeaker(oldName, trimmed);
    }
  };

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

      {(currentTab === 'speakers' || currentTab === 'srt') && uniqueSpeakers.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border/70 bg-surface/40 px-4 py-2 shrink-0">
          <div className="flex items-center gap-1.5 text-xs font-medium text-text-muted select-none mr-0.5">
            <Users size={13} className="text-primary" />
            <span>Speakers:</span>
          </div>
          {uniqueSpeakers.map(speaker => {
            const isEditing = editingSpeaker === speaker;
            return isEditing ? (
              <form
                key={speaker}
                onSubmit={e => {
                  e.preventDefault();
                  void handleSaveRename(speaker, editSpeakerValue);
                }}
                className="flex items-center gap-1"
              >
                <input
                  type="text"
                  value={editSpeakerValue}
                  onChange={e => setEditSpeakerValue(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Escape') {
                      setEditingSpeaker(null);
                    }
                  }}
                  onBlur={() => {
                    void handleSaveRename(speaker, editSpeakerValue);
                  }}
                  className="h-6 w-28 rounded-md border border-primary bg-background px-2 text-xs text-text-main shadow-2xs focus:outline-none focus:ring-1 focus:ring-primary"
                  autoFocus
                />
                <button
                  type="submit"
                  title="Save name"
                  className="rounded p-0.5 text-primary hover:bg-primary/10 transition-colors"
                >
                  <Check size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => setEditingSpeaker(null)}
                  title="Cancel"
                  className="rounded p-0.5 text-text-muted hover:bg-surface-light transition-colors"
                >
                  <X size={13} />
                </button>
              </form>
            ) : (
              <button
                key={speaker}
                type="button"
                onClick={() => {
                  setEditingSpeaker(speaker);
                  setEditSpeakerValue(speaker);
                }}
                title={`Click to rename "${speaker}" in diarization and SRT`}
                className="group flex items-center gap-1.5 rounded-md border border-border/70 bg-surface/70 px-2.5 py-1 text-xs text-text-main shadow-2xs hover:border-primary/60 hover:bg-surface hover:text-primary transition-all"
              >
                <User size={11} className="text-primary/70 group-hover:text-primary transition-colors" />
                <span className="font-medium">{speaker}</span>
                <Pencil size={10} className="text-text-muted opacity-40 group-hover:opacity-100 group-hover:text-primary transition-opacity ml-0.5" />
              </button>
            );
          })}
        </div>
      )}

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
            {props.artifacts?.speakers ? (
              props.artifacts.speakers.split(/\n\s*\n/).map((para, idx) => {
                const trimmed = para.trim();
                const colonIdx = trimmed.indexOf(':');
                if (colonIdx > 0 && colonIdx < 50) {
                  const spk = trimmed.slice(0, colonIdx).trim();
                  const body = trimmed.slice(colonIdx + 1);
                  return (
                    <div key={idx} className="mb-4 last:mb-0">
                      <span className="font-semibold text-primary select-none">{spk}:</span>
                      <span>{body}</span>
                    </div>
                  );
                }
                return (
                  <div key={idx} className="mb-4 last:mb-0">
                    {trimmed}
                  </div>
                );
              })
            ) : (
              'No speaker diarization available.'
            )}
          </div>
        ) : (
          <div
            className="h-full min-h-48 w-full max-w-full overflow-y-auto overflow-x-hidden p-4 rounded-xl border border-border bg-surface/60 text-sm leading-6 text-text-main"
            style={{ wordBreak: 'break-word', overflowWrap: 'anywhere', overflowX: 'hidden' }}
          >
            {parsedSrtBlocks.length > 0 ? (
              <div className="flex flex-col gap-2.5">
                {parsedSrtBlocks.map((block, idx) => (
                  <div
                    key={block.index || idx}
                    className="group flex flex-col gap-1.5 rounded-lg border border-border/70 bg-surface/40 p-3 hover:border-primary/40 hover:bg-surface/70 transition-all"
                  >
                    <div className="flex items-center gap-2">
                      {block.index && (
                        <span className="font-mono text-[11px] text-text-muted select-none">
                          #{block.index}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => props.onSeekTime?.(block.startSeconds)}
                        title={`Click to jump audio to ${block.startTime}`}
                        className="inline-flex items-center gap-1.5 rounded-md border border-border/80 bg-surface-light px-2 py-0.5 font-mono text-[11px] text-text-main hover:border-primary hover:bg-primary/10 hover:text-primary transition-all cursor-pointer font-medium"
                      >
                        <Play size={10} className="fill-current text-primary" />
                        <span>{block.startTime}</span>
                        <span className="text-text-muted">→</span>
                        <span className="text-text-muted">{block.endTime}</span>
                      </button>
                    </div>
                    <div className="text-sm leading-6 text-text-main whitespace-pre-wrap break-words">
                      {renderSubtitleText(block.text)}
                    </div>
                  </div>
                ))}
              </div>
            ) : props.artifacts?.srt ? (
              <pre className="font-mono text-xs leading-5 whitespace-pre-wrap break-words">
                {props.artifacts.srt}
              </pre>
            ) : (
              <span className="text-text-muted">No SRT subtitles available.</span>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
