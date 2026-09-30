import { AudioLines, ChevronDown, FileAudio, Loader2, Mic, Square, Volume2, X } from 'lucide-react';
import type {
  AudioInputSourceKind,
  SpeechProvider,
  TranslationEngineCandidate,
  TranslationLatencyMode,
} from '../../../shared/audio/types';
import type { AudioFileMetadata } from '../../audio/AudioFileTranscriber';
import {
  microphoneSelectionFromValue,
  microphoneSelectionValue,
  type MicrophoneDeviceOption,
  type MicrophoneSelection,
} from '../../audio/MicrophoneDevices';
import { InfoIcon } from '../Shared/InfoIcon';
import { FancySelect } from '../ui/FancySelect';
import { Toggle } from '../ui/Toggle';

interface AudioControlsPanelProps {
  source: AudioInputSourceKind;
  availableSources: readonly AudioInputSourceKind[];
  onSourceChange(source: AudioInputSourceKind): void;
  microphoneSelection: MicrophoneSelection;
  microphoneOptions: readonly MicrophoneDeviceOption[];
  onMicrophoneSelectionChange(selection: MicrophoneSelection): void;
  onRequestMicrophoneDevices(): void;
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
  translationCandidates: readonly TranslationEngineCandidate[];
  translationEngineId: string;
  onTranslationEngineChange(id: string): void;
  targetLanguage: string;
  onTargetLanguageChange(lang: string): void;
  realtimeTranslation: boolean;
  onRealtimeTranslationChange(enabled: boolean): void;
  translationLatency: TranslationLatencyMode;
  onTranslationLatencyChange(mode: TranslationLatencyMode): void;
  translationInstructions: string;
  onTranslationInstructionsChange(value: string): void;
  isActive: boolean;
  canStart: boolean;
  isFinalizing: boolean;
  fileProgress: number;
  filePhase?: string;
  onStart(): void;
  onStop(): void;
  onCancel(): void;
}

const languageOptions = [
  { value: 'auto', label: 'Auto Detect' },
  { value: 'cn', label: 'Chinese' },
  { value: 'yue', label: 'Cantonese' },
  { value: 'en', label: 'English' },
  { value: 'jp', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'es', label: 'Spanish' },
  { value: 'it', label: 'Italian' },
  { value: 'ru', label: 'Russian' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'th', label: 'Thai' },
  { value: 'vi', label: 'Vietnamese' },
  { value: 'id', label: 'Indonesian' },
  { value: 'tr', label: 'Turkish' },
  { value: 'hi', label: 'Hindi' },
  { value: 'ms', label: 'Malay' },
  { value: 'nl', label: 'Dutch' },
  { value: 'sv', label: 'Swedish' },
  { value: 'da', label: 'Danish' },
  { value: 'fi', label: 'Finnish' },
  { value: 'pl', label: 'Polish' },
  { value: 'cs', label: 'Czech' },
  { value: 'fil', label: 'Filipino' },
  { value: 'fa', label: 'Persian' },
  { value: 'el', label: 'Greek' },
  { value: 'ro', label: 'Romanian' },
  { value: 'hu', label: 'Hungarian' },
  { value: 'mk', label: 'Macedonian' },
  { value: 'ar', label: 'Arabic' },
];

const targetLanguageOptions = [
  { value: 'zh', label: 'Chinese' },
  { value: 'en', label: 'English' },
];

const latencyOptions: { value: TranslationLatencyMode; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'native', label: 'Native' },
  { value: 'high', label: 'High' },
];

