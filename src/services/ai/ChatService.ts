import { getDatabase } from '../database/database';
import { getCrypto } from '../ssh/CryptoService';

export interface Conversation {
  id: string;
  title: string | null;
  providerId: string | null;
  categoryId: number;
  isPinned: boolean;
  isFavorite: boolean;
  createdAt: number;
  updatedAt: number;
  isTransient?: boolean;
}

export interface Message {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: number;
}

export interface CategoryData {
  id: number;
  name: string;
  isPinned: boolean;
  isExpanded: boolean;
  rank: number;
}

/**
 * Chat service for managing conversations and messages
 */
export class ChatService {
  private transientConversations: Map<string, Conversation & { messages: Message[] }> = new Map();

  /**
   * Create a new conversation
   */
  createConversation(providerId?: string, isTransient: boolean = false): Conversation {
    const id = require('crypto').randomUUID();
    const now = Date.now();

    const conversation: Conversation = {
      id,
      title: null,
      providerId: providerId || null,
      categoryId: 1,
      isPinned: false,
      isFavorite: false,
      createdAt: now,
      updatedAt: now,
      isTransient,
    };

    if (isTransient) {
      this.transientConversations.set(id, { ...conversation, messages: [] });
    } else {
      const db = getDatabase().getDb();
      db.prepare(`
        INSERT INTO conversations (id, title, provider_id, created_at, updated_at)
        VALUES (?, NULL, ?, ?, ?)
      `).run(id, providerId || null, now, now);
    }

    return conversation;
  }

  /**
   * Get a conversation by ID
   */
  getConversation(id: string): Conversation | null {
    // Check transient first
    if (this.transientConversations.has(id)) {
      const transConf = this.transientConversations.get(id);
      if (transConf) {
        // Return without messages property to match interface
        const { messages, ...rest } = transConf;
        return rest;
      }
    }

    const db = getDatabase().getDb();
    const row = db.prepare(`
      SELECT id, title, provider_id, category_id, is_pinned, is_favorite, created_at, updated_at
      FROM conversations WHERE id = ?
    `).get(id) as {
      id: string;
      title: string | null;
      provider_id: string | null;
      category_id: number;
      is_pinned: number;
      is_favorite: number;
      created_at: number;
      updated_at: number;
    } | undefined;

    if (!row) return null;

    return {
      id: row.id,
      title: row.title,
      providerId: row.provider_id,
      categoryId: row.category_id ?? 1,
      isPinned: row.is_pinned === 1,
      isFavorite: row.is_favorite === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      isTransient: false,
    };
  }

