import React, { useState, useEffect, useRef } from 'react';
import { Header } from './Header';
import { MessageList } from './MessageList';
import { ChatInput } from './ChatInput';
import { EmptyState } from './EmptyState';
import { AIProvider } from '../Settings/ProviderModal'; // Fix import source

// Mock invoke
const invoke = window.electron?.invoke || (async () => {});

export function Chat() {
  const [messages, setMessages] = useState<any[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [providers, setProviders] = useState<AIProvider[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState<string>('');
  const [selectedModel, setSelectedModel] = useState<string>('');
  
  const [isLoading, setIsLoading] = useState(false);

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
      if (!selectedProviderId) {
          alert("Please select a provider/model first.");
          return;
      }

      setIsLoading(true);

      // 1. Create conversation if needed
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

      // 2. Add local user message
      const userMsg = {
          id: Date.now().toString(),
          role: 'user',
          content: text,
          images
      };
      setMessages(prev => [...prev, userMsg]);

      // 3. Send to backend
      try {
          const res = await invoke('chat:send-message', convId, selectedProviderId, text, selectedModel);
          
          if (res.error) {
              setMessages(prev => [...prev, {
                  id: Date.now().toString(),
                  role: 'assistant',
                  content: `Error: ${res.error}`
              }]);
          } else {
              setMessages(prev => [...prev, {
                  id: Date.now().toString(),
                  role: 'assistant',
                  content: res.response
              }]);
          }
      } catch (err) {
          setMessages(prev => [...prev, {
              id: Date.now().toString(),
              role: 'assistant',
              content: `Error: ${(err as Error).message}`
          }]);
      } finally {
          setIsLoading(false);
      }
  };

  const handleClear = () => {
      setMessages([]);
      setCurrentConversationId(null);
  };

  // Derived models list for Header
  const activeProvider = providers.find(p => p.id === selectedProviderId);
  const rawModels: any[] = activeProvider?.availableModels && activeProvider.availableModels.length > 0 
      ? activeProvider.availableModels 
      : (activeProvider ? [activeProvider.model] : []);

  // Fix React Error #31: Ensure models are strings, not objects
  const availableModels = rawModels.map(m => {
      if (typeof m === 'string') return m;
      if (typeof m === 'object' && m.name) return m.name;
      return 'Unknown Model';
  });

  // Handle model change (might need to switch provider if logic requires, but here we switch model within provider or just model string)
  const handleModelChange = (m: string) => {
      setSelectedModel(m);
  };

  return (
    <div className="flex h-full w-full flex-col bg-background relative">
      <Header 
         model={selectedModel}
         models={availableModels}
         onModelChange={handleModelChange}
         onClear={handleClear}
         onHistory={() => {}} 
         onSettings={() => {}}
      />
      
      {messages.length === 0 ? (
          <EmptyState 
             models={availableModels} 
             selectedModel={selectedModel}
             onModelSelect={handleModelChange}
          />
      ) : (
          <MessageList messages={messages} isStreaming={isLoading} />
      )}

      <ChatInput onSend={handleSend} disabled={isLoading} />
    </div>
  );
}
