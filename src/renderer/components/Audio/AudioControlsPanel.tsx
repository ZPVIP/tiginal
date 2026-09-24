import { FileAudio, Mic, Square, X } from 'lucide-react';
import type { SpeechProvider } from '../../../shared/audio/types';
import type { AudioFileMetadata } from '../../audio/AudioFileTranscriber';
import { FancySelect } from '../ui/FancySelect';

export type AudioInputSource = 'microphone' | 'file';

interface AudioControlsPanelProps {
  source: AudioInputSource;
  onSourceChange(source: AudioInputSource): void;
  microphoneDevice: string;
  file: File | null;
  fileMetadata: AudioFileMetadata | null;
  onFileChange(file: File | null): void;
  language: string;
  onLanguageChange(language: string): void;
  providers: readonly SpeechProvider[];
  providerId: string;
  onProviderChange(providerId: string): void;
  technicalTerms: string;
  onTechnicalTermsChange(value: string): void;
  isActive: boolean;
  canStart: boolean;
  isFinalizing: boolean;
  fileProgress: number;
  onStart(): void;
  onStop(): void;
  onCancel(): void;
}

const languageOptions = [
  { value: 'auto', label: 'Auto Detect' },
  { value: 'zh', label: 'Chinese' },
  { value: 'en', label: 'English' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'it', label: 'Italian' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'ru', label: 'Russian' },
  { value: 'es', label: 'Spanish' },
  { value: 'ar', label: 'Arabic' },
];

function fileSize(size: number): string {
  if (size < 1_024) return `${size} B`;
  if (size < 1_024 * 1_024) return `${(size / 1_024).toFixed(1)} KB`;
  return `${(size / (1_024 * 1_024)).toFixed(1)} MB`;
}

function durationLabel(seconds: number): string {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

function formatLabel(file: File): string {
  if (file.type) return file.type.replace(/^audio\//, '').toUpperCase();
  const extension = file.name.split('.').pop();
  return extension ? extension.toUpperCase() : 'AUDIO';
}

export function AudioControlsPanel(props: AudioControlsPanelProps) {
  const provider = props.providers.find(item => item.id === props.providerId);
  const actionLabel = props.source === 'microphone' ? 'Start' : 'Transcribe';

  return (
    <aside className="audio-setup-panel flex min-h-0 flex-col border-r border-border bg-surface/40">
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        <div>
          <h1 className="text-base font-semibold text-text-main">Audio</h1>
          <p className="mt-1 text-xs text-text-muted">Record or import audio for streaming transcription.</p>
        </div>

        <fieldset disabled={props.isActive} className="space-y-2 disabled:opacity-60">
          <legend className="mb-2 text-xs font-medium text-text-sec">Input Source</legend>
          <div className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-surface p-1">
            {([
              { value: 'microphone' as const, label: 'Microphone', icon: Mic },
              { value: 'file' as const, label: 'Audio File', icon: FileAudio },
            ]).map(option => {
              const Icon = option.icon;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => props.onSourceChange(option.value)}
                  className={`flex items-center justify-center gap-2 rounded-lg px-2 py-2 text-xs transition-colors ${
                    props.source === option.value
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-text-muted hover:bg-surface-light hover:text-text-main'
                  }`}
                >
                  <Icon size={14} /> {option.label}
                </button>
              );
            })}
          </div>
        </fieldset>

        {props.source === 'microphone' ? (
          <div>
            <label className="mb-1.5 block text-xs font-medium text-text-sec">Microphone Device</label>
            <div className="truncate rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text-muted" title={props.microphoneDevice}>
              {props.microphoneDevice || 'System Default'}
            </div>
          </div>
        ) : (
          <div>
            <label className="mb-1.5 block text-xs font-medium text-text-sec">Audio File</label>
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-surface px-3 py-3 text-xs text-text-muted hover:border-primary hover:text-text-main">
              <FileAudio size={15} />
              {props.file ? 'Choose another file' : 'Choose audio file'}
              <input
                type="file"
                accept="audio/wav,audio/mpeg,audio/mp4,audio/aac,audio/flac,audio/ogg,audio/opus,audio/webm,.m4a"
                disabled={props.isActive}
                onChange={event => props.onFileChange(event.target.files?.[0] ?? null)}
                className="hidden"
              />
            </label>
            {props.file && (
              <div className="mt-2 rounded-lg border border-border bg-surface px-3 py-2">
                <p className="truncate text-xs font-medium text-text-main" title={props.file.name}>{props.file.name}</p>
                <p className="mt-1 text-[10px] text-text-muted">
                  {fileSize(props.file.size)}
                  {` | ${formatLabel(props.file)}`}
                  {props.fileMetadata ? ` | ${durationLabel(props.fileMetadata.durationSeconds)} | ${props.fileMetadata.channels} ch` : ''}
                </p>
              </div>
            )}
          </div>
        )}

        <div>
          <label className="mb-1.5 block text-xs font-medium text-text-sec">Recognition Language</label>
          <FancySelect
            value={props.language}
            onChange={props.onLanguageChange}
            options={languageOptions}
            buttonClassName="h-9"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-text-sec">Speech Recognition</label>
          <FancySelect
            value={props.providerId}
            onChange={props.onProviderChange}
            options={props.providers.map(item => ({
              value: item.id,
              label: item.name,
              disabled: !item.enabled,
            }))}
            placeholder="No speech provider"
            buttonClassName="h-9"
          />
          {provider && (
            <p className="mt-1.5 text-[10px] text-text-muted">
              {provider.maxSessionSeconds === null
                ? 'No Tiginal session limit'
                : `${provider.maxSessionSeconds} second session limit`}
            </p>
          )}
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-text-sec">Technical Terms</label>
          <textarea
            value={props.technicalTerms}
            disabled={props.isActive}
            onChange={event => props.onTechnicalTermsChange(event.target.value)}
            rows={3}
            placeholder="One term per line"
            className="w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text-main placeholder:text-text-muted disabled:opacity-60"
          />
        </div>
      </div>

      <div className="shrink-0 border-t border-border p-4">
        {props.source === 'file' && props.isActive && (
          <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-surface-light">
            <div className="h-full bg-primary transition-[width]" style={{ width: `${Math.round(props.fileProgress * 100)}%` }} />
          </div>
        )}
        <div className="flex gap-2">
          {!props.isActive ? (
            <button
              type="button"
              disabled={!props.canStart}
              onClick={props.onStart}
              className="flex h-9 flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {props.source === 'microphone' ? <Mic size={15} /> : <FileAudio size={15} />}
              {actionLabel}
            </button>
          ) : (
            <>
              <button
                type="button"
                disabled={props.isFinalizing}
                onClick={props.onStop}
                className="flex h-9 flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
              >
                <Square size={14} /> Stop
              </button>
              <button
                type="button"
                onClick={props.onCancel}
                className="flex h-9 items-center justify-center gap-2 rounded-lg border border-border px-3 text-sm text-text-sec hover:bg-surface-light hover:text-text-main"
              >
                <X size={15} /> Cancel
              </button>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
