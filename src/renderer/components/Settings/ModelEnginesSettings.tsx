import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Cpu,
  FolderOpen,
  Info,
  RefreshCw,
  Sparkles,
  TerminalSquare,
  Wrench,
} from 'lucide-react';
import type {
  EngineProbeStatus,
  ModelEngineView,
  SystemToolView,
} from '../../../shared/models/types';
import { SettingsPageHeader } from './SettingsPageHeader';

interface DiscoveredModel {
  path: string;
  name: string;
  sizeBytes: number;
  kind: 'nemotron' | 'mms-align' | 'whisper';
  isRecommended: boolean;
  label: string;
}

interface DiscoveredDiarizeModels {
  nemotron: DiscoveredModel[];
  mmsAlign: DiscoveredModel[];
  whisper: DiscoveredModel[];
}

const selectClass = 'h-8 w-full rounded border border-border bg-background px-2.5 text-xs text-text-main outline-none focus:border-primary';

function TiginalDiarizeConfigPanel() {
  const [models, setModels] = useState<DiscoveredDiarizeModels>({ nemotron: [], mmsAlign: [], whisper: [] });
  const [customDir, setCustomDir] = useState<string>('');
  const [nemotronModel, setNemotronModel] = useState<string>('');
  const [alignModel, setAlignModel] = useState<string>('');
  const [whisperModel, setWhisperModel] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const scan = useCallback(async (dirOverride?: string) => {
    setLoading(true);
    try {
      const electron = window.electron;
      if (!electron) return;
      const [savedDir, savedNemotron, savedAlign, savedWhisper] = await Promise.all([
        electron.invoke('settings:get', 'tiginal_diarize_custom_dir'),
        electron.invoke('settings:get', 'tiginal_diarize_nemotron_model'),
        electron.invoke('settings:get', 'tiginal_diarize_align_model'),
        electron.invoke('settings:get', 'tiginal_diarize_whisper_model'),
      ]);
      const activeDir = dirOverride ?? (savedDir || '');
      setCustomDir(activeDir);
      setNemotronModel(savedNemotron || '');
      setAlignModel(savedAlign || '');
      setWhisperModel(savedWhisper || '');

      const discovered: DiscoveredDiarizeModels = await electron.invoke('models:scan-diarize-models', activeDir || undefined);
      setModels(discovered);
    } catch (err) {
      console.error('Failed to scan diarize models:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void scan();
  }, [scan]);

  const setSetting = async (key: string, value: string) => {
    await window.electron?.invoke('settings:set', key, value);
  };

  const handleBrowseDir = async () => {
    const selected = await window.electron?.invoke('dialog:open-directory', customDir || undefined);
    if (selected) {
      setCustomDir(selected);
      await setSetting('tiginal_diarize_custom_dir', selected);
      void scan(selected);
    }
  };

  const handleBrowseFile = async (kind: 'nemotron' | 'mms-align' | 'whisper') => {
    const extensions = kind === 'whisper' ? ['bin'] : ['onnx'];
    const selected = await window.electron?.invoke('dialog:open-file', {
      defaultPath: customDir || undefined,
      extensions,
    });
    if (selected) {
      if (kind === 'nemotron') {
        setNemotronModel(selected);
        await setSetting('tiginal_diarize_nemotron_model', selected);
      } else if (kind === 'mms-align') {
        setAlignModel(selected);
        await setSetting('tiginal_diarize_align_model', selected);
      } else {
        setWhisperModel(selected);
        await setSetting('tiginal_diarize_whisper_model', selected);
      }
      void scan();
    }
  };

  const handleSelectModel = async (kind: 'nemotron' | 'mms-align' | 'whisper', value: string) => {
    if (kind === 'nemotron') {
      setNemotronModel(value);
      await setSetting('tiginal_diarize_nemotron_model', value);
    } else if (kind === 'mms-align') {
      setAlignModel(value);
      await setSetting('tiginal_diarize_align_model', value);
    } else {
      setWhisperModel(value);
      await setSetting('tiginal_diarize_whisper_model', value);
    }
  };

  const activeNemotron = nemotronModel || models.nemotron[0]?.path || '';
  const activeAlign = alignModel || models.mmsAlign[0]?.path || '';
  const activeWhisper = whisperModel || models.whisper[0]?.path || '';

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-border/80 bg-background/40 p-3.5 text-text-main">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2.5">
        <div className="space-y-0.5">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-text-main">
            <Sparkles size={14} className="text-primary" />
            Model Path & Precision Selection
          </div>
          <p className="text-[11px] text-text-muted">
            Auto-detects models from <code className="rounded bg-surface px-1 py-0.5 text-text-sec">~/.cache/tiginal/models</code> (including commit-hash subdirectories) or a custom folder.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleBrowseDir()}
            className="flex h-7 items-center gap-1.5 rounded border border-border bg-surface px-2.5 text-xs text-text-main hover:bg-surface-light"
          >
            <FolderOpen size={12} />
            {customDir ? 'Change Folder...' : 'Set Search Folder...'}
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => void scan()}
            className="flex h-7 items-center gap-1.5 rounded border border-border bg-surface px-2.5 text-xs text-text-main hover:bg-surface-light disabled:opacity-50"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            Rescan
          </button>
        </div>
      </div>

      {customDir && (
        <div className="text-[11px] text-text-muted">
          <span className="text-text-sec font-medium">Custom Folder:</span> <code className="rounded bg-surface px-1 py-0.5">{customDir}</code>
        </div>
      )}

      {/* 1. NVIDIA Nemotron-3 */}
      <div className="rounded-lg border border-border/60 bg-surface/40 p-2.5 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-text-main">1. NVIDIA Nemotron-3 (Speaker Diarization)</span>
            {models.nemotron.length > 0 ? (
              <span className="rounded bg-accent-success/15 px-1.5 py-0.5 text-[10px] font-medium text-accent-success">
                {models.nemotron.length} found
              </span>
            ) : (
              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-500">
                Not found
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => void handleBrowseFile('nemotron')}
            className="flex items-center gap-1 text-[11px] text-primary hover:underline"
          >
            <FolderOpen size={12} /> Browse File...
          </button>
        </div>
        <p className="text-[11px] text-text-muted">
          Speaker acoustic embedding & clustering engine. Recommended: <code className="text-text-sec">model_quantized.onnx</code>.
        </p>
        <div className="flex gap-2">
          <select
            className={selectClass}
            value={nemotronModel}
            onChange={e => void handleSelectModel('nemotron', e.target.value)}
          >
            <option value="">Auto Select (Priority: model_quantized.onnx)</option>
            {nemotronModel && !models.nemotron.some(m => m.path === nemotronModel) && (
              <option value={nemotronModel}>Custom: {nemotronModel}</option>
            )}
            {models.nemotron.map(m => (
              <option key={m.path} value={m.path}>{m.label}</option>
            ))}
          </select>
        </div>
        {activeNemotron && (
          <p className="truncate text-[10px] text-text-muted font-mono">
            <span className="text-text-sec">Using:</span> {activeNemotron}
          </p>
        )}
      </div>

      {/* 2. MMS-Align */}
      <div className="rounded-lg border border-border/60 bg-surface/40 p-2.5 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-text-main">2. Meta MMS-Align / Wav2Vec2 CTC (Forced Alignment)</span>
            {models.mmsAlign.length > 0 ? (
              <span className="rounded bg-accent-success/15 px-1.5 py-0.5 text-[10px] font-medium text-accent-success">
                {models.mmsAlign.length} found
              </span>
            ) : (
              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-500">
                Not found
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => void handleBrowseFile('mms-align')}
            className="flex items-center gap-1 text-[11px] text-primary hover:underline"
          >
            <FolderOpen size={12} /> Browse File...
          </button>
        </div>
        <p className="text-[11px] text-text-muted">
          Millisecond forced aligner for speech & text. Eliminates word gluing and sentence breaks.
          Recommended download: <code className="text-text-sec">onnx/model_q4.onnx</code> (241 MB, fast) or <code className="text-text-sec">onnx/model.onnx</code> (1.3 GB).
        </p>
        <div className="flex gap-2">
          <select
            className={selectClass}
            value={alignModel}
            onChange={e => void handleSelectModel('mms-align', e.target.value)}
          >
            <option value="">Auto Select (Priority: model_q4.onnx &gt; model_q4f16 &gt; model_fp16 &gt; model.onnx)</option>
            {alignModel && !models.mmsAlign.some(m => m.path === alignModel) && (
              <option value={alignModel}>Custom: {alignModel}</option>
            )}
            {models.mmsAlign.map(m => (
              <option key={m.path} value={m.path}>{m.label}</option>
            ))}
          </select>
        </div>
        {activeAlign && (
          <p className="truncate text-[10px] text-text-muted font-mono">
            <span className="text-text-sec">Using:</span> {activeAlign}
          </p>
        )}
      </div>

      {/* 3. OpenAI Whisper */}
      <div className="rounded-lg border border-border/60 bg-surface/40 p-2.5 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-text-main">3. OpenAI Whisper (Offline Speech-to-Text)</span>
            {models.whisper.length > 0 ? (
              <span className="rounded bg-accent-success/15 px-1.5 py-0.5 text-[10px] font-medium text-accent-success">
                {models.whisper.length} found
              </span>
            ) : (
              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-500">
                Not found
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => void handleBrowseFile('whisper')}
            className="flex items-center gap-1 text-[11px] text-primary hover:underline"
          >
            <FolderOpen size={12} /> Browse File...
          </button>
        </div>
        <p className="text-[11px] text-text-muted">
          One-click offline transcriber for existing audio.
          Recommended download: <code className="text-text-sec">ggml-large-v3-turbo.bin</code> (1.6 GB, best speed & accuracy), or <code className="text-text-sec">ggml-small.bin</code> (487 MB).
        </p>
        <div className="flex gap-2">
          <select
            className={selectClass}
            value={whisperModel}
            onChange={e => void handleSelectModel('whisper', e.target.value)}
          >
            <option value="">Auto Select (Priority: ggml-large-v3-turbo.bin &gt; turbo-q5 &gt; large-v3 &gt; small)</option>
            {whisperModel && !models.whisper.some(m => m.path === whisperModel) && (
              <option value={whisperModel}>Custom: {whisperModel}</option>
            )}
            {models.whisper.map(m => (
              <option key={m.path} value={m.path}>{m.label}</option>
            ))}
          </select>
        </div>
        {activeWhisper && (
          <p className="truncate text-[10px] text-text-muted font-mono">
            <span className="text-text-sec">Using:</span> {activeWhisper}
          </p>
        )}
      </div>
    </div>
  );
}

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

        {engine.id === 'tiginal-diarize' && <TiginalDiarizeConfigPanel />}
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
