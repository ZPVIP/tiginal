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
  ipcMain.handle('chat:create-conversation', async (_event, providerId?: string): Promise<Conversation> => {
    return getChatService().createConversation(providerId);
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

  // Send message to AI
  ipcMain.handle('chat:send-message', async (_event, conversationId: string, providerId: string, content: string, specificModel?: string): Promise<{ response: string; error?: string }> => {
    const chatService = getChatService();
    const db = getDatabase().getDb();
    const crypto = getCrypto();

    // Get provider
    const provider = db.prepare(`
      SELECT id, name, type, endpoint, api_key_encrypted, model
      FROM ai_providers WHERE id = ?
    `).get(providerId) as {
      id: string;
      name: string;
      type: string;
      endpoint: string | null;
      api_key_encrypted: string | null;
      model: string;
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

      // Call AI API
      const response = await callAIAPI(
        provider.type as 'openai-compatible' | 'copilot',
        provider.endpoint || 'https://api.openai.com/v1',
        apiKey,
        modelToUse,
        messages.map((m: { role: string; content: string }) => ({ role: m.role, content: m.content }))
      );

      // Add assistant response to conversation
      chatService.addMessage(conversationId, 'assistant', response);

      // Generate title if this is the first response
      if (messages.length <= 2) {
        const firstUserMsg = messages.find(m => m.role === 'user');
        if (firstUserMsg) {
          const words = firstUserMsg.content.split(/\s+/).slice(0, 5).join(' ');
          const title = words.length > 30 ? words.slice(0, 30) + '...' : words;
          chatService.updateTitle(conversationId, title);
        }
      }

      return { response };
    } catch (error) {
      const errorMessage = (error as Error).message || 'Unknown error';
      return { response: '', error: errorMessage };
    }
  });
}

/**
 * Call AI API
 */
async function callAIAPI(
  type: 'openai-compatible' | 'copilot',
  endpoint: string,
  apiKey: string | null,
  model: string,
  messages: Array<{ role: string; content: string }>
): Promise<string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const response = await fetch(`${endpoint}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.7,
      max_tokens: 2000,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('No response from AI');
  }

  return content;
}
