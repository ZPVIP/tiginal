import React, { useEffect, useState } from 'react';
import { Plus, Trash2, Edit2, RotateCw, CheckCircle2, AlertCircle, DownloadCloud, Bot } from 'lucide-react';
import { ProviderModal } from './ProviderModal';
import { ModelManagerModal } from './ModelManagerModal';
import {
  AIProvider,
  ModelCatalogUpdateResult,
} from '../../settings/ai-constants';
import { ICONS } from '../../settings/icons';
import { ProviderLogo } from './ProviderLogo';

// Mock ipc invoke
const invoke = window.electron?.invoke || (async () => {});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseCatalogUpdate(value: unknown): ModelCatalogUpdateResult {
  if (!isRecord(value)) return { success: false, error: 'Invalid catalog update response' };
  return {
    success: value.success === true,
    ...(typeof value.error === 'string' ? { error: value.error } : {}),
    ...(typeof value.modelCount === 'number' ? { modelCount: value.modelCount } : {}),
    ...(typeof value.providerCount === 'number' ? { providerCount: value.providerCount } : {}),
    ...(typeof value.updatedAt === 'number' ? { updatedAt: value.updatedAt } : {}),
  };
}

import { CopilotAuthModal } from './CopilotAuthModal';
import { SettingsPageHeader } from './SettingsPageHeader';

