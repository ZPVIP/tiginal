import React, { useState, useEffect } from 'react';
import { Header } from './Header';
import { MessageList } from './MessageList';
import { ChatInput } from './ChatInput';
import { EmptyState } from './EmptyState';
import { HistoryPanel } from './HistoryPanel';
import { AIProvider, ModelConfig } from '../../settings/ai-constants';
import { EyeOff, Trash2 } from 'lucide-react';

const invoke = window.electron?.invoke || (async () => {});

export function Chat() {
  const [messages, setMessages] = useState<any[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [providers, setProviders] = useState<AIProvider[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState<string>('');
  const [selectedModel, setSelectedModel] = useState<string>('');
  
  const [isLoading, setIsLoading] = useState(false);
  const [isIncognito, setIsIncognito] = useState(false);
  const [incognitoMessages, setIncognitoMessages] = useState<any[]>([]);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  useEffect(() => {
    loadProviders();
  }, []);

  const loadProviders = async () => {
    try {
      const list = await invoke('ai:get-providers');
      setProviders(list || []);
      
      const def = list.find((p: any) => p.isDefault) || list[0];
      if (def) {
          setSelectedProviderId(def.id);
          setSelectedModel(def.model);
      }
    } catch (err) {
      console.error("Failed to load providers", err);
    }
  };

  const handleSend = async (text: string, images: string[], useSearch: boolean) => {
      // ... (rest of handleSend logic is fine, omitted for brevity if not changing) ...
      if (!selectedProviderId) {
          alert("Please select a provider/model first.");
          return;
      }

      setIsLoading(true);

      if (isIncognito) {
          // Incognito mode - don't persist
          const userMsg = { id: Date.now().toString(), role: 'user', content: text, images };
          setIncognitoMessages(prev => [...prev, userMsg]);

          try {
              // Create a transient conversation (will be deleted after)
              const conv = await invoke('chat:create-conversation', selectedProviderId, true);
              const res = await invoke('chat:send-message', conv.id, selectedProviderId, text, selectedModel);
              
              if (res.error) {
                  setIncognitoMessages(prev => [...prev, { id: Date.now().toString(), role: 'assistant', content: `Error: ${res.error}` }]);
              } else {
                  setIncognitoMessages(prev => [...prev, { id: Date.now().toString(), role: 'assistant', content: res.response }]);
              }
              
              // Delete transient conversation
              await invoke('chat:delete-conversation', conv.id);
          } catch (err) {
              setIncognitoMessages(prev => [...prev, { id: Date.now().toString(), role: 'assistant', content: `Error: ${(err as Error).message}` }]);
          } finally {
              setIsLoading(false);
          }
          return;
      }

      // Normal mode
      let convId = currentConversationId;
      if (!convId) {
          try {
              const conv = await invoke('chat:create-conversation', selectedProviderId);
              convId = conv.id;
              setCurrentConversationId(conv.id);
          } catch (e) {
              console.error("Failed to create conv", e);
              setIsLoading(false);
              return;
          }
      }

      const userMsg = { id: Date.now().toString(), role: 'user', content: text, images };
      setMessages(prev => [...prev, userMsg]);

      try {
          const res = await invoke('chat:send-message', convId, selectedProviderId, text, selectedModel);
          
          if (res.error) {
              setMessages(prev => [...prev, { id: Date.now().toString(), role: 'assistant', content: `Error: ${res.error}` }]);
          } else {
              setMessages(prev => [...prev, { id: Date.now().toString(), role: 'assistant', content: res.response }]);
          }
      } catch (err) {
          setMessages(prev => [...prev, { id: Date.now().toString(), role: 'assistant', content: `Error: ${(err as Error).message}` }]);
      } finally {
          setIsLoading(false);
      }
  };



  const handleNewChat = () => {
      if (isIncognito) {
          setIncognitoMessages([]);
      } else {
          setMessages([]);
          setCurrentConversationId(null);
      }
  };

  const handleIncognitoToggle = () => {
      // Just toggle view, don't clear anything
      setIsIncognito(!isIncognito);
  };

  const handleClearIncognito = () => {
      setIncognitoMessages([]);
  };

  const handleSelectConversation = async (id: string) => {
      setIsHistoryOpen(false);
      setCurrentConversationId(id);
      
      try {
          const msgs = await invoke('chat:get-messages', id);
          setMessages(msgs || []);
      } catch (err) {
          console.error("Failed to load messages", err);
      }
  };

  const allModels = React.useMemo(() => {
     const list: { providerId: string; modelId: string; label: string }[] = [];
     
     providers.forEach(p => {
         let hasDefault = false;
         // Add models from availableModels
         if (p.availableModels && p.availableModels.length > 0) {
             p.availableModels.forEach(m => {
                 const mObj = typeof m === 'string' ? { id: m, name: m, enabled: true } : m;
                 if (mObj.enabled !== false) {
                     list.push({
                         providerId: p.id,
                         modelId: mObj.id, // Correctly use ID
                         label: `${p.name} / ${mObj.name}`
                     });
                     if (mObj.id === p.model) hasDefault = true;
                 }
             });
         } 
         
         // Ensure default model is in the list if not found above
         if (p.model && !hasDefault) {
             // Avoid duplicates if valid models list was empty but model existed
             // Check if it's already in list (for this provider)
             const alreadyIn = list.some(x => x.providerId === p.id && x.modelId === p.model);
             if (!alreadyIn) {
                 list.push({
                     providerId: p.id,
                     modelId: p.model,
                     label: `${p.name} / ${p.model} (Default)`
                 });
             }
         }
     });
     return list;
  }, [providers]);

  // Handle default selection if nothing selected
  React.useEffect(() => {
      if (!selectedProviderId && allModels.length > 0) {
          // Select the first one (which should be the default provider's model due to sorting)
          setSelectedProviderId(allModels[0].providerId);
          setSelectedModel(allModels[0].modelId);
      }
  }, [allModels, selectedProviderId]);

  const handleModelSelect = (value: string) => {
      // Value format: "providerId:modelId" to ensure uniqueness
      const [pId, ...mIdParts] = value.split(':');
      const mId = mIdParts.join(':'); // Handle case where model ID has colons
      
      setSelectedProviderId(pId);
      setSelectedModel(mId);
      
      // Persist choice (optional, or rely on Header persistence)
      invoke('chat:set-last-model', { providerId: pId, model: mId }).catch(console.error);
  };


  // Determine which messages to show
  const displayMessages = isIncognito ? incognitoMessages : messages;

  return (
    <div className="flex h-full w-full flex-col bg-background relative">
      <Header 
         currentValue={selectedProviderId && selectedModel ? `${selectedProviderId}:${selectedModel}` : ''}
         models={allModels.map(m => ({ value: `${m.providerId}:${m.modelId}`, label: m.label }))}
         onModelChange={handleModelSelect}
         onNewChat={handleNewChat}
         onHistory={() => setIsHistoryOpen(true)} 
         onIncognitoToggle={handleIncognitoToggle}
         isIncognito={isIncognito}
      />
      
      {/* Incognito Warning Bar */}
      {isIncognito && (
          <div className="flex items-center justify-between px-4 py-2 bg-purple-900/30 border-b border-purple-700/50 text-sm">
              <div className="flex items-center gap-2 text-purple-300">
                  <EyeOff size={16} />
                  <span>Incognito Mode - Messages will not be saved</span>
              </div>
              <button 
                 onClick={handleClearIncognito}
                 className="flex items-center gap-1 text-purple-400 hover:text-purple-200 px-2 py-1 hover:bg-white/5 rounded transition-colors"
                 title="Clear Incognito Chat"
              >
                  <Trash2 size={14} />
                  <span>Clear</span>
              </button>
          </div>
      )}
      
      {displayMessages.length === 0 ? (
          <EmptyState 
             models={allModels.map(m => ({ value: `${m.providerId}:${m.modelId}`, label: m.label }))}
             selectedModel={selectedProviderId && selectedModel ? `${selectedProviderId}:${selectedModel}` : ''}
             onModelSelect={handleModelSelect}
          />
      ) : (
          <MessageList messages={displayMessages} isStreaming={isLoading} />
      )}

      <ChatInput onSend={handleSend} disabled={isLoading} />

      {/* History Panel */}
      <HistoryPanel 
         isOpen={isHistoryOpen}
         onClose={() => setIsHistoryOpen(false)}
         onSelectConversation={handleSelectConversation}
      />
    </div>
  );
}
