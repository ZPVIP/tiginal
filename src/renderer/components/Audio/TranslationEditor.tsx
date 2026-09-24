import { Languages } from 'lucide-react';
import { Toggle } from '../ui/Toggle';

interface TranslationEditorProps {
  transcriptReady: boolean;
}

export function TranslationEditor({ transcriptReady }: TranslationEditorProps) {
  return (
    <section className="flex min-h-0 flex-col border-l border-border bg-background">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
        <h2 className="text-sm font-semibold text-text-main">Translation</h2>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-text-muted">Real-time Translation</span>
          <Toggle checked={false} onChange={() => undefined} disabled label="Real-time Translation" size="small" />
        </div>
      </header>
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <div className="max-w-xs text-center">
          <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Languages size={20} />
          </span>
          <h3 className="mt-3 text-sm font-medium text-text-main">
            {transcriptReady ? 'Transcript ready for translation' : 'Translation waits for a transcript'}
          </h3>
          <p className="mt-1.5 text-xs leading-5 text-text-muted">
            Translation controls are not available in this build.
          </p>
        </div>
      </div>
    </section>
  );
}