  /**
   * Get all conversations ordered by most recent
   */
  getAllConversations(limit = 50): Conversation[] {
    const db = getDatabase().getDb();
    const rows = db.prepare(`
      SELECT id, title, provider_id, category_id, is_pinned, is_favorite, created_at, updated_at
      FROM conversations
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(limit) as Array<{
      id: string;
      title: string | null;
      provider_id: string | null;
      category_id: number;
      is_pinned: number;
      is_favorite: number;
      created_at: number;
      updated_at: number;
    }>;

    return rows.map(row => ({
      id: row.id,
      title: row.title,
      providerId: row.provider_id,
      categoryId: row.category_id ?? 1,
      isPinned: row.is_pinned === 1,
      isFavorite: row.is_favorite === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      isTransient: false,
    }));
  }

  /**
   * Update conversation title
   */
  updateTitle(id: string, title: string): void {
    if (this.transientConversations.has(id)) {
      const conv = this.transientConversations.get(id);
      if (conv) {
        conv.title = title;
        conv.updatedAt = Date.now();
      }
      return;
    }

    const db = getDatabase().getDb();
    db.prepare(`
      UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?
    `).run(title, Date.now(), id);
  }

  /**
   * Delete a conversation and its messages
   */
  deleteConversation(id: string): void {
    if (this.transientConversations.has(id)) {
      this.transientConversations.delete(id);
      return;
    }

    const db = getDatabase().getDb();
    db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
  }

  /**
   * Add a message to a conversation
   */
  addMessage(conversationId: string, role: 'user' | 'assistant' | 'system', content: string): Message {
    const id = require('crypto').randomUUID();
    const now = Date.now();

    const message: Message = {
      id,
      conversationId,
      role,
      content,
      createdAt: now,
    };

    if (this.transientConversations.has(conversationId)) {
      const conv = this.transientConversations.get(conversationId);
      if (conv) {
        conv.messages.push(message);
        conv.updatedAt = now;
      }
      return message;
    }

    const db = getDatabase().getDb();
    
    // Check if conversation exists in DB, if not (and not transient), it might be an issue.
    // For now we assume calling code ensures existence or we let SQL error out.
    
    db.prepare(`
      INSERT INTO messages (id, conversation_id, role, content, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, conversationId, role, content, now);

    // Update conversation timestamp
    db.prepare(`
      UPDATE conversations SET updated_at = ? WHERE id = ?
    `).run(now, conversationId);

    return message;
  }

  /**
   * Get all messages for a conversation
   */
  getMessages(conversationId: string): Message[] {
    if (this.transientConversations.has(conversationId)) {
      return this.transientConversations.get(conversationId)?.messages || [];
    }

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

  // ===== Category Methods =====

  /**
   * Get all categories ordered by pinned status and rank
   */
  getAllCategories(): CategoryData[] {
    const db = getDatabase().getDb();
    const rows = db.prepare(`
      SELECT id, name, is_pinned, is_expanded, rank
      FROM conversation_categories
      ORDER BY is_pinned DESC, rank ASC
    `).all() as Array<{
      id: number;
      name: string;
      is_pinned: number;
      is_expanded: number;
      rank: number;
    }>;

    return rows.map(row => ({
      id: row.id,
      name: row.name,
      isPinned: row.is_pinned === 1,
      isExpanded: row.is_expanded === 1,
      rank: row.rank,
    }));
  }

  /**
   * Create a new category
   */
  createCategory(name: string): CategoryData {
    const db = getDatabase().getDb();
    const now = Date.now();
    
    // Get max rank
    const maxRank = (db.prepare('SELECT MAX(rank) as max FROM conversation_categories').get() as any)?.max || 0;
    
    const result = db.prepare(`
      INSERT INTO conversation_categories (name, is_pinned, is_expanded, rank, created_at, updated_at)
      VALUES (?, 0, 1, ?, ?, ?)
    `).run(name, maxRank + 1, now, now);

    return {
      id: result.lastInsertRowid as number,
      name,
      isPinned: false,
      isExpanded: true,
      rank: maxRank + 1,
    };
  }

  /**
   * Update category name
   */
  updateCategory(id: number, name: string): void {
    const db = getDatabase().getDb();
    db.prepare(`
      UPDATE conversation_categories SET name = ?, updated_at = ? WHERE id = ?
    `).run(name, Date.now(), id);
  }

  /**
   * Delete a category (moves conversations to Default)
   */
  deleteCategory(id: number): void {
    if (id === 1) throw new Error('Cannot delete Default category');
    
    const db = getDatabase().getDb();
    
    // Move all conversations to Default (id=1)
    db.prepare('UPDATE conversations SET category_id = 1 WHERE category_id = ?').run(id);
    
    // Delete the category
    db.prepare('DELETE FROM conversation_categories WHERE id = ?').run(id);
  }

  /**
   * Toggle category pinned status
   */
  toggleCategoryPinned(id: number, pinned: boolean): void {
    const db = getDatabase().getDb();
    db.prepare(`
      UPDATE conversation_categories SET is_pinned = ?, updated_at = ? WHERE id = ?
    `).run(pinned ? 1 : 0, Date.now(), id);
  }

  /**
   * Toggle category expanded status
   */
  toggleCategoryExpanded(id: number, expanded: boolean): void {
    const db = getDatabase().getDb();
    db.prepare(`
      UPDATE conversation_categories SET is_expanded = ?, updated_at = ? WHERE id = ?
    `).run(expanded ? 1 : 0, Date.now(), id);
  }

  /**
   * Reorder categories by updating ranks
   */
  reorderCategories(ids: number[]): void {
    const db = getDatabase().getDb();
    const now = Date.now();
    
    const update = db.transaction(() => {
      ids.forEach((id, index) => {
        db.prepare('UPDATE conversation_categories SET rank = ?, updated_at = ? WHERE id = ?').run(index, now, id);
      });
    });
    
    update();
  }

  // ===== Enhanced Conversation Methods =====

  /**
   * Move conversation to another category
   */
  moveConversation(conversationId: string, categoryId: number): void {
    const db = getDatabase().getDb();
    db.prepare(`
      UPDATE conversations SET category_id = ?, updated_at = ? WHERE id = ?
    `).run(categoryId, Date.now(), conversationId);
  }

  /**
   * Toggle conversation pinned status
   */
  toggleConversationPinned(id: string, pinned: boolean): void {
    const db = getDatabase().getDb();
    db.prepare(`
      UPDATE conversations SET is_pinned = ?, updated_at = ? WHERE id = ?
    `).run(pinned ? 1 : 0, Date.now(), id);
  }

  /**
   * Toggle conversation favorite status
   */
  toggleConversationFavorite(id: string, favorite: boolean): void {
    const db = getDatabase().getDb();
    db.prepare(`
      UPDATE conversations SET is_favorite = ?, updated_at = ? WHERE id = ?
    `).run(favorite ? 1 : 0, Date.now(), id);
  }

  /**
   * Get conversations by category with pagination
   * Sorted by: pinned first (alphabetically), then by sortBy field desc
   */
  getConversationsByCategory(categoryId: number, page: number, pageSize: number, sortBy: 'updatedAt' | 'createdAt' = 'updatedAt'): { items: Conversation[]; total: number } {
    const db = getDatabase().getDb();
    const offset = page * pageSize;

    const countRow = db.prepare(`
      SELECT COUNT(*) as count FROM conversations WHERE category_id = ?
    `).get(categoryId) as { count: number };

    const sortField = sortBy === 'createdAt' ? 'created_at' : 'updated_at';

    const rows = db.prepare(`
      SELECT id, title, provider_id, category_id, is_pinned, is_favorite, created_at, updated_at
      FROM conversations
      WHERE category_id = ?
      ORDER BY is_pinned DESC, CASE WHEN is_pinned = 1 THEN title END ASC, ${sortField} DESC
      LIMIT ? OFFSET ?
    `).all(categoryId, pageSize, offset) as Array<{
      id: string;
      title: string | null;
      provider_id: string | null;
      category_id: number;
      is_pinned: number;
      is_favorite: number;
      created_at: number;
      updated_at: number;
    }>;

    return {
      items: rows.map(row => ({
        id: row.id,
        title: row.title,
        providerId: row.provider_id,
        categoryId: row.category_id,
        isPinned: row.is_pinned === 1,
        isFavorite: row.is_favorite === 1,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        isTransient: false,
      })),
      total: countRow.count,
    };
  }

  /**
   * Get favorite conversations with pagination
   * Sorted by: pinned first (alphabetically), then by sortBy field desc
   */
  getFavoriteConversations(page: number, pageSize: number, sortBy: 'updatedAt' | 'createdAt' = 'updatedAt'): { items: Conversation[]; total: number } {
    const db = getDatabase().getDb();
    const offset = page * pageSize;

    const countRow = db.prepare(`
      SELECT COUNT(*) as count FROM conversations WHERE is_favorite = 1
    `).get() as { count: number };

    const sortField = sortBy === 'createdAt' ? 'created_at' : 'updated_at';

    const rows = db.prepare(`
      SELECT id, title, provider_id, category_id, is_pinned, is_favorite, created_at, updated_at
      FROM conversations
      WHERE is_favorite = 1
      ORDER BY is_pinned DESC, CASE WHEN is_pinned = 1 THEN title END ASC, ${sortField} DESC
      LIMIT ? OFFSET ?
    `).all(pageSize, offset) as Array<{
      id: string;
      title: string | null;
      provider_id: string | null;
      category_id: number;
      is_pinned: number;
      is_favorite: number;
      created_at: number;
      updated_at: number;
    }>;

    return {
      items: rows.map(row => ({
        id: row.id,
        title: row.title,
        providerId: row.provider_id,
        categoryId: row.category_id,
        isPinned: row.is_pinned === 1,
        isFavorite: row.is_favorite === 1,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        isTransient: false,
      })),
      total: countRow.count,
    };
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
