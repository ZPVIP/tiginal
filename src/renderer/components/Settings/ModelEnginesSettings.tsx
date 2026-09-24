import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Cpu,
  RefreshCw,
  TerminalSquare,
  Wrench,
} from 'lucide-react';
import type {
  EngineProbeStatus,
  ModelEngineView,
  SystemToolView,
} from '../../../shared/models/types';
import { SettingsPageHeader } from './SettingsPageHeader';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function statusLabel(status: EngineProbeStatus): string {
  if (status.kind === 'available') return 'Available';
  if (status.kind === 'missing') return 'Missing';
  if (status.kind === 'unsupported') return 'Unsupported';
  return 'Misconfigured';
}

function StatusBadge({ status }: { status: EngineProbeStatus }) {
  const available = status.kind === 'available';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${available ? 'bg-accent-success/15 text-accent-success' : 'bg-surface-light text-text-muted'}`}>
      {available ? <CheckCircle2 size={11} /> : <AlertCircle size={11} />}
      {statusLabel(status)}
    </span>
  );
}

function EngineRow({ engine }: { engine: ModelEngineView }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-3 last:border-b-0">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm font-medium text-text-main">{engine.name}</span>
          <StatusBadge status={engine.status} />
          {engine.runningInstances > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-500">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              {engine.runningInstances} running
            </span>
          )}
        </div>
        <p className="text-xs text-text-muted">{engine.description}</p>
        <div className="flex flex-wrap gap-1 pt-1">
          {engine.capabilities.map(capability => (
            <span key={capability} className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
              {capability}
            </span>
          ))}
        </div>
        {engine.status.kind === 'available' ? (
          <div className="space-y-0.5 pt-1 text-[11px] text-text-muted">
            <p className="break-all"><span className="text-text-sec">Path:</span> {engine.status.executablePath}</p>
            {engine.status.version && <p><span className="text-text-sec">Version:</span> {engine.status.version}</p>}
            {engine.status.detail && <p>{engine.status.detail}</p>}
          </div>
        ) : (
          <div className="space-y-1 pt-1 text-[11px] text-text-muted">
            <p>{engine.status.reason}</p>
            {engine.installHints.map(hint => (
              <code key={hint} className="block w-fit rounded bg-background px-2 py-1 text-text-sec">{hint}</code>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ToolRow({ tool }: { tool: SystemToolView }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-3 last:border-b-0">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-medium text-text-main">{tool.name}</span>
          <StatusBadge status={tool.status} />
        </div>
        <p className="text-xs text-text-muted">{tool.description}</p>
        {tool.status.kind === 'available' ? (
          <div className="space-y-0.5 text-[11px] text-text-muted">
            <p className="break-all">{tool.status.executablePath}</p>
            {tool.status.version && <p>{tool.status.version}</p>}
            {tool.status.detail && <p>{tool.status.detail}</p>}
          </div>
        ) : (
          <div className="space-y-1 text-[11px] text-text-muted">
            <p>{tool.status.reason}</p>
            {tool.installHints.map(hint => (
              <code key={hint} className="block w-fit rounded bg-background px-2 py-1 text-text-sec">{hint}</code>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function ModelEnginesSettings() {
  const [engines, setEngines] = useState<ModelEngineView[]>([]);
  const [systemTools, setSystemTools] = useState<SystemToolView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (refresh: boolean) => {
    const api = window.electron?.models;
    if (!api) return;
    setLoading(true);
    setError('');
    try {
      const result = refresh ? await api.refreshEngines() : await api.listEngines();
      setEngines(result.engines);
      setSystemTools(result.systemTools);
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  const textEngines = engines.filter(engine => engine.categories.includes('text-inference'));
  const speechEngines = engines.filter(engine => engine.categories.includes('speech'));

  return (
    <div className="space-y-5 animate-in fade-in duration-300">
      <SettingsPageHeader
        icon={<Cpu size={24} />}
        title="Model Engines"
        actions={(
          <button
            type="button"
            disabled={loading}
            onClick={() => void load(true)}
            className="flex h-8 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm text-text-main hover:bg-surface-light disabled:opacity-50"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        )}
      />
      <p className="text-xs leading-5 text-text-muted">
        Tiginal detects model runtimes already installed on this system. It does not install or modify them.
      </p>

      {error && <div className="rounded-lg border border-accent-danger/30 bg-accent-danger/10 px-3 py-2 text-xs text-accent-danger">{error}</div>}

      <section className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <TerminalSquare size={16} className="text-primary" />
          <div>
            <h3 className="text-sm font-semibold text-text-main">Text inference</h3>
            <p className="text-[11px] text-text-muted">Local runtimes for language models and translation.</p>
          </div>
        </div>
        {textEngines.length > 0
          ? textEngines.map(engine => <EngineRow key={engine.id} engine={engine} />)
          : <p className="px-4 py-5 text-xs text-text-muted">{loading ? 'Detecting engines...' : 'No text inference engine supports this platform.'}</p>}
      </section>

      <section className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Cpu size={16} className="text-primary" />
          <div>
            <h3 className="text-sm font-semibold text-text-main">Speech</h3>
            <p className="text-[11px] text-text-muted">Speech recognition and synthesis runtimes available on this platform.</p>
          </div>
        </div>
        {speechEngines.length > 0
          ? speechEngines.map(engine => <EngineRow key={engine.id} engine={engine} />)
          : <p className="px-4 py-5 text-xs text-text-muted">{loading ? 'Detecting engines...' : 'No speech engine supports this platform.'}</p>}
      </section>

      <section className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Wrench size={16} className="text-primary" />
          <div>
            <h3 className="text-sm font-semibold text-text-main">System tools</h3>
            <p className="text-[11px] text-text-muted">Audio conversion and media inspection tools.</p>
          </div>
        </div>
        {systemTools.length > 0
          ? systemTools.map(tool => <ToolRow key={tool.id} tool={tool} />)
          : <p className="px-4 py-5 text-xs text-text-muted">{loading ? 'Detecting tools...' : 'No system tools were detected.'}</p>}
      </section>
    </div>
  );
}
