import { ipcMain } from 'electron';
import { getDatabase } from '../services/database/database';
import { getCrypto } from '../services/ssh/CryptoService';
import { getChatService, Conversation, Message } from '../services/ai/ChatService';

interface AIProvider {
  id: string;
  name: string;
  type: 'openai-compatible' | 'copilot';
  endpoint?: string;
  model: string;
}


import { getCopilotToken } from './services/ai/CopilotAuthService';

/**
 * Setup Chat-related IPC handlers
 */
export function setupChatHandlers(): void {
  // Get all conversations
  ipcMain.handle('chat:get-conversations', async (): Promise<Conversation[]> => {
    return getChatService().getAllConversations();
  });

  // Get messages for a conversation
  ipcMain.handle('chat:get-messages', async (_event, conversationId: string): Promise<Message[]> => {
    return getChatService().getMessages(conversationId);
  });

  // Create new conversation
  ipcMain.handle('chat:create-conversation', async (_event, providerId?: string, isTransient: boolean = false): Promise<Conversation> => {
    return getChatService().createConversation(providerId, isTransient);
  });

  // Add message
  ipcMain.handle('chat:add-message', async (
    _event, 
    conversationId: string, 
    role: 'user' | 'assistant' | 'system', 
    content: string
  ): Promise<Message> => {
    return getChatService().addMessage(conversationId, role, content);
  });

  // Delete conversation
  ipcMain.handle('chat:delete-conversation', async (_event, id: string): Promise<void> => {
    getChatService().deleteConversation(id);
  });

  // Update conversation title
  ipcMain.handle('chat:update-title', async (_event, id: string, title: string): Promise<void> => {
    getChatService().updateTitle(id, title);
  });

  // Set last used model for a provider
  ipcMain.handle('chat:set-last-model', async (_event, { providerId, model }: { providerId: string; model: string }): Promise<void> => {
      const db = getDatabase().getDb();
      
      // Use transaction to atomically update model and default status
      const update = db.transaction(() => {
          // Clear existing default
          db.prepare('UPDATE ai_providers SET is_default = 0').run();
          // Update the model for this provider so it sticks, and make it default
          db.prepare('UPDATE ai_providers SET model = ?, is_default = 1 WHERE id = ?').run(model, providerId);
      });
      
      update();
  });

  // Send message to AI
  ipcMain.handle('chat:send-message', async (_event, conversationId: string, providerId: string, content: string, specificModel?: string): Promise<{ response: string; error?: string }> => {
    const chatService = getChatService();
    const db = getDatabase().getDb();
    const crypto = getCrypto();

    // Get provider
    const provider = db.prepare(`
      SELECT id, name, type, endpoint, api_key_encrypted, model, custom_headers, auto_cors_fix
      FROM ai_providers WHERE id = ?
    `).get(providerId) as {
      id: string;
      name: string;
      type: string;
      endpoint: string | null;
      api_key_encrypted: string | null;
      model: string;
      custom_headers: string | null;
      auto_cors_fix: number | null;
    } | undefined;

    if (!provider) {
      return { response: '', error: 'Provider not found' };
    }

    // Add user message to conversation
    chatService.addMessage(conversationId, 'user', content);

    // Get conversation history
    const messages = chatService.getMessages(conversationId);

    // Get API key
    let apiKey: string | null = null;
    if (provider.api_key_encrypted && crypto.isUnlocked()) {
      try {
        apiKey = crypto.decrypt(provider.api_key_encrypted);
      } catch {
        // Key decryption failed
      }
    }

    try {
      // Determine model to use
      const modelToUse = specificModel || provider.model;

      // Parse custom headers
      const customHeaders = provider.custom_headers ? JSON.parse(provider.custom_headers) : {};

      // Call AI API
      // Call AI API with streaming
      let fullResponse = '';
      
          // Notify client that stream is starting (optional, but good for UI state)
      // _event.sender.send('chat:start', { conversationId });

      try {
        await streamAIAPI(
          provider.type as 'openai-compatible' | 'copilot',
          provider.endpoint || 'https://api.openai.com/v1',
          apiKey,
          modelToUse,
          messages.map((m: { role: string; content: string }) => ({ role: m.role, content: m.content })),
          customHeaders,
          provider.auto_cors_fix === 1,
          (chunkData) => {
             if (chunkData.content) fullResponse += chunkData.content;
             _event.sender.send('chat:chunk', { conversationId, ...chunkData });
          }
        );
      } catch (streamErr) {
         return { response: fullResponse, error: (streamErr as Error).message };
      }

      // Add assistant response to conversation
      // Note: We might want to save reasoning too if we want to persist it, but current DB/Service might only support content
      // For now, we just save the final full content. Reasoning is transient in UI unless we persist it.
      // IF we want to save reasoning, we need to accumulate it too.
      // Let's stick to saving content for now to minimize DB changes, or just append reasoning?
      // Usually reasoning is separated. Let's assume standard behavior is just saving content.
      
      chatService.addMessage(conversationId, 'assistant', fullResponse); // we only save content to DB for now

      // Generate title if this is the first response
      if (messages.length <= 2) {
        const firstUserMsg = messages.find(m => m.role === 'user');
        if (firstUserMsg) {
          const words = firstUserMsg.content.split(/\s+/).slice(0, 5).join(' ');
          const title = words.length > 30 ? words.slice(0, 30) + '...' : words;
          chatService.updateTitle(conversationId, title);
        }
      }

      return { response: fullResponse };
    } catch (error) {
      const errorMessage = (error as Error).message || 'Unknown error';
      return { response: '', error: errorMessage };
    }
  });
}

