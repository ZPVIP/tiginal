import { Check, Copy, LoaderCircle, Pencil, Trash2 } from 'lucide-react';

interface TranscriptEditorProps {
  committedText: string;
  partialText: string;
  editableText: string;
  editable: boolean;
  dirty: boolean;
  busy: boolean;
  onChange(value: string): void;
  onCopy(): void;
  onClear(): void;
}

export function TranscriptEditor(props: TranscriptEditorProps) {
  const streamingText = `${props.committedText}${props.partialText}`;

  return (
    <section className="flex min-h-0 flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-text-main">Transcript</h2>
          {props.busy && <LoaderCircle size={14} className="animate-spin text-primary" />}
          {props.editable && (
            <span className="flex items-center gap-1 rounded-full bg-accent-success/10 px-2 py-0.5 text-[10px] text-accent-success">
              {props.dirty ? <Pencil size={10} /> : <Check size={10} />}
              {props.dirty ? 'Edited' : 'Editable'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            title="Copy transcript"
            disabled={!(props.editable ? props.editableText : streamingText)}
            onClick={props.onCopy}
            className="rounded-md p-1.5 text-text-muted hover:bg-surface-light hover:text-text-main disabled:opacity-30"
          >
            <Copy size={14} />
          </button>
          <button
            type="button"
            title="Clear transcript"
            disabled={props.busy || !(props.editableText || streamingText)}
            onClick={props.onClear}
            className="rounded-md p-1.5 text-text-muted hover:bg-red-400/10 hover:text-red-400 disabled:opacity-30"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 p-4">
        {props.editable ? (
          <textarea
            value={props.editableText}
            onChange={event => props.onChange(event.target.value)}
            aria-label="Editable transcript"
            placeholder="The completed transcript will appear here."
            className="h-full min-h-48 w-full resize-none rounded-xl border border-border bg-surface/60 p-4 text-sm leading-6 text-text-main placeholder:text-text-muted focus:border-primary"
          />
        ) : (
          <div className="h-full min-h-48 overflow-y-auto rounded-xl border border-border bg-surface/40 p-4 text-sm leading-6 text-text-main">
            {props.committedText}
            {props.partialText && <span className="text-text-muted">{props.partialText}</span>}
            {!streamingText && (
              <span className="text-text-muted">
                {props.busy ? 'Waiting for speech...' : 'Start a microphone session or transcribe an audio file.'}
              </span>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
