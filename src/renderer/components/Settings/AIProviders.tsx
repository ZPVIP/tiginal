import React, { useEffect, useState } from 'react';
import { Plus, Trash2, Edit2, RotateCw, CheckCircle2, AlertCircle, DownloadCloud } from 'lucide-react';
import { ProviderModal } from './ProviderModal';
import { ModelManagerModal } from './ModelManagerModal';
import { AIProvider, OAI_API_PROVIDERS } from '../../settings/ai-constants';

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
      setProviders(list || []);
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
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
            <h3 className="text-xl font-semibold">AI Providers</h3>
            <p className="text-sm text-gray-400 mt-1">Manage API connections for LLMs.</p>
        </div>
        <div className="flex gap-2">
             <button 
                onClick={() => setIsCopilotModalOpen(true)}
                className="flex items-center gap-2 px-3 py-2 bg-surface hover:bg-surface-light border border-border text-gray-200 rounded-lg text-sm transition-colors"
                title="Login with GitHub Copilot"
             >
                <div className="w-4 h-4 rounded-full bg-white text-black flex items-center justify-center font-bold text-[10px]">G</div> Add Copilot
             </button>
             <button 
                onClick={openAdd}
                className="flex items-center gap-2 px-3 py-2 bg-primary hover:bg-blue-600 text-white rounded-lg text-sm transition-colors"
             >
                <Plus size={16} /> Add Provider
             </button>
        </div>
      </div>

      <div className="grid gap-4">
        {providers.map(provider => (
            <div key={provider.id} className="bg-surface border border-border rounded-lg p-4 flex items-center justify-between group">
                <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center text-accent">
                         {/* Icon based on type/name could go here */}
                         <div className="uppercase font-bold text-xs">{provider.name.substring(0, 2)}</div>
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                             <h4 className="font-medium text-gray-100">{provider.name}</h4>
                             {provider.isDefault && <span className="text-[10px] bg-green-900 text-green-300 px-1.5 rounded uppercase">Default</span>}
                        </div>
                        <p className="text-xs text-gray-400 mt-0.5">{provider.endpoint || OAI_API_PROVIDERS.find(p => p.value === 'openai')?.baseUrl}</p>
                    </div>
                </div>
                <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button 
                       onClick={() => openEdit(provider)}
                       className="p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                    >
                        <Edit2 size={16} />
                    </button>
                    <button 
                       onClick={() => setManagingModelsProvider(provider)}
                       className="p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                       title="Manage Models"
                    >
                        <DownloadCloud size={16} />
                    </button>
                    <button 
                       onClick={() => handleDelete(provider.id)}
                       className="p-2 text-gray-400 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
                    >
                        <Trash2 size={16} />
                    </button>
                </div>
            </div>
        ))}

        {providers.length === 0 && (
            <div className="text-center py-12 text-gray-500 bg-surface/50 rounded-lg border border-dashed border-border">
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
