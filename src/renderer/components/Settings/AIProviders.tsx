import React, { useEffect, useState } from 'react';
import { Plus, Trash2, Edit2, RotateCw, CheckCircle2, AlertCircle, DownloadCloud, Bot } from 'lucide-react';
import { ProviderModal } from './ProviderModal';
import { ModelManagerModal } from './ModelManagerModal';
import { AIProvider, OAI_API_PROVIDERS } from '../../settings/ai-constants';
import { ICONS } from '../../settings/icons';

// Mock ipc invoke
const invoke = window.electron?.invoke || (async () => {});

import { CopilotAuthModal } from './CopilotAuthModal';

export function AIProviders() {
  const [providers, setProviders] = useState<AIProvider[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCopilotModalOpen, setIsCopilotModalOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<AIProvider | undefined>(undefined);
  const [managingModelsProvider, setManagingModelsProvider] = useState<AIProvider | undefined>(undefined);
  const [isCryptoUnlocked, setIsCryptoUnlocked] = useState(false);
  
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

  const handleSave = async (data: any) => {
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
      <div className="flex items-center justify-between">
        <div>
            <h3 className="text-xl font-semibold">AI Providers</h3>
            <p className="text-sm text-text-muted mt-1">Manage API connections for LLMs.</p>
        </div>
        <div className="flex gap-2">
             <button 
                onClick={() => setIsCopilotModalOpen(true)}
                className="flex items-center gap-2 px-3 py-2 bg-surface hover:bg-surface-light border border-border text-text-main rounded-lg text-sm transition-colors"
                title="Login with GitHub Copilot"
             >
                <div className="w-4 h-4 flex items-center justify-center text-text-main" dangerouslySetInnerHTML={{ __html: ICONS.copilot }} /> Add Copilot
             </button>
             <button 
                onClick={openAdd}
                className="flex items-center gap-2 px-3 py-2 bg-primary hover:opacity-90 text-primary-foreground rounded-lg text-sm transition-colors"
             >
                <Plus size={16} /> Add Provider
             </button>
        </div>
      </div>

      <div className="grid gap-2">
        {providers.map(provider => {
            // Find provider info by name OR matching endpoint
            const providerInfo = OAI_API_PROVIDERS.find(p => p.label === provider.name) || 
                                 OAI_API_PROVIDERS.find(p => p.baseUrl && provider.endpoint && p.baseUrl === provider.endpoint);
            
            const iconKey = providerInfo?.value;
            const iconSvg = iconKey && ICONS[iconKey];

            return (
                <div key={provider.id} className="bg-surface border border-border rounded-lg px-3 py-2 flex items-center justify-between group">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center text-accent shrink-0 overflow-hidden">
                             {iconSvg ? (
                                <div className="w-5 h-5" dangerouslySetInnerHTML={{ __html: iconSvg }} />
                             ) : (
                                <Bot size={18} />
                             )}
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                 <h4 className="font-medium text-text-main text-sm">{provider.name}</h4>
                                 {provider.isDefault && <span className="text-[10px] bg-green-900 text-green-300 px-1.5 rounded uppercase">Default</span>}
                            </div>
                            <p className="text-[10px] text-text-muted truncate max-w-[250px]">{provider.endpoint || OAI_API_PROVIDERS.find(p => p.value === 'openai')?.baseUrl}</p>
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
                     availableModels: ['gpt-4', 'gpt-3.5-turbo'], // Will likely be fetched later
                     endpoint: 'https://api.githubcopilot.com', // Base endpoint
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
