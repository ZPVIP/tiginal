import { ipcMain } from 'electron';
import { getDatabase } from '../services/database/database';
import { getCrypto } from '../services/ssh/CryptoService';

interface AIProviderInput {
  id?: string;
  name: string;
  type: 'openai-compatible' | 'copilot';
  endpoint?: string;
  apiKey?: string;
  model: string;
  isDefault?: boolean;
}

interface AIProvider {
  id: string;
  name: string;
  type: 'openai-compatible' | 'copilot';
  endpoint?: string;
  apiKeyEncrypted?: string;
  model: string;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
}

/**
 * Setup AI-related IPC handlers
 */
export function setupAIHandlers(): void {
  // Get all providers
  ipcMain.handle('ai:get-providers', async (): Promise<AIProvider[]> => {
    const db = getDatabase().getDb();
    const rows = db.prepare(`
      SELECT id, name, type, endpoint, api_key_encrypted, model, is_default, created_at, updated_at
      FROM ai_providers ORDER BY name
    `).all() as Array<{
      id: string;
      name: string;
      type: string;
      endpoint: string | null;
      api_key_encrypted: string | null;
      model: string;
      is_default: number;
      created_at: number;
      updated_at: number;
    }>;

    return rows.map(row => ({
      id: row.id,
      name: row.name,
      type: row.type as 'openai-compatible' | 'copilot',
      endpoint: row.endpoint || undefined,
      apiKeyEncrypted: row.api_key_encrypted || undefined,
      model: row.model,
      isDefault: row.is_default === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  });

  // Add provider
  ipcMain.handle('ai:add-provider', async (_event, input: AIProviderInput): Promise<AIProvider> => {
    const db = getDatabase().getDb();
    const crypto = getCrypto();
    
    const id = crypto.isUnlocked() ? require('crypto').randomUUID() : require('crypto').randomUUID();
    const now = Date.now();
    
    let apiKeyEncrypted: string | null = null;
    if (input.apiKey && crypto.isUnlocked()) {
      apiKeyEncrypted = crypto.encrypt(input.apiKey);
    }

    // If setting as default, clear other defaults
    if (input.isDefault) {
      db.prepare('UPDATE ai_providers SET is_default = 0').run();
    }

    db.prepare(`
      INSERT INTO ai_providers (id, name, type, endpoint, api_key_encrypted, model, is_default, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.name,
      input.type,
      input.endpoint || null,
      apiKeyEncrypted,
      input.model,
      input.isDefault ? 1 : 0,
      now,
      now
    );

    return {
      id,
      name: input.name,
      type: input.type,
      endpoint: input.endpoint,
      apiKeyEncrypted: apiKeyEncrypted || undefined,
      model: input.model,
      isDefault: input.isDefault || false,
      createdAt: now,
      updatedAt: now,
    };
  });

  // Update provider
  ipcMain.handle('ai:update-provider', async (_event, input: AIProviderInput): Promise<void> => {
    if (!input.id) throw new Error('Provider ID required');

    const db = getDatabase().getDb();
    const crypto = getCrypto();
    const now = Date.now();

    // Get existing provider
    const existing = db.prepare('SELECT * FROM ai_providers WHERE id = ?').get(input.id) as {
      api_key_encrypted: string | null;
    } | undefined;
    
    if (!existing) throw new Error('Provider not found');

    let apiKeyEncrypted = existing.api_key_encrypted;
    if (input.apiKey !== undefined && crypto.isUnlocked()) {
      apiKeyEncrypted = input.apiKey ? crypto.encrypt(input.apiKey) : null;
    }

    // If setting as default, clear other defaults
    if (input.isDefault) {
      db.prepare('UPDATE ai_providers SET is_default = 0').run();
    }

    db.prepare(`
      UPDATE ai_providers SET
        name = ?,
        endpoint = ?,
        api_key_encrypted = ?,
        model = ?,
        is_default = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      input.name,
      input.endpoint || null,
      apiKeyEncrypted,
      input.model,
      input.isDefault ? 1 : 0,
      now,
      input.id
    );
  });

  // Delete provider
  ipcMain.handle('ai:delete-provider', async (_event, id: string): Promise<void> => {
    const db = getDatabase().getDb();
    db.prepare('DELETE FROM ai_providers WHERE id = ?').run(id);
  });

  // Get decrypted API key
  ipcMain.handle('ai:get-api-key', async (_event, id: string): Promise<string | null> => {
    const db = getDatabase().getDb();
    const crypto = getCrypto();

    const row = db.prepare('SELECT api_key_encrypted FROM ai_providers WHERE id = ?').get(id) as {
      api_key_encrypted: string | null;
    } | undefined;

    if (!row?.api_key_encrypted || !crypto.isUnlocked()) {
      return null;
    }

    try {
      return crypto.decrypt(row.api_key_encrypted);
    } catch {
      return null;
    }
  });
}
