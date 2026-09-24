import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Copy,
  Loader2,
  Play,
  RefreshCw,
  Server,
  Square,
  TerminalSquare,
  Trash2,
} from 'lucide-react';
import type {
  DownloadedModel,
  EngineParameterDefinition,
  EngineParameters,
  EngineParameterValue,
  ModelEngineId,
  ModelEngineView,
  ModelInstance,
  StartModelInput,
} from '../../../shared/models/types';
import { SettingsPageHeader } from './SettingsPageHeader';

const fieldClass = 'h-9 w-full rounded-lg border border-border bg-background px-3 text-sm text-text-main outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-50';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function defaultParameters(engine: ModelEngineView | undefined): EngineParameters {
  if (!engine) return {};
  return Object.fromEntries(engine.parameters.map(parameter => [parameter.key, parameter.defaultValue]));
}

function parseEngineId(value: string, engines: readonly ModelEngineView[]): ModelEngineId | null {
  return engines.find(engine => engine.id === value)?.id ?? null;
}

function ParameterField({
  definition,
  value,
  onChange,
}: {
  definition: EngineParameterDefinition;
  value: EngineParameterValue | undefined;
  onChange(value: EngineParameterValue): void;
}) {
  if (definition.kind === 'boolean') {
    return (
      <div className="space-y-1">
        <span className="text-[11px] text-text-muted">{definition.label}</span>
        <label className="flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-xs text-text-muted">
          <input type="checkbox" checked={value === true} onChange={event => onChange(event.target.checked)} />
          {definition.label}
        </label>
      </div>
    );
  }
  if (definition.kind === 'select') {
    return (
      <label className="space-y-1">
        <span className="text-[11px] text-text-muted">{definition.label}</span>
        <select className={fieldClass} value={typeof value === 'string' ? value : definition.defaultValue} onChange={event => onChange(event.target.value)}>
          {definition.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
    );
  }
  if (definition.kind === 'text') {
    return (
      <label className="space-y-1">
        <span className="text-[11px] text-text-muted">{definition.label}</span>
        <input
          className={fieldClass}
          value={typeof value === 'string' ? value : definition.defaultValue}
          placeholder={definition.placeholder}
          onChange={event => onChange(event.target.value)}
        />
      </label>
    );
  }
  const currentValue = typeof value === 'number' ? value : value === null ? '' : definition.defaultValue ?? '';
  return (
    <label className="space-y-1">
      <span className="text-[11px] text-text-muted">{definition.label}</span>
      <input
        className={fieldClass}
        type="number"
        min={definition.min}
        max={definition.max}
        step={definition.kind === 'number' ? definition.step : 1}
        value={currentValue}
        placeholder={definition.kind === 'optional-integer' ? definition.placeholder : undefined}
        onChange={event => {
          if (!event.target.value && definition.kind === 'optional-integer') onChange(null);
          else onChange(Number(event.target.value));
        }}
      />
    </label>
  );
}

interface ModelLaunchRowProps {
  instance?: ModelInstance;
  engine: ModelEngineView;
  models: readonly DownloadedModel[];
  parameters: EngineParameters;
  busy: boolean;
  onStart(input: StartModelInput, instanceId?: string): Promise<void>;
  onStop(id: string): Promise<void>;
  onDelete(id: string): Promise<void>;
}

function ModelLaunchRow({
  instance,
  engine,
  models,
  parameters,
  busy,
  onStart,
  onStop,
  onDelete,
}: ModelLaunchRowProps) {
  const [modelPath, setModelPath] = useState(instance?.modelPath ?? '');
  const [displayName, setDisplayName] = useState(instance?.displayName ?? '');
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);

  useEffect(() => {
    if (!consoleOpen || !instance) return;
    const refreshLogs = () => void window.electron?.models.getModelLogs(instance.id).then(setLogs);
    refreshLogs();
    const timer = window.setInterval(refreshLogs, 1000);
    return () => window.clearInterval(timer);
  }, [consoleOpen, instance]);

  const running = instance?.status === 'running' || instance?.status === 'starting';
  const stopping = instance?.status === 'stopping';
  const locked = running || stopping;
  const selectedModel = models.find(model => model.path === modelPath);
  const commandLine = instance?.commandLine;

  const copyCommand = async () => {
    if (!commandLine) return;
    await navigator.clipboard.writeText(commandLine);
  };

  return (
    <div className="border-b border-border px-3 py-3 last:border-b-0">
      {instance && (
        <div className="mb-2 flex items-center gap-2 text-[11px] text-text-muted">
          <span>Model Engine: <span className="text-text-main">{engine.name}</span></span>
          <button
            type="button"
            disabled={!commandLine}
            title={commandLine || 'Command line will be available after the first start.'}
            onClick={() => void copyCommand()}
            className="rounded p-1 text-text-muted hover:bg-surface-light hover:text-text-main disabled:opacity-40"
          >
            <Copy size={12} />
          </button>
        </div>
      )}
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(150px,0.65fr)_repeat(4,36px)] items-end gap-2">
        <label className="space-y-1">
          <span className="text-[11px] text-text-muted">Model</span>
          <select
            className={fieldClass}
            value={modelPath}
            disabled={locked}
            title={locked ? modelPath : undefined}
            onChange={event => {
              const nextPath = event.target.value;
              setModelPath(nextPath);
              const model = models.find(candidate => candidate.path === nextPath);
              if (model) setDisplayName(model.name);
            }}
          >
            <option value="">Select a downloaded model...</option>
            {instance && !selectedModel && <option value={modelPath}>{instance.displayName}</option>}
            {models.map(model => <option key={model.id} value={model.path}>{model.name} · {model.format}</option>)}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-[11px] text-text-muted">Local service name</span>
          <input
            className={fieldClass}
            value={displayName}
            disabled={locked}
            title={locked ? displayName : undefined}
            placeholder={selectedModel?.name ?? 'Service name'}
            onChange={event => setDisplayName(event.target.value)}
          />
        </label>
        <button
          type="button"
          disabled={busy || stopping || !modelPath || !displayName.trim() || engine.status.kind !== 'available'}
          onClick={() => void onStart({ engineId: engine.id, modelPath, displayName, parameters }, instance?.id)}
          title={running ? 'Restart service' : 'Start service'}
          className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy
            ? <Loader2 size={13} className="animate-spin" />
            : running
              ? <RefreshCw size={13} />
              : <Play size={13} />}
        </button>
        <button
          type="button"
          disabled={!instance || !running || busy}
          onClick={() => instance && void onStop(instance.id)}
          title="Stop service"
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-text-main hover:bg-surface-light disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Square size={12} />
        </button>
        <button
          type="button"
          disabled={!instance}
          onClick={() => setConsoleOpen(current => !current)}
          title={consoleOpen ? 'Close console' : 'Open console'}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-text-main hover:bg-surface-light disabled:cursor-not-allowed disabled:opacity-40"
        >
          <TerminalSquare size={13} />
        </button>
        <button
          type="button"
          disabled={!instance || running || stopping || busy}
          onClick={() => instance && void onDelete(instance.id)}
          title="Delete local model service"
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-text-muted hover:bg-red-400/10 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Trash2 size={13} />
        </button>
      </div>
      {instance && (
        <div className="mt-2 flex items-center gap-3 text-[11px] text-text-muted">
          <span className={instance.status === 'running' ? 'text-accent-success' : instance.status === 'error' ? 'text-accent-danger' : ''}>{instance.status}</span>
          {instance.pid !== null && <span>PID {instance.pid}</span>}
          {instance.endpoint && <code>{instance.endpoint}</code>}
          {instance.error && <span className="text-accent-danger">{instance.error}</span>}
        </div>
      )}
      {consoleOpen && (
        <pre className="mt-3 h-60 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-background p-3 font-mono text-[11px] leading-4 text-text-muted">
          {logs.length > 0 ? logs.join('\n') : 'No console output.'}
        </pre>
      )}
    </div>
  );
}

