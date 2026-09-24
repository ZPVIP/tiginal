import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  BookOpen,
  Check,
  Download,
  Edit2,
  ExternalLink,
  FolderPlus,
  Heart,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import type {
  DownloadedModel,
  MarketModel,
  MarketModelDetails,
  ModelCapability,
  ModelDirectory,
  ModelDownload,
  ModelFile,
  ModelFormat,
} from '../../../shared/models/types';
import { HorizontalTabs } from '../Shared/HorizontalTabs';
import { Modal } from '../ui/Modal';
import { SettingsPageHeader } from './SettingsPageHeader';

type LibraryTab = 'market' | 'downloaded' | 'favorites';
type FileFilter = 'all' | 'gguf' | 'safetensors' | 'files';

const fieldClass = 'h-9 rounded-lg border border-border bg-surface px-3 text-sm text-text-main outline-none focus:border-primary';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return 'Unknown size';
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${bytes} B`;
}

function fileFormat(filePath: string): Exclude<FileFilter, 'all'> {
  const normalized = filePath.toLowerCase();
  if (normalized.endsWith('.gguf')) return 'gguf';
  if (normalized.endsWith('.safetensors')) return 'safetensors';
  return 'files';
}

function fileFormatLabel(filePath: string): string {
  const format = fileFormat(filePath);
  if (format === 'gguf') return 'GGUF';
  if (format === 'safetensors') return 'Safetensors';
  return 'File';
}

function selectedFormat(value: string): ModelFormat | '' {
  if (value === 'gguf' || value === 'safetensors' || value === 'mlx' || value === 'other') return value;
  return '';
}

function selectedCapability(value: string): ModelCapability | '' {
  if (value === 'text-generation' || value === 'translation' || value === 'speech-recognition') return value;
  return '';
}

function homeRelativePath(value: string, homeDirectory: string): string {
  if (!homeDirectory) return value;
  const caseInsensitive = value.includes('\\') || homeDirectory.includes('\\');
  const comparableValue = caseInsensitive ? value.toLowerCase() : value;
  const comparableHome = caseInsensitive ? homeDirectory.toLowerCase() : homeDirectory;
  if (comparableValue === comparableHome) return '~';
  const suffix = value.slice(homeDirectory.length);
  if (comparableValue.startsWith(comparableHome) && (suffix.startsWith('/') || suffix.startsWith('\\'))) {
    return `~${suffix}`;
  }
  return value;
}

function directoryTag(directory: ModelDirectory): { label: string; className: string } {
  if (directory.kind === 'managed') {
    return { label: 'managed', className: 'bg-primary/10 text-primary' };
  }
  if (directory.kind === 'huggingface-cache') {
    return { label: 'hf-cache', className: 'bg-violet-500/10 text-violet-400' };
  }
  return { label: 'user', className: 'bg-accent-success/10 text-accent-success' };
}

function CapabilityTags({ capabilities }: { capabilities: readonly ModelCapability[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {capabilities.map(capability => (
        <span key={capability} className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
          {capability}
        </span>
      ))}
    </div>
  );
}

function ModelDetailsDialog({
  model,
  downloads,
  onDownload,
  onClose,
}: {
  model: MarketModelDetails;
  downloads: readonly ModelDownload[];
  onDownload(model: MarketModel, file: ModelFile): void;
  onClose(): void;
}) {
  const [filter, setFilter] = useState<FileFilter>('all');
  const visibleFiles = useMemo(
    () => model.files.filter(file => filter === 'all' || fileFormat(file.path) === filter),
    [filter, model.files],
  );
  const title = (
    <a
      href={model.sourceUrl}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 text-text-main hover:text-primary"
    >
      {model.name}
      <ExternalLink size={14} />
    </a>
  );

  return (
    <Modal isOpen onClose={onClose} title={title} width="max-w-4xl">
      <div className="max-h-[75vh] space-y-5 overflow-y-auto p-5">
        <div className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-surface p-3 text-xs text-text-muted">
          <p><span className="text-text-sec">Repository:</span> {model.repoId}</p>
          <p><span className="text-text-sec">Source:</span> {model.source}</p>
          <p><span className="text-text-sec">Revision:</span> {model.revision}</p>
          <p><span className="text-text-sec">License:</span> {model.license || 'Not specified'}</p>
          <p><span className="text-text-sec">Files:</span> {model.files.length}</p>
          <p><span className="text-text-sec">Total size:</span> {formatBytes(model.totalSizeBytes)}</p>
        </div>
        <CapabilityTags capabilities={model.capabilities} />
        <div>
          <h3 className="mb-2 text-sm font-semibold text-text-main">Compatible engines</h3>
          <p className="text-xs text-text-muted">
            {model.compatibleEngineIds.length > 0 ? model.compatibleEngineIds.join(', ') : 'No compatible engine detected'}
          </p>
        </div>
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-text-main">Files</h3>
            <div className="flex flex-wrap gap-1" aria-label="File format filters">
              {([
                ['all', 'All files'],
                ['gguf', 'GGUF'],
                ['safetensors', 'Safetensors'],
                ['files', 'Files'],
              ] as const).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setFilter(id)}
                  className={`rounded-md px-2 py-1 text-[11px] transition-colors ${filter === id
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-surface-light text-text-muted hover:text-text-main'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="max-h-80 overflow-y-auto rounded-lg border border-border">
            {visibleFiles.map(file => {
              const download = downloads.find(candidate => (
                candidate.source === model.source
                && candidate.repoId === model.repoId
                && candidate.revision === model.revision
                && candidate.filePath === file.path
              ));
              const inProgress = download?.status === 'queued' || download?.status === 'downloading';
              const completed = download?.status === 'completed';
              const percent = inProgress && download.totalBytes && download.totalBytes > 0
                ? Math.min(100, Math.round(download.downloadedBytes / download.totalBytes * 100))
                : null;
              return (
                <div key={file.path} className="flex items-center gap-3 border-b border-border px-3 py-2 text-xs last:border-b-0">
                  <div className="min-w-0 flex-1">
                    <code className="break-all text-text-sec">{file.path}</code>
                    <div className="mt-1 flex items-center gap-2 text-[10px] text-text-muted">
                      <span>{fileFormatLabel(file.path)}</span>
                      <span>{formatBytes(file.sizeBytes)}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={inProgress || completed}
                    onClick={() => onDownload(model, file)}
                    className="flex h-8 shrink-0 items-center gap-1 rounded-lg border border-border px-2 text-xs text-text-main hover:bg-surface-light disabled:cursor-default disabled:opacity-60"
                  >
                    {inProgress ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                    {completed ? 'Downloaded' : inProgress ? `Downloading${percent !== null ? ` ${percent}%` : ''}` : 'Download'}
                  </button>
                </div>
              );
            })}
            {visibleFiles.length === 0 && (
              <p className="px-3 py-8 text-center text-xs text-text-muted">No files match this filter.</p>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

export function ModelLibrarySettings() {
  const [activeTab, setActiveTab] = useState<LibraryTab>('market');
  const [source, setSource] = useState<'huggingface' | 'modelscope'>('huggingface');
  const [search, setSearch] = useState('');
  const [capability, setCapability] = useState<ModelCapability | ''>('');
  const [format, setFormat] = useState<ModelFormat | ''>('');
  const [marketModels, setMarketModels] = useState<MarketModel[]>([]);
  const [downloadedModels, setDownloadedModels] = useState<DownloadedModel[]>([]);
  const [favoriteModels, setFavoriteModels] = useState<MarketModel[]>([]);
  const [directories, setDirectories] = useState<ModelDirectory[]>([]);
  const [downloads, setDownloads] = useState<ModelDownload[]>([]);
  const [directoryInput, setDirectoryInput] = useState('');
  const [homeDirectory, setHomeDirectory] = useState('');
  const [details, setDetails] = useState<MarketModelDetails | null>(null);
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [modelNameDraft, setModelNameDraft] = useState('');
  const [renamingModelId, setRenamingModelId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailsLoadingId, setDetailsLoadingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const loadMarket = useCallback(async () => {
    const api = window.electron?.models;
    if (!api) return;
    setLoading(true);
    setError('');
    try {
      setMarketModels(await api.searchModelMarket({
        source,
        search,
        ...(capability ? { capability } : {}),
        ...(format ? { format } : {}),
        sort: 'downloads',
      }));
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [capability, format, search, source]);

  const loadLocal = useCallback(async (scan: boolean) => {
    const api = window.electron?.models;
    if (!api) return;
    setLoading(true);
    setError('');
    try {
      const [models, nextDirectories, nextDownloads, nextHomeDirectory] = await Promise.all([
        scan ? api.scanDownloadedModels() : api.listDownloadedModels(),
        api.listModelDirectories(),
        api.listModelDownloads(),
        api.getHomeDirectory(),
      ]);
      setDownloadedModels(models);
      setDirectories(nextDirectories);
      setDownloads(nextDownloads);
      setHomeDirectory(nextHomeDirectory);
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadFavorites = useCallback(async () => {
    const api = window.electron?.models;
    if (!api) return;
    setFavoriteModels(await api.listFavoriteModels());
  }, []);

  useEffect(() => {
    void loadMarket();
    void loadLocal(true);
    void loadFavorites();
  }, []);

  useEffect(() => {
    if (!downloads.some(download => download.status === 'queued' || download.status === 'downloading')) return;
    const timer = window.setInterval(() => {
      void window.electron?.models.listModelDownloads().then(setDownloads);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [downloads]);

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    void loadMarket();
  };

  const toggleFavorite = async (model: MarketModel) => {
    const api = window.electron?.models;
    if (!api) return;
    await api.setModelFavorite(model, !model.favorite);
    const update = (candidate: MarketModel) => candidate.id === model.id
      ? { ...candidate, favorite: !model.favorite }
      : candidate;
    setMarketModels(current => current.map(update));
    await loadFavorites();
  };

  const openDetails = async (model: MarketModel) => {
    const api = window.electron?.models;
    if (!api) return;
    setDetailsLoadingId(model.id);
    setError('');
    try {
      setDetails(await api.getMarketModelDetails(model));
    } catch (detailsError) {
      setError(errorMessage(detailsError));
    } finally {
      setDetailsLoadingId(null);
    }
  };

  const startDownload = async (model: MarketModel, file: ModelFile) => {
    const api = window.electron?.models;
    if (!api) return;
    try {
      const download = await api.startModelDownload({ model, file });
      setDownloads(current => [download, ...current.filter(item => item.id !== download.id)]);
    } catch (downloadError) {
      setError(errorMessage(downloadError));
    }
  };

  const deleteDownloadedModel = async (model: DownloadedModel) => {
    const api = window.electron?.models;
    if (!api) return;
    const displayedPath = homeRelativePath(model.storagePath, homeDirectory);
    if (!window.confirm(`Permanently delete "${model.name}" from ${displayedPath}?`)) return;
    setError('');
    try {
      setDownloadedModels(await api.deleteDownloadedModel(model.id));
      setDownloads(await api.listModelDownloads());
      if (editingModelId === model.id) {
        setEditingModelId(null);
        setModelNameDraft('');
      }
    } catch (deleteError) {
      setError(errorMessage(deleteError));
    }
  };

  const beginModelRename = (model: DownloadedModel) => {
    setEditingModelId(model.id);
    setModelNameDraft(model.name);
  };

  const saveModelName = async (model: DownloadedModel) => {
    const api = window.electron?.models;
    const name = modelNameDraft.trim();
    if (!api || !name) return;
    setRenamingModelId(model.id);
    setError('');
    try {
      setDownloadedModels(await api.renameDownloadedModel(model.id, name));
      setEditingModelId(null);
      setModelNameDraft('');
    } catch (renameError) {
      setError(errorMessage(renameError));
    } finally {
      setRenamingModelId(null);
    }
  };

  const activeDownloads = useMemo(
    () => downloads.filter(download => download.status !== 'completed' && download.status !== 'cancelled'),
    [downloads],
  );

  const renderMarketCards = (models: readonly MarketModel[]) => (
    <div className="grid gap-3">
      {models.map(model => (
        <article key={model.id} className="rounded-lg border border-border bg-surface p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 space-y-2">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="truncate text-sm font-semibold text-text-main">{model.name}</h3>
                  {model.featured && <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">Featured</span>}
                </div>
                <p className="text-[11px] text-text-muted">{model.author || 'Unknown author'} · {model.source}</p>
              </div>
              <CapabilityTags capabilities={model.capabilities} />
              <p className="text-[11px] text-text-muted">
                {model.formats.join(', ')} · {model.license || 'License not specified'}
                {model.downloads !== null ? ` · ${model.downloads.toLocaleString()} downloads` : ''}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                title={model.favorite ? 'Remove from favorites' : 'Add to favorites'}
                onClick={() => void toggleFavorite(model)}
                className={`rounded-lg p-2 hover:bg-surface-light ${model.favorite ? 'text-red-400' : 'text-text-muted'}`}
              >
                <Heart size={15} fill={model.favorite ? 'currentColor' : 'none'} />
              </button>
              <button
                type="button"
                disabled={detailsLoadingId === model.id}
                onClick={() => void openDetails(model)}
                className="flex h-8 items-center gap-1 rounded-lg border border-border px-2 text-xs text-text-main hover:bg-surface-light disabled:opacity-50"
              >
                {detailsLoadingId === model.id ? <Loader2 size={13} className="animate-spin" /> : <BookOpen size={13} />}
                Details
              </button>
            </div>
          </div>
        </article>
      ))}
      {models.length === 0 && !loading && (
        <div className="rounded-lg border border-dashed border-border py-12 text-center text-xs text-text-muted">No models found.</div>
      )}
    </div>
  );

  return (
    <div className="space-y-4 animate-in fade-in duration-300">
      <SettingsPageHeader icon={<BookOpen size={24} />} title="Model Library" />
      <HorizontalTabs
        tabs={[
          { id: 'market', label: 'Model Market' },
          { id: 'downloaded', label: 'Downloaded' },
          { id: 'favorites', label: 'Favorites' },
        ]}
        activeTab={activeTab}
        onChange={tab => {
          setActiveTab(tab);
          if (tab === 'favorites') void loadFavorites();
          if (tab === 'downloaded') void loadLocal(false);
        }}
        ariaLabel="Model library sections"
      />

      {error && <div className="rounded-lg border border-accent-danger/30 bg-accent-danger/10 px-3 py-2 text-xs text-accent-danger">{error}</div>}

      {activeDownloads.length > 0 && (
        <div className="space-y-2 rounded-lg border border-border bg-surface p-3">
          {activeDownloads.map(download => {
            const percent = download.totalBytes && download.totalBytes > 0
              ? Math.min(100, Math.round(download.downloadedBytes / download.totalBytes * 100))
              : null;
            return (
              <div key={download.id} className="space-y-1">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="truncate text-text-main">{download.filePath || download.repoId}</span>
                  <div className="flex items-center gap-2 text-text-muted">
                    <span>{download.status}{percent !== null ? ` ${percent}%` : ''}</span>
                    {(download.status === 'queued' || download.status === 'downloading') && (
                      <button type="button" title="Cancel download" onClick={() => void window.electron?.models.cancelModelDownload(download.id)}>
                        <X size={13} />
                      </button>
                    )}
                  </div>
                </div>
                {percent !== null && (
                  <div className="h-1 overflow-hidden rounded-full bg-background">
                    <div className="h-full bg-primary" style={{ width: `${percent}%` }} />
                  </div>
                )}
                {download.error && <p className="text-[11px] text-accent-danger">{download.error}</p>}
              </div>
            );
          })}
        </div>
      )}

      {activeTab === 'market' && (
        <div className="space-y-3" role="tabpanel">
          <form onSubmit={submitSearch} className="space-y-2">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <select className={`${fieldClass} w-full`} value={source} onChange={event => setSource(event.target.value === 'modelscope' ? 'modelscope' : 'huggingface')}>
                <option value="huggingface">Hugging Face</option>
                <option value="modelscope">ModelScope</option>
              </select>
              <select className={`${fieldClass} w-full`} value={capability} onChange={event => setCapability(selectedCapability(event.target.value))}>
                <option value="">All capabilities</option>
                <option value="text-generation">Text generation</option>
                <option value="translation">Translation</option>
                <option value="speech-recognition">Speech recognition</option>
              </select>
              <select className={`${fieldClass} w-full`} value={format} onChange={event => setFormat(selectedFormat(event.target.value))}>
                <option value="">All formats</option>
                <option value="gguf">GGUF</option>
                <option value="safetensors">Safetensors</option>
                <option value="mlx">MLX</option>
                <option value="other">Files</option>
              </select>
            </div>
            <div className="flex gap-2">
              <input className={`${fieldClass} min-w-0 flex-1`} value={search} onChange={event => setSearch(event.target.value)} placeholder="Search keywords" />
              <button type="submit" disabled={loading} className="flex h-9 shrink-0 items-center gap-2 rounded-lg bg-primary px-4 text-sm text-primary-foreground disabled:opacity-50">
                {loading ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />} Search
              </button>
            </div>
          </form>
          {renderMarketCards(marketModels)}
        </div>
      )}

      {activeTab === 'downloaded' && (
        <div className="space-y-4" role="tabpanel">
          <section className="space-y-2 rounded-lg border border-border bg-surface p-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-text-main">Scan directories</h3>
                <p className="text-[11px] text-text-muted">Tiginal models, custom folders, and Hugging Face cache locations.</p>
              </div>
              <button type="button" disabled={loading} onClick={() => void loadLocal(true)} className="flex h-8 items-center gap-2 rounded-lg border border-border px-2 text-xs text-text-main hover:bg-surface-light disabled:opacity-50">
                <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Scan
              </button>
            </div>
            {directories.map(directory => {
              const tag = directoryTag(directory);
              return (
                <div key={directory.path} className="flex items-center justify-between gap-3 rounded bg-background px-2 py-1.5 text-[11px]">
                  <code className="min-w-0 break-all text-text-sec">{homeRelativePath(directory.path, homeDirectory)}</code>
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${tag.className}`}>{tag.label}</span>
                </div>
              );
            })}
            <div className="flex gap-2">
              <input className={`${fieldClass} min-w-0 flex-1`} value={directoryInput} onChange={event => setDirectoryInput(event.target.value)} placeholder="/path/to/models" />
              <button
                type="button"
                disabled={!directoryInput.trim()}
                onClick={() => void window.electron?.models.addModelDirectory(directoryInput).then(next => {
                  setDirectories(next);
                  setDirectoryInput('');
                  void loadLocal(true);
                }).catch(addError => setError(errorMessage(addError)))}
                className="flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-xs text-text-main hover:bg-surface-light disabled:opacity-50"
              >
                <FolderPlus size={14} /> Add directory
              </button>
            </div>
          </section>

          <div className="grid gap-3">
            {downloadedModels.map(model => (
              <article key={model.id} className="rounded-lg border border-border bg-surface p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-2">
                    {editingModelId === model.id ? (
                      <input
                        autoFocus
                        maxLength={120}
                        value={modelNameDraft}
                        onChange={event => setModelNameDraft(event.target.value)}
                        onKeyDown={event => {
                          if (event.key === 'Enter') void saveModelName(model);
                          if (event.key === 'Escape') {
                            setEditingModelId(null);
                            setModelNameDraft('');
                          }
                        }}
                        className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm font-semibold text-text-main outline-none focus:border-primary"
                      />
                    ) : (
                      <h3 className="text-sm font-semibold text-text-main">{model.name}</h3>
                    )}
                    <p className="break-all text-[11px] text-text-muted">{homeRelativePath(model.path, homeDirectory)}</p>
                    <CapabilityTags capabilities={model.capabilities} />
                    <p className="text-[11px] text-text-muted">
                      {model.format} · {formatBytes(model.sizeBytes)} · {model.files.length} files · {model.compatibleEngineIds.join(', ') || 'No compatible engine'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={renamingModelId === model.id || (editingModelId === model.id && !modelNameDraft.trim())}
                      title={editingModelId === model.id ? 'Save model name' : 'Edit model name'}
                      onClick={() => editingModelId === model.id
                        ? void saveModelName(model)
                        : beginModelRename(model)}
                      className="rounded p-1.5 text-text-muted hover:bg-primary/10 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {editingModelId === model.id ? <Check size={13} /> : <Edit2 size={13} />}
                    </button>
                    <button
                      type="button"
                      title="Delete downloaded model"
                      onClick={() => void deleteDownloadedModel(model)}
                      className="rounded p-1.5 text-text-muted hover:bg-red-400/10 hover:text-red-400"
                    >
                      <Trash2 size={13} />
                    </button>
                    <span className={`rounded px-2 py-1 text-[10px] ${model.complete ? 'bg-accent-success/10 text-accent-success' : 'bg-amber-500/10 text-amber-500'}`}>
                      {model.complete ? 'Ready' : 'Partial'}
                    </span>
                  </div>
                </div>
              </article>
            ))}
            {downloadedModels.length === 0 && !loading && (
              <div className="rounded-lg border border-dashed border-border py-12 text-center text-xs text-text-muted">No downloaded models detected.</div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'favorites' && <div role="tabpanel">{renderMarketCards(favoriteModels)}</div>}
      {details && (
        <ModelDetailsDialog
          model={details}
          downloads={downloads}
          onDownload={(model, file) => void startDownload(model, file)}
          onClose={() => setDetails(null)}
        />
      )}
    </div>
  );
}