/**
 * Stream AI API
 */
async function streamAIAPI(
  type: 'openai-compatible' | 'copilot',
  endpoint: string,
  apiKey: string | null,
  model: string,
  messages: Array<{ role: string; content: string }>,
  customHeaders: Record<string, string> = {},
  autoCORSFix: boolean = true,
  onChunk: (data: { content?: string; reasoning?: string }) => void
): Promise<void> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...customHeaders
  };

  if (type === 'copilot' && apiKey) {
      // If endpoint is missing or is the default OpenAI endpoint, use the official Copilot endpoint.
      // We check for 'api.openai.com' to catch the default value often set by the UI.
      // We DO NOT unconditionally set this, because we want to allow custom endpoints for GitHub Enterprise.
      if (!endpoint || endpoint.includes('api.openai.com')) {
           endpoint = 'https://api.githubcopilot.com'; 
      }

      try {
          // Exchange OAuth token for API token
          const copilotToken = await getCopilotToken(apiKey);
          headers['Authorization'] = `Bearer ${copilotToken}`;
          // Add required Copilot headers
          headers['Authorization'] = `Bearer ${copilotToken}`;
          // Add required Copilot headers to match opencode-copilot-auth
          headers['Copilot-Integration-Id'] = 'vscode-chat';
          headers['Editor-Version'] = 'vscode/1.107.0'; 
          headers['Editor-Plugin-Version'] = 'copilot-chat/0.35.0';
          headers['User-Agent'] = 'GitHubCopilotChat/0.35.0'; 
          headers['Openai-Intent'] = 'conversation-edits';
      } catch (err) {
          console.error("Copilot Token Exchange Failed", err);
          throw err;
      }
  } else if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  // Auto CORS fix simulation
  if (autoCORSFix) {
    try {
      // For Copilot, we might not need this or it might break it, but let's keep it safe
      const url = new URL(endpoint);
      headers['Origin'] = url.origin;
    } catch (e) {
      // invalid url
    }
  }

  const bodyPayload = {
    model,
    messages,
    temperature: 0.7,
    max_tokens: 4000,
    stream: true
  };

  if (process.env.NODE_ENV !== 'production') {
      console.log('--- AI Request Debug ---');
      console.log('URL:', `${endpoint}/chat/completions`);
      const safeHeaders = { ...headers };
      if (safeHeaders['Authorization']) safeHeaders['Authorization'] = 'Bearer sk-xxx';
      console.log('Headers:', safeHeaders);
      console.log('Body:', JSON.stringify(bodyPayload, null, 2));
      console.log('------------------------');
  }

  const response = await fetch(`${endpoint}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(bodyPayload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`AI API Error: ${response.status} - ${errorText}`);

    // Handle specific Copilot "model not supported" error
    if (type === 'copilot' && response.status === 400) {
        try {
            const errorJson = JSON.parse(errorText);
            if (errorJson.error?.code === 'model_not_supported') {
                 const friendlyMessage = 
                    ` **GitHub Copilot Error: Model Not Supported**\n` +
                    `\n` +
                    `The requested model is not available. This is usually because:\n` +
                    `\n` +
                    `- You may not have a GitHub Copilot Pro subscription.\n` +
                    `- Your organization's policy settings might be restricting this model.\n` +
                    `\n` +
                    `Please check your settings: [https://github.com/settings/copilot/features](https://github.com/settings/copilot/features)`;
                 
                 onChunk({ content: friendlyMessage });
                 return;
            }
        } catch (e) {
            // ignore JSON parse error, throw original text
        }
    }

    // Handle generic errors
    let errorMessage = errorText;
    try {
        const errorJson = JSON.parse(errorText);
        if (errorJson.error?.message) {
            errorMessage = errorJson.error.message;
        } else if (errorJson.error) {
            errorMessage = JSON.stringify(errorJson.error); 
        }
    } catch (e) {
        // use raw text
    }

    const genericErrorMsg = 
        `> **AI Provider Error (${response.status})**\n` +
        `>\n` +
        `> ${errorMessage}`;

    onChunk({ content: genericErrorMsg });
    return;
  }

  if (!response.body) {
     throw new Error('No response body for stream');
  }

  console.log(`Stream started. Status: ${response.status}, Type: ${response.headers.get('content-type')}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  try {
    while (true) {
        const { done, value } = await reader.read();
        if (done) {
            console.log('Stream done signal received.');
            break;
        }

        const chunkText = decoder.decode(value, { stream: true });
        console.log(`Received chunk (${value.length} bytes):`, chunkText); 
        buffer += chunkText;
        
        // Process buffer line by line
        const lines = buffer.split('\n');
        buffer = lines.pop() || "";  

        for (const line of lines) {
           processLine(line, onChunk);
        }
    }
    
    // Process remaining buffer
    if (buffer.trim()) {
        processLine(buffer, onChunk);
    }

  } catch (err) {
      console.error('Stream read error:', err);
      throw err;
  }
}

function processLine(line: string, onChunk: (data: { content?: string; reasoning?: string }) => void) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === "data: [DONE]") return;
    
    if (trimmed.startsWith("data: ")) {
        const jsonStr = trimmed.substring(6);
        try {
            const data = JSON.parse(jsonStr);
            const delta = data.choices?.[0]?.delta;
            if (delta) {
                const content = delta.content;
                const reasoning = delta.reasoning;
                
                if (content || reasoning) {
                   onChunk({ content, reasoning });
                }
            }
        } catch (e) {
            console.warn("Failed to parse SSE line", trimmed, e);
        }
    } else {
        console.log("Ignored line (not SSE):", trimmed);
        // Attempt to parse as standard JSON error
        try {
            const data = JSON.parse(trimmed);
            if (data.error) {
                console.error("API returned JSON error in stream:", data.error);
                onChunk({ content: `[Error: ${data.error.message || JSON.stringify(data.error)}]` });
            } else if (data.choices?.[0]?.message?.content) {
                // Maybe it rolled back to non-streaming response?
                onChunk({ content: data.choices[0].message.content });
            }
        } catch (ignore) {}
    }
}