export function RunModelsSettings() {
  const [engines, setEngines] = useState<ModelEngineView[]>([]);
  const [models, setModels] = useState<DownloadedModel[]>([]);
  const [instances, setInstances] = useState<ModelInstance[]>([]);
  const [selectedEngineId, setSelectedEngineId] = useState<ModelEngineId | null>(null);
  const [parameters, setParameters] = useState<EngineParameters>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [draftKey, setDraftKey] = useState(0);

  const load = useCallback(async (refreshEngines: boolean) => {
    const api = window.electron?.models;
    if (!api) return;
    setLoading(true);
    setError('');
    try {
      const [engineResult, downloaded, running] = await Promise.all([
        refreshEngines ? api.refreshEngines() : api.listEngines(),
        api.scanDownloadedModels(),
        api.listModelInstances(),
      ]);
      setEngines(engineResult.engines);
      setModels(downloaded.filter(model => model.complete));
      setInstances(running);
      setSelectedEngineId(current => current ?? engineResult.engines[0]?.id ?? null);
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  useEffect(() => {
    if (!selectedEngineId) return;
    setParameters(defaultParameters(engines.find(engine => engine.id === selectedEngineId)));
  }, [engines, selectedEngineId]);

  useEffect(() => {
    if (!instances.some(instance => instance.status === 'starting' || instance.status === 'running' || instance.status === 'stopping')) return;
    const timer = window.setInterval(() => {
      void window.electron?.models.listModelInstances().then(setInstances);
    }, 1200);
    return () => window.clearInterval(timer);
  }, [instances]);

  const selectedEngine = engines.find(engine => engine.id === selectedEngineId);
  const compatibleModels = useMemo(() => (
    selectedEngineId
      ? models.filter(model => model.compatibleEngineIds.includes(selectedEngineId))
      : []
  ), [models, selectedEngineId]);
  const start = async (input: StartModelInput, instanceId?: string) => {
    const api = window.electron?.models;
    if (!api) return;
    const operationId = instanceId ?? 'draft';
    setBusyId(operationId);
    setError('');
    try {
      if (instanceId) await api.restartModel(instanceId, input);
      else await api.startModel(input);
      setInstances(await api.listModelInstances());
      if (!instanceId) setDraftKey(current => current + 1);
    } catch (startError) {
      setError(errorMessage(startError));
    } finally {
      setBusyId(null);
    }
  };

  const stop = async (id: string) => {
    const api = window.electron?.models;
    if (!api) return;
    setBusyId(id);
    setError('');
    try {
      await api.stopModel(id);
      setInstances(await api.listModelInstances());
    } catch (stopError) {
      setError(errorMessage(stopError));
    } finally {
      setBusyId(null);
    }
  };

  const deleteService = async (id: string) => {
    const api = window.electron?.models;
    if (!api) return;
    const instance = instances.find(candidate => candidate.id === id);
    if (!instance || !window.confirm(`Delete local model service "${instance.displayName}"?`)) return;
    setBusyId(id);
    setError('');
    try {
      await api.deleteModelService(id);
      setInstances(await api.listModelInstances());
    } catch (deleteError) {
      setError(errorMessage(deleteError));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-5 animate-in fade-in duration-300">
      <SettingsPageHeader
        icon={<Server size={24} />}
        title="Run Models"
        actions={(
          <button type="button" disabled={loading} onClick={() => void load(true)} className="flex h-8 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm text-text-main hover:bg-surface-light disabled:opacity-50">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        )}
      />
      {error && <div className="rounded-lg border border-accent-danger/30 bg-accent-danger/10 px-3 py-2 text-xs text-accent-danger">{error}</div>}

      <section className="space-y-3 rounded-lg border border-border bg-surface p-4">
        <label className="block space-y-2">
          <span className="text-sm font-semibold text-text-main">Model engine</span>
          <select
            className={fieldClass}
            value={selectedEngineId ?? ''}
            onChange={event => setSelectedEngineId(parseEngineId(event.target.value, engines))}
          >
            {engines.map(engine => (
              <option key={engine.id} value={engine.id}>{engine.name} · {engine.status.kind}</option>
            ))}
          </select>
        </label>
        {selectedEngine && selectedEngine.status.kind !== 'available' && (
          <p className="text-xs text-amber-500">This engine is not available. Open Model Engines for detection details and installation instructions.</p>
        )}
      </section>

      {selectedEngine && (
        <section className="space-y-3 rounded-lg border border-border bg-surface p-4">
          <div>
            <h3 className="text-sm font-semibold text-text-main">Engine parameters</h3>
            <p className="text-[11px] text-text-muted">These values apply when a model starts or restarts.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {selectedEngine.parameters.map(definition => (
              <ParameterField
                key={definition.key}
                definition={definition}
                value={parameters[definition.key]}
                onChange={value => setParameters(current => ({ ...current, [definition.key]: value }))}
              />
            ))}
          </div>
        </section>
      )}

      {selectedEngine && (
        <section className="overflow-hidden rounded-lg border border-border bg-surface">
          <div className="border-b border-border px-4 py-3">
            <h3 className="text-sm font-semibold text-text-main">Local model services</h3>
            <p className="text-[11px] text-text-muted">Starting a model adds another empty launch row automatically.</p>
          </div>
          {instances.map(instance => {
            const instanceEngine = engines.find(engine => engine.id === instance.engineId);
            if (!instanceEngine) return null;
            const instanceModels = models.filter(model => model.compatibleEngineIds.includes(instance.engineId));
            return (
              <ModelLaunchRow
                key={instance.id}
                instance={instance}
                engine={instanceEngine}
                models={instanceModels}
                parameters={instance.parameters}
                busy={busyId === instance.id}
                onStart={start}
                onStop={stop}
                onDelete={deleteService}
              />
            );
          })}
          <ModelLaunchRow
            key={`draft-${draftKey}`}
            engine={selectedEngine}
            models={compatibleModels}
            parameters={parameters}
            busy={busyId === 'draft'}
            onStart={start}
            onStop={stop}
            onDelete={deleteService}
          />
          {compatibleModels.length === 0 && (
            <p className="border-t border-border px-4 py-3 text-xs text-text-muted">No downloaded model is compatible with {selectedEngine.name}.</p>
          )}
        </section>
      )}
    </div>
  );
}