const latencyDescription = 'Sent to T3PO as init.latency_mode. Low commits sooner with less context. Native uses the model default. High waits for more context before committing.';

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
  const selectedEngine = props.translationCandidates.find(candidate => candidate.id === props.translationEngineId);
  const isT3PO = selectedEngine?.protocol === 't3po';
  const actionLabel = props.source === 'file' ? 'Transcribe' : 'Start';
  const sourceOptions = [
    { value: 'microphone' as const, label: 'Microphone', icon: Mic },
    { value: 'system' as const, label: 'System Audio', icon: Volume2 },
    { value: 'mixed' as const, label: 'Mic + System', icon: AudioLines },
    { value: 'file' as const, label: 'Audio File', icon: FileAudio },
  ].filter(option => props.availableSources.includes(option.value));
  const ActionIcon = props.source === 'file'
    ? FileAudio
    : props.source === 'system'
      ? Volume2
      : props.source === 'mixed'
        ? AudioLines
        : Mic;

  const isCandidateStreaming = (cand: TranslationEngineCandidate) =>
    Boolean(
      cand.endpoint?.startsWith('ws://') ||
      cand.endpoint?.startsWith('wss://') ||
      cand.protocol?.startsWith('ws') ||
      cand.protocol === 't3po' ||
      cand.isSimultaneous
    );

  const hasStreamingEngine = props.translationCandidates.some(isCandidateStreaming);

  const visibleCandidates = props.realtimeTranslation
    ? props.translationCandidates.filter(isCandidateStreaming)
    : props.translationCandidates;

  return (
    <aside className="audio-setup-panel flex min-h-0 flex-col border-r border-border bg-surface/40">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <h1 className="text-base font-semibold text-text-main">Audio</h1>

        <fieldset disabled={props.isActive} className="space-y-2 disabled:opacity-60">
          <legend className="mb-2 text-xs font-medium text-text-sec">Input Source</legend>
          <div className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-surface p-1">
            {sourceOptions.map(option => {
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

        {props.source === 'microphone' || props.source === 'mixed' ? (
          <div>
            <label className="mb-1.5 block text-xs font-medium text-text-sec">Microphone Device</label>
            <FancySelect
              value={microphoneSelectionValue(props.microphoneSelection)}
              onChange={value => props.onMicrophoneSelectionChange(microphoneSelectionFromValue(value))}
              options={props.microphoneOptions.map(option => ({
                value: microphoneSelectionValue(option.selection),
                label: option.label,
              }))}
              onOpen={props.onRequestMicrophoneDevices}
              buttonClassName="h-9 text-xs"
              disabled={props.isActive}
            />
            {props.source === 'mixed' && (
              <p className="mt-1.5 text-[10px] leading-relaxed text-text-muted">
                Microphone and system audio are mixed into one recognition stream.
              </p>
            )}
          </div>
        ) : props.source === 'file' ? (
          <div>
            <label className="mb-1.5 block text-xs font-medium text-text-sec">Audio File</label>
            <label className="flex h-9 cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-surface px-3 text-xs text-text-muted hover:border-primary hover:text-text-main">
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
        ) : (
          <div className="rounded-lg border border-border bg-surface px-3 py-2 text-[11px] leading-relaxed text-text-muted">
            Captures audio played by this computer. You may be asked to choose a screen or display.
          </div>
        )}

        <div>
          <label className="mb-1.5 block text-xs font-medium text-text-sec">Recognition</label>
          <div className="grid grid-cols-2 gap-2">
            <FancySelect
              value={props.language}
              onChange={props.onLanguageChange}
              options={languageOptions}
              buttonClassName="h-9"
            />
            <FancySelect
              value={props.providerId}
              onChange={props.onProviderChange}
              options={props.providers.map(item => ({
                value: item.id,
                label: item.name,
              }))}
              placeholder="No speech provider"
              buttonClassName="h-9"
            />
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div className="min-w-0 pr-2">
            <span className="block text-xs font-medium text-text-main">Real-time Translation</span>
            {!hasStreamingEngine && (
              <span className="block text-[10px] font-medium leading-tight text-amber-400">
                No streaming translation engine (ws/wss) available
              </span>
            )}
          </div>
          <Toggle
            checked={props.realtimeTranslation && hasStreamingEngine}
            onChange={val => {
              if (hasStreamingEngine) {
                props.onRealtimeTranslationChange(val);
              }
            }}
            disabled={props.isActive || !hasStreamingEngine}
            label="Real-time Translation"
            size="small"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-text-sec">Translation</label>
          <div className="grid grid-cols-2 gap-2">
            <FancySelect
              value={props.targetLanguage}
              onChange={props.onTargetLanguageChange}
              options={targetLanguageOptions}
              buttonClassName="h-9"
              disabled={props.isActive}
            />
            <FancySelect
              value={props.translationEngineId}
              onChange={props.onTranslationEngineChange}
              options={[
                { value: '', label: 'None (Disabled)' },
                ...visibleCandidates.map(cand => ({
                  value: cand.id,
                  label: cand.label,
                  description: cand.description,
                })),
              ]}
              placeholder={props.realtimeTranslation ? 'Select streaming engine' : 'Select translation engine'}
              buttonClassName="h-9"
              disabled={props.isActive}
            />
          </div>
        </div>

        {isT3PO && (
          <div>
            <div className="mb-1.5 flex items-center gap-1.5">
              <label className="text-xs font-medium text-text-sec">Translation Latency</label>
              <InfoIcon title={latencyDescription} />
            </div>
            <div className="grid grid-cols-3 gap-1 rounded-lg border border-border bg-surface p-1">
              {latencyOptions.map(option => (
                <button
                  key={option.value}
                  type="button"
                  disabled={props.isActive}
                  onClick={() => props.onTranslationLatencyChange(option.value)}
                  className={`rounded px-2 py-1 text-center text-xs font-medium transition-colors ${
                    props.translationLatency === option.value
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-text-muted hover:bg-surface-light hover:text-text-main'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <details className="group rounded-lg border border-border bg-surface p-2.5">
          <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-medium text-text-sec outline-none [&::-webkit-details-marker]:hidden">
            <span>Translation Instructions</span>
            <ChevronDown size={14} className="text-text-muted transition-transform group-open:rotate-180" />
          </summary>
          <textarea
            value={props.translationInstructions}
            disabled={props.isActive}
            onChange={e => props.onTranslationInstructionsChange(e.target.value)}
            rows={4}
            placeholder="Optional custom translation constraints or prompt"
            className="mt-2 w-full resize-none rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-text-main placeholder:text-text-muted outline-none focus:border-primary disabled:opacity-60"
          />
        </details>

        <details className="group rounded-lg border border-border bg-surface p-2.5">
          <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-medium text-text-sec outline-none [&::-webkit-details-marker]:hidden">
            <span>Technical Terms</span>
            <ChevronDown size={14} className="text-text-muted transition-transform group-open:rotate-180" />
          </summary>
          <textarea
            value={props.technicalTerms}
            disabled={props.isActive}
            onChange={event => props.onTechnicalTermsChange(event.target.value)}
            rows={3}
            placeholder="One term per line"
            className="mt-2 w-full resize-none rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-text-main placeholder:text-text-muted outline-none focus:border-primary disabled:opacity-60"
          />
        </details>
      </div>

      <div className="shrink-0 border-t border-border p-4">
        {props.source === 'file' && props.isActive && (
          <div className="mb-3 space-y-1">
            <div className="flex justify-between text-[11px] text-text-muted">
              <span>{props.filePhase || 'Transcribing...'}</span>
              <span className="font-mono font-medium text-text-main">{Math.round(props.fileProgress * 100)}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-light">
              <div
                className="h-full bg-primary transition-all duration-200 ease-out"
                style={{ width: `${Math.round(props.fileProgress * 100)}%` }}
              />
            </div>
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
              <ActionIcon size={15} />
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
                {props.isFinalizing ? (
                  <>
                    <Loader2 size={14} className="animate-spin" /> Finalizing...
                  </>
                ) : (
                  <>
                    <Square size={14} /> Stop
                  </>
                )}
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
