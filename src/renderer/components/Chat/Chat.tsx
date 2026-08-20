import React, { useState, useEffect, forwardRef, useImperativeHandle } from 'react';
import { MessageList } from './MessageList';
import { ChatInput, ChatInputHandle } from './ChatInput';
import { EmptyState } from './EmptyState';

import { AIProvider, ModelConfig } from '../../settings/ai-constants';
import { EyeOff, Trash2 } from 'lucide-react';

const invoke = (window as any).electron?.invoke || (async () => {});

export interface ChatHandle {
  loadConversation: (id: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  getCurrentConversationId: () => string | null;
  newChat: () => void;
  toggleIncognito: () => void;
}

interface ChatProps {
  onIncognitoChange?: (isIncognito: boolean) => void;
  onConversationChange?: (id: string | null) => void;
}

export const Chat = forwardRef<ChatHandle, ChatProps>(function Chat(props, ref) {
  const [messages, setMessages] = useState<any[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [providers, setProviders] = useState<AIProvider[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState<string>('');
  const [selectedModel, setSelectedModel] = useState<string>('');
  
  const [isLoading, setIsLoading] = useState(false);
  const [isIncognito, setIsIncognito] = useState(false);
  const [incognitoMessages, setIncognitoMessages] = useState<any[]>([]);

  // Tool call state
  // Tool call state
  const [allowAllTools, setAllowAllTools] = useState(false);

  useEffect(() => {
    loadProviders();
    
    const handleUpdate = () => loadProviders();
    window.addEventListener('ai-providers-updated', handleUpdate);

    // Streaming listeners
    // Streaming listeners
    const onChunk = (data: { conversationId: string, content?: string; reasoning?: string }) => {
        // console.log('Chunk received:', data);
        
        const updateMessages = (prev: any[]) => {
            if (prev.length === 0) return prev;
            const lastMsg = prev[prev.length - 1];
            
            if (lastMsg.role === 'assistant') {
                const newContent = lastMsg.content + (data.content || '');
                const newReasoning = (lastMsg.reasoning || '') + (data.reasoning || '');
                
                return [
                    ...prev.slice(0, prev.length - 1), 
                    { ...lastMsg, content: newContent, reasoning: newReasoning }
                ];
            } else {
                 // Fallback if no assistant msg found (rare due to placeholder)
                 return [...prev, { 
                     id: Date.now().toString(), 
                     role: 'assistant', 
                     content: data.content || '',
                     reasoning: data.reasoning || ''
                 }];
            }
        };

        if (currentConversationIdRef.current === data.conversationId) {
             setMessages(updateMessages);
        } else {
             if (isIncognitoRef.current) {
                 setIncognitoMessages(updateMessages);
             }
        }
    };

    const removeListener = (window as any).electron?.on('chat:chunk', onChunk);

    // Tool call listener
    const onToolCall = async (data: { conversationId: string; id: string; name: string; input: any }) => {
      console.log('Tool call received:', data);
      
      const analysis = (data as any).analysis;
      const needsPermission = analysis?.needsPermission;
      const shouldAutoRun = needsPermission === false || allowAllToolsRef.current;
      
      // Add persistent request message
      const requestMsg = {
          id: `req_${data.id}`,
          role: 'tool-request',
          content: '',
          approvalData: {
              id: data.id,
              name: data.name,
              command: data.name === 'Bash' ? data.input.command : JSON.stringify(data.input, null, 2),
              description: analysis?.description || data.input?.description || `Execute ${data.name}`,
              riskLevel: analysis?.riskLevel || (data.name === 'Bash' ? 'medium' : 'low'),
              status: shouldAutoRun ? 'auto-approved' : 'pending',
              skillPath: (data as any).skillPath
          }
      };
      
      setMessages(prev => [...prev, requestMsg]);

      // If auto-run, approve immediately
      if (shouldAutoRun) {
        try {
           await invoke('chat:submit-tool-approval', { 
               toolCallId: data.id, 
               approved: true, 
               approvedAll: allowAllToolsRef.current 
           });
        } catch (err) {
           console.error('Auto-approval failed', err);
        }
      }
    };
    
    // Tool Result listener
    const onToolResult = (data: { conversationId: string; toolName: string; result: string }) => {
        setMessages(prev => [...prev, {
            id: Date.now().toString(),
            role: 'tool',
            content: data.result
        }]);
    };

    // Stream complete listener - update last assistant message with token data
    const onStreamComplete = (data: { conversationId: string; tokenData: any }) => {
      const updateMessages = (prev: any[]) => {
        const newMsgs = [...prev];
        for (let i = newMsgs.length - 1; i >= 0; i--) {
          if (newMsgs[i].role === 'assistant') {
            newMsgs[i] = {
              ...newMsgs[i],
              providerId: data.tokenData.providerId,
              modelId: data.tokenData.modelId,
              promptTokens: data.tokenData.promptTokens,
              completionTokens: data.tokenData.completionTokens,
              reasoningTokens: data.tokenData.reasoningTokens,
              cachedTokens: data.tokenData.cachedTokens,
              totalTokens: data.tokenData.totalTokens,
              contextTokens: data.tokenData.contextTokens,
            };
            break;
          }
        }
        return newMsgs;
      };

      if (currentConversationIdRef.current === data.conversationId) {
        setMessages(updateMessages);
      } else if (isIncognitoRef.current) {
        setIncognitoMessages(updateMessages);
      }
    };

    // Title message listener - insert title message before the streaming assistant message
    const onTitleMessage = (data: { conversationId: string; message: any }) => {
      if (currentConversationIdRef.current === data.conversationId) {
        setMessages(prev => {
          const newMsgs = [...prev];
          // Insert before the last assistant message (the streaming one)
          for (let i = newMsgs.length - 1; i >= 0; i--) {
            if (newMsgs[i].role === 'assistant') {
              newMsgs.splice(i, 0, data.message);
              break;
            }
          }
          return newMsgs;
        });
      }
    };

    const removeToolListener = (window as any).electron?.on('chat:tool-call', onToolCall);
    const removeResultListener = (window as any).electron?.on('chat:tool-result', onToolResult);
    const removeStreamCompleteListener = (window as any).electron?.on('chat:stream-complete', onStreamComplete);
    const removeTitleMessageListener = (window as any).electron?.on('chat:title-message', onTitleMessage);

    return () => {
        window.removeEventListener('ai-providers-updated', handleUpdate);
        if (removeListener) removeListener();
        if (removeToolListener) removeToolListener();
        if (removeResultListener) removeResultListener();
        if (removeStreamCompleteListener) removeStreamCompleteListener();
        if (removeTitleMessageListener) removeTitleMessageListener();
    };
  }, []);

  // Refs for event listeners to access current state
  const currentConversationIdRef = React.useRef(currentConversationId);
  const isIncognitoRef = React.useRef(isIncognito);
  const allowAllToolsRef = React.useRef(allowAllTools);

  useEffect(() => {
      currentConversationIdRef.current = currentConversationId;
      isIncognitoRef.current = isIncognito;
      allowAllToolsRef.current = allowAllTools;
  }, [currentConversationId, isIncognito, allowAllTools]);

  // Notify parent when incognito state changes
  useEffect(() => {
      props.onIncognitoChange?.(isIncognito);
  }, [isIncognito]);

  // Notify parent when conversation ID changes (for drawer highlighting)
  useEffect(() => {
      props.onConversationChange?.(currentConversationId);
  }, [currentConversationId]);

  // Applying a chat profile rewrites the default provider/model in the DB
  useEffect(() => {
      const handleProfileApplied = () => { loadProviders(); };
      window.addEventListener('profile-applied', handleProfileApplied);
      return () => window.removeEventListener('profile-applied', handleProfileApplied);
  }, []);

  // Expose methods via ref for parent component
  useImperativeHandle(ref, () => ({
    loadConversation: async (id: string) => {
      setCurrentConversationId(id);
      try {
        const msgs = await invoke('chat:get-messages', id);
        setMessages(msgs || []);
      } catch (err) {
        console.error('Failed to load messages', err);
      }
    },
    deleteConversation: async (id: string) => {
      try {
        await invoke('chat:delete-conversation', id);
        if (currentConversationId === id) {
          setMessages([]);
          setCurrentConversationId(null);
        }
      } catch (err) {
        console.error('Failed to delete conversation', err);
      }
    },
    getCurrentConversationId: () => currentConversationId,
    newChat: () => {
      if (isIncognito) {
        setIncognitoMessages([]);
      } else {
        setMessages([]);
        setCurrentConversationId(null);
      }
    },
    toggleIncognito: () => {
      setIsIncognito(!isIncognito);
    },
  }), [currentConversationId, isIncognito]);

  const loadProviders = async () => {
    try {
      const list = await invoke('ai:get-providers');
      setProviders(list || []);
      
      const def = list.find((p: any) => p.isDefault) || list[0];
      if (def) {
          setSelectedProviderId(def.id);
          
          // Verify model exists in availableModels, else use first one
          let validModel = def.model;
          if (def.availableModels && def.availableModels.length > 0) {
             const mList = typeof def.availableModels[0] === 'string' 
                ? def.availableModels 
                : def.availableModels.map((m: any) => m.id);
             
             // Check if current default model is in the list
             if (!mList.includes(validModel)) {
                 // Not found, pick the first one (prefer enabled ones if object structure)
                 if (typeof def.availableModels[0] === 'object') {
                     const firstEnabled = def.availableModels.find((m: any) => m.enabled !== false);
                     validModel = firstEnabled ? firstEnabled.id : def.availableModels[0].id;
                 } else {
                     validModel = def.availableModels[0];
                 }
                 
                 // Optional: Auto-correct the DB for this drift? 
                 // Maybe not auto-save here, just correct the UI. 
                 // But user asked "remember... but now can't remember", implying we should be robust.
             }
          }
          
          setSelectedModel(validModel);
      }
    } catch (err) {
      console.error("Failed to load providers", err);
    }
  };

  const handleSend = async (text: string, images: string[], useSkills: boolean) => {
      if (!selectedProviderId) {
          alert("Please select a provider/model first.");
          return;
      }

      setIsLoading(true);
      
      // Prepare message content 
      let messageContent = text;
      // Note: Skills injection is now handled by backend via useSkills option

      // Attachments arrive as data URLs. Persist them under the workspace and
      // carry the paths from here on, so they survive a reload and reach the model.
      let imagePaths: string[] = [];
      if (images.length > 0) {
          try {
              imagePaths = await invoke('images:save', images) || [];
          } catch (e) {
              console.error('Failed to save attachments', e);
          }
      }

      // Add User Message
      const userMsg = { id: Date.now().toString(), role: 'user', content: text, images: imagePaths };
      
      // Add Placeholder Assistant Message
      const placeholderMsg = { id: (Date.now() + 1).toString(), role: 'assistant', content: '' };

      if (isIncognito) {
          setIncognitoMessages(prev => [...prev, userMsg, placeholderMsg]);

          try {
              const conv = await invoke('chat:create-conversation', selectedProviderId, true);
              // Force update ref for the transient conversation if needed, 
              // but actually we passed `true` so it creates a new one. 
              // We need to know this ID to match events?
              // The event listener checks `currentConversationIdRef`. 
              // BUT in incognito we don't set `currentConversationId`.
              // We need a way to know "this is the active streaming conversation".
              
              // Hack/Fix: For incognito, we just listen to ALL chunks if `isIncognitoRef` is true? 
              // Or better: temporary set currentConversationIdRef to this transient ID just for the stream logic?
              // But `currentConversationId` state drives the UI history selection.
              // Let's rely on `isIncognitoRef` check in `onChunk`.
              // We need to verify if the chunk belongs to valid incognito stream.
              
              // Pass a specialized param or just assume if incognito is open we update it.
              // The `onChunk` logic I wrote above blindly updates `setIncognitoMessages` if `isIncognitoRef` is true
              // and `currentConversationId` mismatch.
              // This should work for single active stream.
              
              // However, `chat:send-message` needs `conv.id`.
              // We need to make sure the event includes this ID (it does).
              // Since we don't store transient ID in state, we can't match it easily unless we store it.
              // Let's store "activeStreamingId" ref?
              

              activeStreamingId.current = conv.id;

              await invoke('chat:send-message', conv.id, selectedProviderId, messageContent, selectedModel, { 
                  useSkills,
                  images: imagePaths
              });
              
              await invoke('chat:delete-conversation', conv.id);
          } catch (err) {
              setIncognitoMessages(prev => {
                  const newMsgs = [...prev];
                  const last = newMsgs[newMsgs.length - 1];
                  if (last.role === 'assistant') {
                       last.content += `\n[Error: ${(err as Error).message}]`;
                  }
                  return newMsgs;
              });
          } finally {
              setIsLoading(false);
              activeStreamingId.current = null;
          }
          return;
      }

      // Normal Mode
      let convId = currentConversationId;
      if (!convId) {
          try {
              const conv = await invoke('chat:create-conversation', selectedProviderId);
              convId = conv.id;
              setCurrentConversationId(conv.id);
              // Notify drawer to refresh and show the new conversation
              window.dispatchEvent(new CustomEvent('drawer-refresh'));
          } catch (e) {
              console.error("Failed to create conv", e);
              setIsLoading(false);
              return;
          }
      }

      setMessages(prev => [...prev, userMsg, placeholderMsg]);
      activeStreamingId.current = convId!;

      try {
          await invoke('chat:send-message', convId, selectedProviderId, messageContent, selectedModel, { 
              useSkills,
              images: imagePaths
          });
      } catch (err) {
          setMessages(prev => {
              const newMsgs = [...prev];
              const last = newMsgs[newMsgs.length - 1];
              if (last.role === 'assistant') {
                   last.content += `\n[Error: ${(err as Error).message}]`;
              }
              return newMsgs;
          });
      } finally {
          setIsLoading(false);
          activeStreamingId.current = null;
      }
  };
  
  const activeStreamingId = React.useRef<string | null>(null);

  // Stop streaming handler
  const handleStopStream = async () => {
    if (activeStreamingId.current) {
      try {
        await invoke('chat:stop-stream', activeStreamingId.current);
      } catch (err) {
        console.error('Failed to stop stream:', err);
      }
    }
    setIsLoading(false);
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
                  // Check if this model is actually enabled in the provider's list
                  let isEnabled = true;
                  if (p.availableModels && p.availableModels.length > 0) {
                      const modelObj = p.availableModels.find((m: any) => 
                          (typeof m === 'string' ? m : m.id) === p.model
                      );
                      if (modelObj && typeof modelObj !== 'string' && modelObj.enabled === false) {
                          isEnabled = false;
                      }
                      // If modelObj not found in available list, treat as disabled/invalid? 
                      // Or keep compatible? 
                      // If available list exists but model not in it -> invalid/disabled.
                      if (!modelObj) isEnabled = false;
                  }
                  
                  if (isEnabled) {
                      list.push({
                          providerId: p.id,
                          modelId: p.model,
                          label: `${p.name} / ${p.model}`
                      });
                  }
              }
          }
     });
     return list;
  }, [providers]);

  // Validate selection when model list changes
  React.useEffect(() => {
      // If list is empty, clear selection
      if (allModels.length === 0) {
          if (selectedProviderId || selectedModel) {
              setSelectedProviderId('');
              setSelectedModel('');
          }
          return;
      }

      // Check if current selection is valid
      const isValid = allModels.some(m => m.providerId === selectedProviderId && m.modelId === selectedModel);

      if (!isValid && providers.length > 0) {
           // Not valid! Need to find a fallback.
           let newPId = '';
           let newMId = '';

           // 1. Try to find the default provider (flagged in DB)
           const defProvider = providers.find(p => p.isDefault);
           if (defProvider) {
               // Is there any valid model for this provider in our list?
               const validModelForDef = allModels.find(m => m.providerId === defProvider.id);
               if (validModelForDef) {
                   newPId = validModelForDef.providerId;
                   newMId = validModelForDef.modelId;
               }
           }

           // 2. If no valid default provider model found, pick the very first available one
           if (!newPId && allModels.length > 0) {
               newPId = allModels[0].providerId;
               newMId = allModels[0].modelId;
           }

           if (newPId && newMId) {
               setSelectedProviderId(newPId);
               setSelectedModel(newMId);
               
               // Persist this auto-correction so it sticks
               invoke('chat:set-last-model', { providerId: newPId, model: newMId }).catch(console.error);
           }
      }
  }, [allModels, providers, selectedProviderId, selectedModel]);

  const handleModelSelect = (value: string) => {
      // Value format: "providerId:modelId" to ensure uniqueness
      const [pId, ...mIdParts] = value.split(':');
      const mId = mIdParts.join(':'); // Handle case where model ID has colons
      
      setSelectedProviderId(pId);
      setSelectedModel(mId);
      
      // Persist choice (optional, or rely on Header persistence)
      invoke('chat:set-last-model', { providerId: pId, model: mId }).catch(console.error);

      // Let the drawer know the active profile no longer matches the live settings
      window.dispatchEvent(new Event('model-changed'));
  };


  // Determine which messages to show
  const displayMessages = isIncognito ? incognitoMessages : messages;

  // Handle edit message
  const chatInputRef = React.useRef<ChatInputHandle>(null);
  
  const handleEditMessage = (content: string) => {
      if (chatInputRef.current) {
          chatInputRef.current.setText(content);
          chatInputRef.current.focus();
      }
  };

        const handleApproval = async (id: string, decision: 'approved' | 'denied' | 'always') => {
      // 1. Update UI state immediately
      setMessages(prev => prev.map(msg => {
          // Check if this is the message corresponding to the tool call
          // Actually, `id` passed from logic is usually the toolCallId.
          // But our message ID is `req_${toolCallId}`. 
          // The ToolApprovalRequest onAllow calls `onApproval(msg.id, ...)`.
          // So `id` here IS the message ID.
          if (msg.id === id && msg.role === 'tool-request' && msg.approvalData) {
               return {
                   ...msg,
                   approvalData: {
                       ...msg.approvalData,
                       status: decision === 'always' ? 'approved' : decision
                   }
               };
          }
          return msg;
      }));

      // 2. Extract toolCallId from message ID (strip 'req_')
      const toolCallId = id.replace('req_', '');
      
      // 3. Handle Allow All
      if (decision === 'always') {
          setAllowAllTools(true);
      }

      // 4. Call Backend
      try {
          await invoke('chat:submit-tool-approval', { 
              toolCallId, 
              approved: decision === 'approved' || decision === 'always', 
              approvedAll: decision === 'always' 
          });
      } catch (err) {
          console.error('Tool approval submission failed', err);
      }
  };

  // How full the context is right now: the newest turn that reported its size.
  // Accumulated prompt tokens would over-report once tools add extra turns.
  const contextUsed = React.useMemo(() => {
    const list = isIncognito ? incognitoMessages : messages;
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i]?.contextTokens > 0) return list[i].contextTokens as number;
    }
    return 0;
  }, [messages, incognitoMessages, isIncognito]);

  return (
    <div className="flex h-full w-full flex-col bg-background relative">
      {/* Incognito Warning Bar */}
      {isIncognito && (
          <div className="flex items-center justify-between px-4 py-2 bg-purple-900/30 border-b border-purple-700/50 text-sm">
              <div className="flex items-center gap-2 text-purple-300">
                  <EyeOff size={16} />
                  <span>Incognito Mode - Messages will not be saved</span>
              </div>
              <button 
                 onClick={handleClearIncognito}
                 className="flex items-center gap-1 text-purple-400 hover:text-purple-200 px-2 py-1 hover:bg-surface-hover rounded transition-colors"
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
          <MessageList 
            messages={displayMessages} 
            isStreaming={isLoading} 
            onEdit={handleEditMessage}
            onApproval={handleApproval}
          />
      )}

      <ChatInput 
        ref={chatInputRef}
        onSend={handleSend} 
        onStop={handleStopStream}
        disabled={isLoading}
        isStreaming={isLoading}
        models={allModels}
        selectedProviderId={selectedProviderId}
        selectedModel={selectedModel}
        onModelSelect={(pId, mId) => handleModelSelect(`${pId}:${mId}`)}
        contextUsed={contextUsed}
      />
    </div>
  );
});
