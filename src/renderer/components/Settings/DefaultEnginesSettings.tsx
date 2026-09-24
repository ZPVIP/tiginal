import { useCallback, useEffect, useState } from 'react';
import { AudioLines, Bot, SlidersHorizontal, Volume2 } from 'lucide-react';
import type {
  DefaultEngineKind,
  DefaultEngineSelection,
} from '../../../shared/models/types';
import { SettingsPageHeader } from './SettingsPageHeader';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const descriptions: Record<DefaultEngineKind, { title: string; description: string }> = {
  'language-model': {
    title: 'Language model',
    description: 'Used for text generation and translation when a feature does not select another model.',
  },
  'speech-recognition': {
    title: 'Speech recognition',
    description: 'Remote and local targets that can convert speech to text.',
  },
  'speech-synthesis': {
    title: 'Speech synthesis',
    description: 'Targets that can generate speech audio.',
  },
};

function iconFor(kind: DefaultEngineKind) {
  if (kind === 'language-model') return <Bot size={18} />;
  if (kind === 'speech-recognition') return <AudioLines size={18} />;
  return <Volume2 size={18} />;
}

export function DefaultEnginesSettings() {
  const [selections, setSelections] = useState<DefaultEngineSelection[]>([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const api = window.electron?.models;
    if (!api) return;
    try {
      setSelections(await api.listDefaultEngineSelections());
      setError('');
    } catch (loadError) {
      setError(errorMessage(loadError));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const update = async (kind: DefaultEngineKind, targetId: string | null) => {
    const api = window.electron?.models;
    if (!api) return;
    try {
      await api.setDefaultEngine(kind, targetId);
      setSelections(current => current.map(selection => (
        selection.kind === kind ? { ...selection, targetId } : selection
      )));
    } catch (updateError) {
      setError(errorMessage(updateError));
    }
  };

  return (
    <div className="space-y-5 animate-in fade-in duration-300">
      <SettingsPageHeader icon={<SlidersHorizontal size={24} />} title="Default Engines" />
      <p className="text-xs text-text-muted">Defaults use stable target IDs. Renaming a provider or local service does not break the selection.</p>
      {error && <div className="rounded-lg border border-accent-danger/30 bg-accent-danger/10 px-3 py-2 text-xs text-accent-danger">{error}</div>}

      <div className="grid gap-3">
        {selections.map(selection => {
          const copy = descriptions[selection.kind];
          return (
            <section key={selection.kind} className="rounded-lg border border-border bg-surface p-4">
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  {iconFor(selection.kind)}
                </span>
                <div className="min-w-0 flex-1 space-y-2">
                  <div>
                    <h3 className="text-sm font-semibold text-text-main">{copy.title}</h3>
                    <p className="text-[11px] text-text-muted">{copy.description}</p>
                  </div>
                  {selection.candidates.length > 0 ? (
                    <select
                      className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm text-text-main outline-none focus:border-primary"
                      value={selection.targetId ?? ''}
                      onChange={event => void update(selection.kind, event.target.value || null)}
                    >
                      <option value="">No default</option>
                      {selection.candidates.map(candidate => (
                        <option key={candidate.id} value={candidate.id}>{candidate.label} · {candidate.source}</option>
                      ))}
                    </select>
                  ) : (
                    <div className="rounded-lg border border-dashed border-border px-3 py-3 text-xs text-text-muted">
                      No compatible engine or model detected. Check Model Engines and download a compatible model.
                    </div>
                  )}
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
