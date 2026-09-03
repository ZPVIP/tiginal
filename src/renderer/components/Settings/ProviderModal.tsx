import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Modal } from '../ui/Modal';
import {
  AlertTriangle,
  ArrowUp,
  Brain,
  Braces,
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  FileText,
  Layers3,
  Info,
  RefreshCw,
  Search,
  Video,
  Volume2,
  Wrench,
} from 'lucide-react';
import { clsx } from 'clsx';
import {
  AIProvider,
  API_FORMAT_OPTIONS,
  apiFormatForCatalogPackage,
  CatalogNpmPackage,
  CatalogProvider,
  isApiFormat,
  isReasoningEffort,
  ModelConfig,
} from '../../settings/ai-constants';
import { FancySelect } from '../ui/FancySelect';
import { ProviderLogo } from './ProviderLogo';
import { Toggle } from '../ui/Toggle';

interface ProviderModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialData?: Partial<AIProvider>;
  onSave: (data: Partial<AIProvider>) => Promise<void>;
}

interface FetchModelsResult {
  success: boolean;
  error?: string;
  models?: ModelConfig[];
}

interface ProviderPreset {
  id: string;
  name: string;
  api: string;
  npm: CatalogNpmPackage;
}

const invoke = window.electron?.invoke || (async () => undefined);

function compactTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    const value = tokens / 1_000_000;
    return `${Number.isInteger(value) ? value : value.toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    const value = tokens / 1_000;
    return `${Number.isInteger(value) ? value : value.toFixed(1)}K`;
  }
  return String(tokens);
}

function detailedTokens(tokens: number): string {
  return new Intl.NumberFormat('en-US').format(tokens);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCatalogEndpoint(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || (
      url.protocol === 'http:' && url.hostname === '127.0.0.1'
    );
  } catch {
    return false;
  }
}

function parseModel(value: unknown): ModelConfig | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string') return null;
  return {
    id: value.id,
    name: value.name,
    enabled: value.enabled !== false,
    ...(typeof value.contextWindow === 'number' ? { contextWindow: value.contextWindow } : {}),
    ...(typeof value.maxOutputTokens === 'number' ? { maxOutputTokens: value.maxOutputTokens } : {}),
    ...(value.supportsImages === true ? { supportsImages: true } : {}),
    ...(value.supportsPdf === true ? { supportsPdf: true } : {}),
    ...(value.supportsAudio === true ? { supportsAudio: true } : {}),
    ...(value.supportsVideo === true ? { supportsVideo: true } : {}),
    ...(value.supportsReasoning === true ? { supportsReasoning: true } : {}),
    ...(value.supportsToolCalls === true ? { supportsToolCalls: true } : {}),
    ...(value.supportsStructuredOutput === true ? { supportsStructuredOutput: true } : {}),
    ...(Array.isArray(value.reasoningEffortOptions)
      ? { reasoningEffortOptions: value.reasoningEffortOptions.filter(isReasoningEffort) }
      : {}),
    ...(Array.isArray(value.catalogDetails)
      ? { catalogDetails: value.catalogDetails.filter((detail): detail is string => typeof detail === 'string') }
      : {}),
  };
}

function parseCatalogProvider(value: unknown): CatalogProvider | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string' || !isCatalogEndpoint(value.api)) return null;
  const npm = value.npm;
  if (npm !== '@ai-sdk/openai-compatible' && npm !== '@ai-sdk/anthropic') return null;
  return {
    id: value.id,
    name: value.name,
    api: value.api,
    npm,
  };
}

function parseFetchModelsResult(value: unknown): FetchModelsResult {
  if (!isRecord(value)) return { success: false, error: 'Invalid response from model service' };
  const models = Array.isArray(value.models)
    ? value.models.map(parseModel).filter((model): model is ModelConfig => model !== null)
    : undefined;
  return {
    success: value.success === true,
    models,
    error: typeof value.error === 'string' ? value.error : undefined,
  };
}

function mergeFetchedModels(currentModels: ModelConfig[], fetchedModels: ModelConfig[]): ModelConfig[] {
  const currentModelsById = new Map(currentModels.map(model => [model.id, model]));
  const fetchedIds = new Set<string>();

  return fetchedModels.flatMap(model => {
    if (fetchedIds.has(model.id)) return [];
    fetchedIds.add(model.id);

    return [{
      ...model,
      enabled: currentModelsById.get(model.id)?.enabled ?? false,
    }];
  });
}

export function ProviderModal({ isOpen, onClose, initialData, onSave }: ProviderModalProps) {
  const [formData, setFormData] = useState<Partial<AIProvider>>({
      type: 'openai-compatible',
      name: '',
      endpoint: '',
      apiKey: '',
      model: '',
      availableModels: [],
      autoCORSFix: true,
      apiFormat: 'chat-completions',
      useMaxCompletionTokens: false,
      isDefault: false,
      ...initialData
  });
  const [preset, setPreset] = useState('custom');
  const [catalogProviders, setCatalogProviders] = useState<CatalogProvider[]>([]);
  const [catalogLoadError, setCatalogLoadError] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<FetchModelsResult | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [providerSearch, setProviderSearch] = useState('');
  
  // Custom Select State
  const [isPresetOpen, setIsPresetOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 0 });
  const presetRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
     setPreset(initialData?.catalogProvider || 'custom');
  }, [initialData]);

  useEffect(() => {
      if (!isOpen) return;
      let active = true;
      setCatalogLoadError(false);
      void invoke('ai:get-model-catalog-providers')
        .then(value => {
            if (!active) return;
            const providers = Array.isArray(value)
              ? value.map(parseCatalogProvider).filter((provider): provider is CatalogProvider => provider !== null)
              : [];
            setCatalogProviders(providers);
            const matchingProvider = providers.find(provider => (
              provider.api === initialData?.endpoint
              && (!initialData.catalogProvider || provider.id === initialData.catalogProvider)
            ));
            if (matchingProvider) {
                setPreset(matchingProvider.id);
                setFormData(current => ({
                    ...current,
                    catalogProvider: matchingProvider.id,
                    apiFormat: apiFormatForCatalogPackage(matchingProvider.npm),
                }));
            }
        })
        .catch(() => {
            if (active) setCatalogLoadError(true);
        });
      return () => { active = false; };
  }, [isOpen]);

  const providerPresets = useMemo<ProviderPreset[]>(() => [
      { id: 'custom', name: 'Custom', api: '', npm: '@ai-sdk/openai-compatible' },
      ...catalogProviders,
  ], [catalogProviders]);

  const filteredProviderPresets = useMemo(() => {
      const query = providerSearch.trim().toLowerCase();
      if (!query) return providerPresets;
      return providerPresets.filter(provider => (
          provider.id.toLowerCase().includes(query)
          || provider.name.toLowerCase().includes(query)
          || provider.api.toLowerCase().includes(query)
      ));
  }, [providerPresets, providerSearch]);

  // Click outside to close preset dropdown
  useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
          const target = event.target as Node;
          const isInsideTrigger = presetRef.current?.contains(target);
          const isInsideDropdown = dropdownRef.current?.contains(target);

          if (!isInsideTrigger && !isInsideDropdown) {
              setIsPresetOpen(false);
          }
      };
      
      if (isPresetOpen) {
          // Use capture so parent handlers calling stopPropagation (e.g. draggable modal surfaces)
          // don't prevent outside-click closing.
          document.addEventListener('mousedown', handleClickOutside, true);
          // Also update coords on scroll/resize ideally, or just close
          const handleResize = () => setIsPresetOpen(false);
          window.addEventListener('resize', handleResize);
          return () => {
              document.removeEventListener('mousedown', handleClickOutside, true);
              window.removeEventListener('resize', handleResize);
          };
      }
  }, [isPresetOpen]);

  const handleChange = <Key extends keyof AIProvider>(field: Key, value: AIProvider[Key]) => {
      setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handlePresetSelect = (provider: ProviderPreset) => {
      const previousPreset = providerPresets.find(item => item.id === preset);
      setPreset(provider.id);
      setIsPresetOpen(false);
      setProviderSearch('');

      setFormData(prev => {
          if (provider.id === 'custom') return { ...prev, catalogProvider: '' };
          return {
              ...prev,
              catalogProvider: provider.id,
              endpoint: provider.api,
              name: !prev.name || prev.name === previousPreset?.name ? provider.name : prev.name,
              apiFormat: apiFormatForCatalogPackage(provider.npm),
          };
      });
  };

  const filteredModels = useMemo(() => {
      const query = searchTerm.trim().toLowerCase();
      const models = formData.availableModels || [];
      return query
          ? models.filter(model => model.name.toLowerCase().includes(query) || model.id.toLowerCase().includes(query))
          : models;
  }, [formData.availableModels, searchTerm]);
  
  const togglePreset = () => {
      if (!isPresetOpen && presetRef.current) {
          const rect = presetRef.current.getBoundingClientRect();
          setCoords({
              top: rect.bottom + window.scrollY + 4,
              left: rect.left + window.scrollX,
              width: rect.width
          });
          setProviderSearch('');
          setIsPresetOpen(true);
      } else {
          setIsPresetOpen(false);
      }
  };

  const handleTest = async () => {
      setIsTesting(true);
      setTestResult(null);
      try {
          const res = parseFetchModelsResult(await invoke('ai:test-connection', {
              id: formData.id,
              type: formData.type,
              endpoint: formData.endpoint,
              apiKey: formData.apiKey,
              customHeaders: formData.customHeaders,
              autoCORSFix: formData.autoCORSFix,
              apiFormat: formData.apiFormat,
              catalogProvider: formData.catalogProvider || undefined,
          }));
          setTestResult(res);
          if (res.success && res.models) {
              setFormData(prev => {
                  const availableModels = mergeFetchedModels(prev.availableModels || [], res.models || []);
                  const model = prev.model && availableModels.some(item => item.id === prev.model && item.enabled)
                      ? prev.model
                      : availableModels.find(item => item.enabled)?.id || '';
                  return { 
                      ...prev, 
                      availableModels,
                      model,
                  };
              });
          }
      } finally {
          setIsTesting(false);
      }
  };

  const handleModelToggle = (id: string, enabled: boolean) => {
      setFormData(prev => {
          const models = (prev.availableModels || []).map(model => (
              model.id === id ? { ...model, enabled } : model
          ));
          const enabledModels = models.filter(model => model.enabled);
          const model = prev.model && enabledModels.some(item => item.id === prev.model)
              ? prev.model
              : enabledModels[0]?.id || '';
          return { ...prev, availableModels: models, model };
      });
  };

  const allModelsSelected = (formData.availableModels?.length || 0) > 0
      && (formData.availableModels || []).every(model => model.enabled);

  const handleSelectAll = (enabled: boolean) => {
      setFormData(prev => ({
          ...prev,
          availableModels: (prev.availableModels || []).map(model => ({ ...model, enabled })),
          model: enabled ? prev.model || prev.availableModels?.[0]?.id || '' : '',
      }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      
      let finalData = { ...formData };
      
      // Localhost check
      if (finalData.endpoint && finalData.endpoint.includes('localhost')) {
          const shouldReplace = window.confirm(
              "Using 'localhost' may cause connection issues with some AI providers (e.g. Ollama).\n\n" +
              "Do you want to switch to '127.0.0.1' instead? (Recommended)"
          );
          
          if (shouldReplace) {
              finalData.endpoint = finalData.endpoint.replace('localhost', '127.0.0.1');
              setFormData(finalData); // Update UI too
          }
      }

      await onSave(finalData);
  };

  const selectedPreset = providerPresets.find(provider => provider.id === preset) || providerPresets[0];

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={initialData?.id ? 'Edit Provider' : 'Add Provider'} width="max-w-2xl" alwaysShowScrollbar>
       <form onSubmit={handleSubmit} className="p-6 space-y-5">
           
           {/* Custom Preset Selector */}
           <div className="relative" ref={presetRef}>
               <label className="block text-sm font-medium text-text-main mb-1">Provider Preset</label>
               <button
                  type="button"
                  onClick={togglePreset}
                  className="w-full bg-background border border-border rounded-lg p-2.5 text-sm flex items-center justify-between hover:border-primary/60 transition-colors"
               >
                   <div className="flex items-center gap-2">
                       <ProviderLogo providerId={selectedPreset.id} className="h-5 w-5 text-text-muted" />
                       <span>{selectedPreset.name}</span>
                   </div>
                   <ChevronDown size={16} className={clsx("text-text-muted transition-transform", isPresetOpen ? "rotate-180" : "")} />
               </button>

               {/* Dropdown Menu Portal */}
               {isPresetOpen && createPortal(
                   <div 
                       ref={dropdownRef}
                       style={{ 
                           top: coords.top, 
                           left: coords.left, 
                           width: coords.width,
                           maxHeight: '300px'
                       }}
                       className="fixed z-[9999] bg-surface border border-border rounded-lg shadow-xl overflow-y-auto"
                   >
                       <div className="sticky top-0 z-10 border-b border-border bg-surface p-2">
                           <div className="relative">
                               <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
                               <input
                                  autoFocus
                                  type="search"
                                  value={providerSearch}
                                  onChange={event => setProviderSearch(event.target.value)}
                                  onKeyDown={event => {
                                      if (event.key === 'Escape') setIsPresetOpen(false);
                                  }}
                                  placeholder="Search providers..."
                                  className="w-full rounded-md border border-border bg-background py-2 pl-8 pr-3 text-sm text-text-main outline-none placeholder:text-text-muted focus:border-primary"
                               />
                           </div>
                       </div>
                       {filteredProviderPresets.map(provider => (
                           <button
                               key={provider.id}
                               type="button"
                               onClick={() => handlePresetSelect(provider)}
                               className={clsx(
                                   'w-full p-2.5 text-left text-sm hover:bg-surface-hover flex items-center gap-2 transition-colors border-b border-border last:border-0',
                                   provider.id === preset && 'bg-primary/10 text-primary',
                               )}
                           >
                               <ProviderLogo providerId={provider.id} className="h-5 w-5 shrink-0 text-text-muted" />
                               <span className="font-medium">{provider.name}</span>
                               {provider.id !== 'custom' && (
                                   <span className="text-xs text-text-muted ml-auto truncate max-w-[180px]">
                                       {new URL(provider.api).host}
                                   </span>
                               )}
                               {provider.id === preset && <Check size={14} className="ml-1 shrink-0" />}
                           </button>
                       ))}
                       {filteredProviderPresets.length === 0 && (
                           <div className="p-6 text-center text-sm text-text-muted">No providers match your search.</div>
                       )}
                   </div>,
                   document.body
               )}
               {catalogLoadError && (
                   <p className="mt-1 text-[11px] text-accent-danger">Could not load the local model catalog.</p>
               )}
               {!catalogLoadError && catalogProviders.length === 0 && (
                   <p className="mt-1 text-[11px] text-text-muted">Update the model catalog to load provider presets.</p>
               )}
           </div>

           <div className="grid grid-cols-2 gap-4">
               <div>
                   <label className="block text-sm font-medium text-text-main mb-1">Name</label>
                   <input 
                      type="text" 
                      required
                      value={formData.name || ''}
                      onChange={(e) => handleChange('name', e.target.value)}
                      className="w-full bg-background border border-border rounded-lg p-2.5 text-sm"
                      placeholder="e.g. Work GPT"
                   />
               </div>
               <div>
                   <label className="block text-sm font-medium text-text-main mb-1">Default Provider</label>
                   <div className="flex h-[42px] items-center">
                       <Toggle
                          checked={formData.isDefault ?? false}
                          onChange={(checked) => handleChange('isDefault', checked)}
                          label="Default Provider"
                       />
                   </div>
               </div>
           </div>

           <div>
               <label className="block text-sm font-medium text-text-main mb-1">API Endpoint</label>
               <input 
                  type="url" 
                  required
                  value={formData.endpoint || ''}
                  onChange={(e) => handleChange('endpoint', e.target.value)}
                  className="w-full bg-background border border-border rounded-lg p-2.5 text-sm font-mono"
                  placeholder="https://api.openai.com/v1"
               />
           </div>

            <div>
                <label className="block text-sm font-medium text-text-main mb-1">API Key</label>
                <div className="relative">
                    <input 
                       type={showApiKey ? "text" : "password"}
                       value={formData.apiKey || ''}
                       onChange={(e) => handleChange('apiKey', e.target.value)}
                       className="w-full bg-background border border-border rounded-lg p-2.5 pr-10 text-sm font-mono"
                       placeholder="sk-..."
                    />
                    <button
                        type="button"
                        onClick={() => setShowApiKey(!showApiKey)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-main transition-colors"
                    >
                        {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                </div>
            </div>

           <div>
               <label className="block text-sm font-medium text-text-main mb-1">API Format</label>
               <FancySelect
                  className="w-full"
                  value={formData.apiFormat || 'chat-completions'}
                  onChange={(value) => {
                      if (isApiFormat(value)) handleChange('apiFormat', value);
                  }}
                  options={API_FORMAT_OPTIONS.map(option => ({ ...option }))}
                  buttonClassName="bg-background"
               />
           </div>

           <div>
               <div className="text-sm font-semibold text-text-main">Use max_completion_tokens</div>
               <div className="mt-2 flex items-center justify-between gap-5">
                   <p className="text-xs leading-5 text-text-muted">
                       Enable for newer OpenAI models (o1, o3, etc.) that require <code className="text-text-sec">max_completion_tokens</code> instead of <code className="text-text-sec">max_tokens</code>
                   </p>
                   <Toggle
                      checked={formData.useMaxCompletionTokens ?? false}
                      onChange={(checked) => handleChange('useMaxCompletionTokens', checked)}
                      label="Use max_completion_tokens"
                   />
               </div>
           </div>

           <section className="space-y-3">
               <div className="flex items-center justify-between">
                   <div>
                       <h4 className="text-sm font-semibold text-text-main">Models</h4>
                       {(formData.availableModels?.length || 0) > 0 && (
                           <p className="text-[11px] text-text-muted mt-0.5">
                               {(formData.availableModels || []).filter(model => model.enabled).length} of {formData.availableModels?.length} enabled
                           </p>
                       )}
                   </div>
                   <div className="flex items-center gap-3">
                       <button
                          type="button"
                          onClick={handleTest}
                          disabled={isTesting || !formData.endpoint}
                          className="px-3 py-1.5 bg-surface-light border border-border hover:border-primary hover:bg-surface-hover text-text-main rounded-lg text-xs font-medium flex items-center gap-2 transition-colors disabled:opacity-50"
                       >
                           <RefreshCw size={12} className={clsx(isTesting && 'animate-spin')} />
                           Fetch
                       </button>
                       <span className="text-xs text-text-sec">Select all</span>
                       <Toggle
                          checked={allModelsSelected}
                          onChange={handleSelectAll}
                          disabled={(formData.availableModels?.length || 0) === 0}
                          label="Select all models"
                          size="small"
                       />
                   </div>
               </div>

               <div className="relative">
                   <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                   <input
                      type="text"
                      value={searchTerm}
                      onChange={(event) => setSearchTerm(event.target.value)}
                      placeholder="Search models..."
                      className="w-full bg-background border border-border rounded-lg py-2 pl-9 pr-3 text-sm text-text-main placeholder-text-muted"
                   />
               </div>

               {testResult && (
                   <div className={clsx('text-xs flex items-start gap-1.5', testResult.success ? 'text-accent-success' : 'text-accent-danger')}>
                       {testResult.success ? <Check size={14} /> : <AlertTriangle size={14} className="mt-0.5 shrink-0" />}
                       <span className="break-words">{testResult.success ? 'Models fetched' : testResult.error || 'Could not fetch models'}</span>
                   </div>
               )}

               <div className="border border-border rounded-lg bg-background/50 max-h-72 overflow-y-auto">
                   {filteredModels.map(model => (
                       <div key={model.id} className="flex items-center gap-3 px-3 py-2.5 border-b border-border/50 last:border-b-0 hover:bg-surface-hover transition-colors">
                           <Toggle
                              checked={model.enabled}
                              onChange={(checked) => handleModelToggle(model.id, checked)}
                              label={`${model.enabled ? 'Disable' : 'Enable'} ${model.name}`}
                              size="small"
                           />
                           <div className="min-w-0 flex-1">
                               <div className="truncate text-sm font-medium text-text-main" title={model.name}>{model.name}</div>
                               {model.id !== model.name && <div className="truncate text-[10px] text-text-muted font-mono" title={model.id}>{model.id}</div>}
                           </div>
                           <div className="flex items-center gap-1.5 text-text-muted shrink-0">
                               {model.contextWindow && (
                                   <span
                                      className="inline-flex items-center gap-1 rounded border border-border bg-surface px-1.5 py-0.5 text-[10px]"
                                      title={`Context window: ${detailedTokens(model.contextWindow)} tokens`}
                                   >
                                       <Layers3 size={11} />
                                       {compactTokens(model.contextWindow)}
                                   </span>
                               )}
                               {model.maxOutputTokens && (
                                   <span
                                      className="inline-flex items-center gap-1 rounded border border-border bg-surface px-1.5 py-0.5 text-[10px]"
                                      title={`Max output tokens: ${detailedTokens(model.maxOutputTokens)} tokens`}
                                   >
                                       <ArrowUp size={11} />
                                       {compactTokens(model.maxOutputTokens)}
                                   </span>
                               )}
                               {model.supportsImages && (
                                   <span className="inline-flex" aria-label="Supports image input" title="Supports image input"><Eye size={14} /></span>
                               )}
                               {model.supportsReasoning && (
                                   <span className="inline-flex" aria-label="Extended thinking/reasoning" title="Extended thinking/reasoning"><Brain size={14} /></span>
                               )}
                               {model.supportsPdf && (
                                   <span className="inline-flex" aria-label="Supports PDF input" title="Supports PDF input"><FileText size={14} /></span>
                               )}
                               {model.supportsAudio && (
                                   <span className="inline-flex" aria-label="Supports audio input" title="Supports audio input"><Volume2 size={14} /></span>
                               )}
                               {model.supportsVideo && (
                                   <span className="inline-flex" aria-label="Supports video input" title="Supports video input"><Video size={14} /></span>
                               )}
                               {model.supportsToolCalls && (
                                   <span className="inline-flex" aria-label="Supports tool calls" title="Supports tool calls"><Wrench size={14} /></span>
                               )}
                               {model.supportsStructuredOutput && (
                                   <span className="inline-flex" aria-label="Supports structured output" title="Supports structured output"><Braces size={14} /></span>
                               )}
                               {(model.catalogDetails?.length || 0) > 0 && (
                                   <span
                                      className="inline-flex"
                                      aria-label="More model information"
                                      title={model.catalogDetails?.join('\n')}
                                   ><Info size={14} /></span>
                               )}
                           </div>
                       </div>
                   ))}
                   {filteredModels.length === 0 && (
                       <div className="p-8 text-center text-sm text-text-muted">
                           {(formData.availableModels?.length || 0) === 0 ? 'Fetch models to configure this provider.' : 'No models match your search.'}
                       </div>
                   )}
               </div>
           </section>

           <div className="pt-4 flex justify-end gap-3 border-t border-border mt-4">
               <button 
                  type="button" 
                  onClick={onClose}
                  className="px-4 py-2 text-sm text-text-muted hover:text-text-main transition-colors"
               >
                   Cancel
               </button>
               <button 
                  type="submit"
                  className="px-4 py-2 bg-primary hover:opacity-90 text-primary-foreground rounded-lg text-sm font-medium transition-colors"
               >
                   Save Provider
               </button>
           </div>
       </form>
    </Modal>
  );
}