export function AIProviders() {
  const [providers, setProviders] = useState<AIProvider[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCopilotModalOpen, setIsCopilotModalOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<AIProvider | undefined>(undefined);
  const [managingModelsProvider, setManagingModelsProvider] = useState<AIProvider | undefined>(undefined);
  const [isCryptoUnlocked, setIsCryptoUnlocked] = useState(false);
  const [isUpdatingCatalog, setIsUpdatingCatalog] = useState(false);
  const [catalogUpdate, setCatalogUpdate] = useState<ModelCatalogUpdateResult | null>(null);
  
  useEffect(() => {
    loadProviders();
    checkCrypto();
  }, []);

  const checkCrypto = async () => {
      const unlocked = await invoke('crypto:is-unlocked');
      setIsCryptoUnlocked(unlocked);
  };

  const loadProviders = async () => {
    try {
      const list = await invoke('ai:get-providers');
      const sorted = (list || []).sort((a: AIProvider, b: AIProvider) => a.name.localeCompare(b.name));
      setProviders(sorted);
    } catch (err) {
      console.error("Failed to load providers", err);
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm('Are you sure you want to delete this provider?')) {
      await invoke('ai:delete-provider', id);
      window.dispatchEvent(new Event('ai-providers-updated'));
      loadProviders();
    }
  };

  const handleSave = async (data: Partial<AIProvider>) => {
     if (editingProvider) {
         await invoke('ai:update-provider', { ...data, id: editingProvider.id });
     } else {
         await invoke('ai:add-provider', data);
     }
     setIsModalOpen(false);
     setEditingProvider(undefined);
     window.dispatchEvent(new Event('ai-providers-updated'));
     loadProviders();
  };

  const handleModelSave = async (data: Partial<AIProvider>) => {
      if (managingModelsProvider) {
          await invoke('ai:update-provider', { ...managingModelsProvider, ...data });
          setManagingModelsProvider(undefined);
          window.dispatchEvent(new Event('ai-providers-updated'));
          loadProviders();
      }
  };

  const openAdd = () => {
      setEditingProvider(undefined);
      setIsModalOpen(true);
  };

  const handleUpdateCatalog = async () => {
      setIsUpdatingCatalog(true);
      setCatalogUpdate(null);
      try {
          setCatalogUpdate(parseCatalogUpdate(await invoke('ai:update-model-catalog')));
      } catch (error) {
          setCatalogUpdate({
              success: false,
              error: error instanceof Error ? error.message : 'Could not update model catalog',
          });
      } finally {
          setIsUpdatingCatalog(false);
      }
  };

  const openEdit = async (provider: AIProvider) => {
      // If we have an encrypted key, we might want to fetch the decrypted one if unlocked
      let decryptedKey = '';
      if (provider.apiKeyEncrypted && isCryptoUnlocked) {
          decryptedKey = await invoke('ai:get-api-key', provider.id) || '';
      }

      setEditingProvider({
          ...provider,
          apiKey: decryptedKey 
      });
      setIsModalOpen(true);
  };

  return (
    <div className="space-y-4 animate-in fade-in duration-500">
      <SettingsPageHeader
        icon={<Bot size={24} />}
        title="AI Providers"
        actions={(
          <div className="flex gap-2">
             <button
                onClick={handleUpdateCatalog}
                disabled={isUpdatingCatalog}
                className="flex h-8 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm text-text-main transition-colors hover:bg-surface-light disabled:opacity-50"
                title={catalogUpdate?.success
                  ? `${catalogUpdate.modelCount || 0} models from ${catalogUpdate.providerCount || 0} providers cached locally`
                  : catalogUpdate?.error || 'Download the latest model metadata for provider setup'}
             >
                {catalogUpdate?.success
                  ? <CheckCircle2 size={15} className="text-accent-success" />
                  : catalogUpdate && !catalogUpdate.success
                    ? <AlertCircle size={15} className="text-accent-danger" />
                    : <RotateCw size={15} className={isUpdatingCatalog ? 'animate-spin' : ''} />}
                {isUpdatingCatalog ? 'Updating Catalog...' : 'Update Model Catalog'}
             </button>
             <button 
                onClick={() => setIsCopilotModalOpen(true)}
                className="flex h-8 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm text-text-main transition-colors hover:bg-surface-light"
                title="Login with GitHub Copilot"
             >
                <div className="w-4 h-4 flex items-center justify-center text-text-main" dangerouslySetInnerHTML={{ __html: ICONS.copilot }} /> Add Copilot
             </button>
             <button 
                onClick={openAdd}
                className="flex h-8 items-center gap-2 rounded-lg bg-primary px-3 text-sm text-primary-foreground transition-colors hover:opacity-90"
             >
                <Plus size={16} /> Add
             </button>
          </div>
        )}
      />

      <div className="grid gap-2">
        {providers.map(provider => {
            return (
                <div key={provider.id} className="bg-surface border border-border rounded-lg px-3 py-2 flex items-center justify-between group">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center text-accent shrink-0 overflow-hidden">
                             <ProviderLogo providerId={provider.catalogProvider} className="h-5 w-5" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                 <h4 className="font-medium text-text-main text-sm">{provider.name}</h4>
                                 {provider.isDefault && <span className="text-[10px] bg-green-900 text-green-300 px-1.5 rounded uppercase">Default</span>}
                            </div>
                            <p className="text-[10px] text-text-muted truncate max-w-[250px]">{provider.endpoint || 'No endpoint configured'}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button 
                           onClick={() => openEdit(provider)}
                           className="p-1.5 text-text-muted hover:text-text-main hover:bg-surface-hover rounded-lg transition-colors"
                        >
                            <Edit2 size={14} />
                        </button>
                        <button 
                           onClick={() => setManagingModelsProvider(provider)}
                           className="p-1.5 text-text-muted hover:text-accent-danger hover:bg-surface-hover rounded-lg transition-colors"
                           title="Manage Models"
                        >
                            <DownloadCloud size={14} />
                        </button>
                        <button 
                           onClick={() => handleDelete(provider.id)}
                           className="p-1.5 text-text-muted hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
                        >
                            <Trash2 size={14} />
                        </button>
                    </div>
                </div>
            );
        })}

        {providers.length === 0 && (
            <div className="text-center py-12 text-text-muted bg-surface/50 rounded-lg border border-dashed border-border">
                No providers configured. Click "Add Provider" to start.
            </div>
        )}
      </div>

      {isModalOpen && (
          <ProviderModal 
             isOpen={isModalOpen} 
             onClose={() => setIsModalOpen(false)}
             initialData={editingProvider}
             onSave={handleSave}
          />
      )}
      
      {managingModelsProvider && (
          <ModelManagerModal
              isOpen={!!managingModelsProvider}
              onClose={() => setManagingModelsProvider(undefined)}
              provider={managingModelsProvider}
              onSave={handleModelSave}
          />
      )}

      {isCopilotModalOpen && (
          <CopilotAuthModal 
             isOpen={isCopilotModalOpen}
             onClose={() => setIsCopilotModalOpen(false)}
             onSuccess={async (token) => {
                 await invoke('ai:add-provider', {
                     name: 'GitHub Copilot',
                     type: 'copilot', // MATCHES DB CONSTRAINT
                     apiKey: token, 
                     model: 'gpt-4', // Default model
                     availableModels: [
                         { id: 'gpt-4', name: 'gpt-4', enabled: true },
                         { id: 'gpt-3.5-turbo', name: 'gpt-3.5-turbo', enabled: true }
                     ],
                     endpoint: 'https://api.githubcopilot.com', // Base endpoint
                     apiFormat: 'chat-completions',
                     useMaxCompletionTokens: false,
                     isDefault: true
                 });
                 window.dispatchEvent(new Event('ai-providers-updated'));
                 loadProviders();
             }}
          />
      )}
    </div>
  );
}
