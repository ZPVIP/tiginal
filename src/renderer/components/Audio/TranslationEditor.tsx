import { Check, Copy, Languages, LoaderCircle, Pencil, Trash2 } from 'lucide-react';

export interface TranslationEditorProps {
  committedText: string;
  editableText: string;
  editable: boolean;
  dirty: boolean;
  isRealtimeActive: boolean;
  status: 'idle' | 'deciding' | 'waiting' | 'translating' | 'completed' | 'failed';
  error?: string | null;
  unsupportedStreaming?: boolean;
  isTranslating: boolean;
  translateDisabled: boolean;
  translateTooltip: string;
  targetLanguage: string;
  onChange(value: string): void;
  onTranslate(): void;
  onCopy(): void;
  onClear(): void;
}

export function TranslationEditor({
  committedText,
  editableText,
  editable,
  dirty,
  isRealtimeActive,
  status,
  error,
  unsupportedStreaming,
  isTranslating,
  translateDisabled,
  translateTooltip,
  targetLanguage,
  onChange,
  onTranslate,
  onCopy,
  onClear,
}: TranslationEditorProps) {
  const displayText = editableText || committedText;
  const errorMessage = typeof error === 'string' ? error : (error ? JSON.stringify(error) : null);

  return (
    <section className="flex min-h-0 flex-col border-l border-border bg-background">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-text-main">Translation</h2>
          {unsupportedStreaming ? (
            <span className="rounded-md border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[11px] font-medium text-red-400">
              Streaming Unsupported
            </span>
          ) : (status === 'failed' || Boolean(errorMessage)) ? (
            <span
              className="rounded-md border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[11px] font-medium text-red-400"
              title={errorMessage || undefined}
            >
              Model Unavailable
            </span>
          ) : null}
          {isTranslating && <LoaderCircle size={14} className="animate-spin text-primary" />}
          {isRealtimeActive && status === 'waiting' && (
            <span className="flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-mono font-medium text-amber-400">
              WAIT
            </span>
          )}
          {isRealtimeActive && status === 'deciding' && (
            <span className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
              Thinking
            </span>
          )}
          {isRealtimeActive && status === 'translating' && (
            <span className="flex items-center gap-1 rounded-full bg-accent-success/10 px-2 py-0.5 text-[10px] font-mono font-medium text-accent-success">
              TRANS
            </span>
          )}
          {editable && !isRealtimeActive && displayText && (
            <span className="flex items-center gap-1 rounded-full bg-accent-success/10 px-2 py-0.5 text-[10px] text-accent-success">
              {dirty ? <Pencil size={10} /> : <Check size={10} />}
              {dirty ? 'Edited' : 'Complete'}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            title={translateTooltip}
            disabled={translateDisabled}
            onClick={onTranslate}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-sm transition-all hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-surface-light disabled:text-text-muted disabled:opacity-50 disabled:shadow-none"
          >
            {isTranslating ? (
              <LoaderCircle size={13} className="animate-spin text-current" />
            ) : (
              <Languages size={13} />
            )}
            <span>{isTranslating ? 'Translating...' : displayText ? 'Re-translate' : 'Translate'}</span>
          </button>
          <button
            type="button"
            title="Copy translation"
            disabled={!displayText}
            onClick={onCopy}
            className="rounded-md p-1.5 text-text-muted hover:bg-surface-light hover:text-text-main disabled:opacity-30"
          >
            <Copy size={14} />
          </button>
          <button
            type="button"
            title="Clear translation"
            disabled={isRealtimeActive || isTranslating || !displayText}
            onClick={onClear}
            className="rounded-md p-1.5 text-text-muted hover:bg-red-400/10 hover:text-red-400 disabled:opacity-30"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col p-4">
        {errorMessage && (
          <div className="mb-3 rounded-lg border border-accent-danger/30 bg-accent-danger/10 px-3 py-2 text-xs text-accent-danger break-words">
            {errorMessage}
          </div>
        )}

        {unsupportedStreaming ? (
          <div className="flex h-full min-h-48 items-center justify-center rounded-xl border border-red-500/20 bg-red-500/5 p-6 text-center">
            <div className="max-w-sm">
              <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-red-500/10 text-red-400">
                <Languages size={20} />
              </span>
              <h3 className="mt-3 text-sm font-medium text-red-400">
                Model does not support streaming
              </h3>
              <p className="mt-1.5 text-xs leading-5 text-text-muted">
                The selected engine endpoint protocol is not WebSocket (ws/wss) and cannot perform real-time streaming translation. Stop dictation to translate using the Translate button above, or switch to a streaming-capable model.
              </p>
            </div>
          </div>
        ) : isRealtimeActive ? (
          <div className="h-full min-h-48 overflow-y-auto rounded-xl border border-border bg-surface/40 p-4 text-sm leading-6 text-text-main">
            {committedText ? (
              <span>{committedText}</span>
            ) : (
              <span className="text-text-muted">
                {status === 'waiting'
                  ? 'Waiting for context to produce translation (WAIT)...'
                  : 'Listening for speech to translate in real-time...'}
              </span>
            )}
          </div>
        ) : (
          <textarea
            value={displayText}
            onChange={event => onChange(event.target.value)}
            aria-label="Editable translation"
            placeholder="Translation will appear here. Click Translate to translate the transcript."
            className="h-full min-h-48 w-full resize-none rounded-xl border border-border bg-surface/60 p-4 text-sm leading-6 text-text-main placeholder:text-text-muted focus:border-primary"
          />
        )}
      </div>
    </section>
  );
}
