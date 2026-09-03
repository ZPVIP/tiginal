
import React, { useState, useEffect, useMemo } from 'react';
import { Modal } from '../ui/Modal';
import { Search, Loader2 } from 'lucide-react';
import { AIProvider, ModelConfig } from '../../settings/ai-constants';
import { clsx } from 'clsx';

// Mock invoke
const invoke = window.electron?.invoke || (async () => {});

interface ModelManagerModalProps {
    isOpen: boolean;
    onClose: () => void;
    provider: AIProvider;
    onSave: (data: Partial<AIProvider>) => Promise<void>;
}

export function ModelManagerModal({ isOpen, onClose, provider, onSave }: ModelManagerModalProps) {
    const [models, setModels] = useState<ModelConfig[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [isFetching, setIsFetching] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        if (isOpen) {
            initializeModels();
        }
    }, [isOpen, provider]);

    const initializeModels = async () => {
        setIsFetching(true);
        try {
            // 1. Prepare local "enabled" map for lookup
            const localEnabledMap = new Map<string, boolean>();
            (provider.availableModels || []).forEach(m => {
                 const name = typeof m === 'string' ? m : m.name;
                 const enabled = typeof m === 'string' ? true : m.enabled;
                 localEnabledMap.set(name, enabled !== false); 
            });

            // 2. Fetch latest models from API
            let res;
            try {
                res = await invoke('ai:test-connection', {
                    id: provider.id,
                    type: provider.type,
                    endpoint: provider.endpoint || '',
                    apiKey: provider.apiKey || '', 
                    customHeaders: provider.customHeaders,
                    autoCORSFix: provider.autoCORSFix,
                    apiFormat: provider.apiFormat,
                    catalogProvider: provider.catalogProvider,
                });
            } catch (e) {
                console.error("Fetch failed", e);
            }

            let modelsToShow: ModelConfig[] = [];

            // Build the new list from the server response.
            if (res && res.success && Array.isArray(res.models)) {
                const uniqueIds = new Set<string>();
                
                res.models.forEach((serverModel: ModelConfig) => {
                    if (!uniqueIds.has(serverModel.id)) {
                        uniqueIds.add(serverModel.id);
                        const isEnabled = localEnabledMap.get(serverModel.id) ?? true;
                        modelsToShow.push({ ...serverModel, enabled: isEnabled });
                    }
                });
            } else {
                // Fetch failed or no models returned: Fallback to local keys
                modelsToShow = (provider.availableModels || []).map(m => typeof m === 'string' ? { id: m, name: m, enabled: true } : m);
            }

            setModels(modelsToShow.sort((a, b) => a.name.localeCompare(b.name)));
            
        } catch (error) {
            console.error("Failed to initialize models", error);
            // Fallback
            setModels((provider.availableModels || []).map(m => typeof m === 'string' ? { id: m, name: m, enabled: true } : m));
        } finally {
            setIsFetching(false);
        }
    };

    const handleToggle = (id: string, checked: boolean) => {
        setModels(prev => prev.map(m => m.id === id ? { ...m, enabled: checked } : m));
    };

    const handleSelectAll = (checked: boolean) => {
        const visibleIds = new Set(filteredModels.map(m => m.id));
        setModels(prev => prev.map(m => visibleIds.has(m.id) ? { ...m, enabled: checked } : m));
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
           await onSave({ availableModels: models });
           onClose();
        } finally {
           setIsSaving(false);
        }
    };

    const filteredModels = useMemo(() => {
        return models.filter(m => 
            m.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
            m.id.toLowerCase().includes(searchTerm.toLowerCase())
        );
    }, [models, searchTerm]);

    const isAllSelected = filteredModels.length > 0 && filteredModels.every(m => m.enabled);
    const isIndeterminate = filteredModels.some(m => m.enabled) && !isAllSelected;

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Manage Models" width="max-w-xl">
            <div className="p-6 space-y-4">
                 <div className="flex items-center gap-2 bg-surface border border-border rounded-lg px-3 py-2">
                    <Search size={16} className="text-text-muted" />
                    <input 
                        type="text" 
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder="Search models..." 
                        className="bg-transparent border-none focus:outline-none text-sm w-full text-text-main placeholder-text-muted"
                    />
                 </div>

                 <div className="flex items-center justify-between text-sm">
                    <label className="flex items-center gap-2 cursor-pointer text-text-sec">
                        <input 
                            type="checkbox" 
                            checked={isAllSelected}
                            ref={input => { if (input) input.indeterminate = isIndeterminate; }}
                            onChange={(e) => handleSelectAll(e.target.checked)}
                            className="rounded border-border bg-background text-primary focus:ring-primary"
                        />
                        Select All
                    </label>
                    <span className="text-text-muted">{models.filter(m => m.enabled).length} / {models.length} enabled</span>
                 </div>

                 <div className="border border-border rounded-lg h-[300px] overflow-y-auto bg-background/50">
                    {isFetching && models.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-text-muted gap-2">
                            <Loader2 size={24} className="animate-spin" />
                            <span>Fetching models...</span>
                        </div>
                    ) : (
                        <div className="divide-y divide-border/50">
                            {filteredModels.map(model => (
                                <label key={model.id} className="flex items-center gap-3 p-3 hover:bg-surface-hover cursor-pointer transition-colors">
                                    <input 
                                        type="checkbox"
                                        checked={model.enabled}
                                        onChange={(e) => handleToggle(model.id, e.target.checked)}
                                        className="rounded border-border bg-background text-primary focus:ring-primary"
                                    />
                                    <div className="flex flex-col overflow-hidden">
                                        <span className="text-sm font-medium text-text-main truncate">{model.name}</span>
                                        {model.id !== model.name && <span className="text-xs text-text-muted truncate font-mono">{model.id}</span>}
                                    </div>
                                </label>
                            ))}
                            {filteredModels.length === 0 && !isFetching && (
                                <div className="p-8 text-center text-text-muted text-sm">
                                    No models found matching your search.
                                </div>
                            )}
                        </div>
                    )}
                 </div>

                 <div className="pt-4 flex justify-end gap-3 border-t border-border">
                    <button 
                       onClick={onClose}
                       className="px-4 py-2 text-sm text-text-muted hover:text-text-main transition-colors"
                    >
                        Cancel
                    </button>
                    <button 
                       onClick={handleSave}
                       disabled={isSaving}
                       className="px-4 py-2 bg-primary hover:opacity-90 text-primary-foreground rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                    >
                        {isSaving && <Loader2 size={14} className="animate-spin" />}
                        Save Changes
                    </button>
                 </div>
            </div>
        </Modal>
    );
}
