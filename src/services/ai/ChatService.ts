import { getDatabase } from '../database/database';
import { getCrypto } from '../ssh/CryptoService';

export interface Conversation {
  id: string;
  title: string | null;
  providerId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Message {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: number;
}

/**
 * Chat service for managing conversations and messages
 */
export class ChatService {
  /**
   * Create a new conversation
   */
  createConversation(providerId?: string): Conversation {
    const db = getDatabase().getDb();
    const id = require('crypto').randomUUID();
    const now = Date.now();

    db.prepare(`
      INSERT INTO conversations (id, title, provider_id, created_at, updated_at)
      VALUES (?, NULL, ?, ?, ?)
    `).run(id, providerId || null, now, now);

    return {
      id,
      title: null,
      providerId: providerId || null,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Get a conversation by ID
   */
  getConversation(id: string): Conversation | null {
    const db = getDatabase().getDb();
    const row = db.prepare(`
      SELECT id, title, provider_id, created_at, updated_at
      FROM conversations WHERE id = ?
    `).get(id) as {
      id: string;
      title: string | null;
      provider_id: string | null;
      created_at: number;
      updated_at: number;
    } | undefined;

    if (!row) return null;

    return {
      id: row.id,
      title: row.title,
      providerId: row.provider_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Get all conversations ordered by most recent
   */
  getAllConversations(limit = 50): Conversation[] {
    const db = getDatabase().getDb();
    const rows = db.prepare(`
      SELECT id, title, provider_id, created_at, updated_at
      FROM conversations
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(limit) as Array<{
      id: string;
      title: string | null;
      provider_id: string | null;
      created_at: number;
      updated_at: number;
    }>;

    return rows.map(row => ({
      id: row.id,
      title: row.title,
      providerId: row.provider_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  /**
   * Update conversation title
   */
  updateTitle(id: string, title: string): void {
    const db = getDatabase().getDb();
    db.prepare(`
      UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?
    `).run(title, Date.now(), id);
  }

  /**
   * Delete a conversation and its messages
   */
  deleteConversation(id: string): void {
    const db = getDatabase().getDb();
    db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
  }

  /**
   * Add a message to a conversation
   */
  addMessage(conversationId: string, role: 'user' | 'assistant' | 'system', content: string): Message {
    const db = getDatabase().getDb();
    const id = require('crypto').randomUUID();
    const now = Date.now();

    db.prepare(`
      INSERT INTO messages (id, conversation_id, role, content, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, conversationId, role, content, now);

    // Update conversation timestamp
    db.prepare(`
      UPDATE conversations SET updated_at = ? WHERE id = ?
    `).run(now, conversationId);

    return {
      id,
      conversationId,
      role,
      content,
      createdAt: now,
    };
  }

  /**
   * Get all messages for a conversation
   */
  getMessages(conversationId: string): Message[] {
    const db = getDatabase().getDb();
    const rows = db.prepare(`
      SELECT id, conversation_id, role, content, created_at
      FROM messages
      WHERE conversation_id = ?
      ORDER BY created_at ASC
    `).all(conversationId) as Array<{
      id: string;
      conversation_id: string;
      role: string;
      content: string;
      created_at: number;
    }>;

    return rows.map(row => ({
      id: row.id,
      conversationId: row.conversation_id,
      role: row.role as 'user' | 'assistant' | 'system',
      content: row.content,
      createdAt: row.created_at,
    }));
  }

  /**
   * Generate a title for a conversation using AI
   */
  async generateTitle(conversationId: string, aiService: AIServiceInterface): Promise<string> {
    const messages = this.getMessages(conversationId);
    if (messages.length === 0) return 'New Conversation';

    const firstUserMessage = messages.find(m => m.role === 'user');
    if (!firstUserMessage) return 'New Conversation';

    try {
      const prompt = `Generate a very short title (3-5 words max) for a conversation that starts with: "${firstUserMessage.content.slice(0, 200)}"`;
      const title = await aiService.generateTitle(prompt);
      
      if (title) {
        this.updateTitle(conversationId, title);
        return title;
      }
    } catch (error) {
      console.error('Failed to generate title:', error);
    }

    // Fallback: use first few words of user message
    const words = firstUserMessage.content.split(/\s+/).slice(0, 5).join(' ');
    const fallbackTitle = words.length > 30 ? words.slice(0, 30) + '...' : words;
    this.updateTitle(conversationId, fallbackTitle);
    return fallbackTitle;
  }
}

// Interface for AI service (to avoid circular dependency)
interface AIServiceInterface {
  generateTitle(prompt: string): Promise<string | null>;
}

// Singleton instance
let chatServiceInstance: ChatService | null = null;

export function getChatService(): ChatService {
  if (!chatServiceInstance) {
    chatServiceInstance = new ChatService();
  }
  return chatServiceInstance;
}
