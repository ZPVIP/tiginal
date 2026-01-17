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
  availableModels?: string[];
  customHeaders?: Record<string, string>;
  autoCORSFix?: boolean;
}

interface AIProvider {
  id: string;
  name: string;
  type: 'openai-compatible' | 'copilot';
  endpoint?: string;
  apiKeyEncrypted?: string;
  model: string;
  availableModels?: string[];
  customHeaders?: Record<string, string>;
  autoCORSFix?: boolean;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
}

/**
 * Setup AI-related IPC handlers
 */
export function setupAIHandlers(): void {
  // Get database path
  ipcMain.handle('ai:get-db-path', async (): Promise<string> => {
    return getDatabase().getDbPath();
  });

  // Get all providers
  ipcMain.handle('ai:get-providers', async (): Promise<AIProvider[]> => {
    const db = getDatabase().getDb();
    const rows = db.prepare(`
      SELECT id, name, type, endpoint, api_key_encrypted, model, available_models, custom_headers, auto_cors_fix, is_default, created_at, updated_at
      FROM ai_providers ORDER BY is_default DESC, name ASC
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
      available_models: string | null;
      custom_headers: string | null;
      auto_cors_fix: number | null;
    }>;

    return rows.map(row => {
        let availableModels: any[] | undefined = undefined;
        if (row.available_models) {
            try {
                const parsed = JSON.parse(row.available_models);
                if (Array.isArray(parsed)) {
                    // Check if it's the old format (string[])
                    if (parsed.length > 0 && typeof parsed[0] === 'string') {
                         availableModels = parsed.map((id: string) => ({ id, name: id, enabled: true }));
                    } else {
                         availableModels = parsed;
                    }
                }
            } catch (e) {
                console.error("Failed to parse available models", e);
            }
        }

        return {
            id: row.id,
            name: row.name,
            type: row.type as 'openai-compatible' | 'copilot',
            endpoint: row.endpoint || undefined,
            apiKeyEncrypted: row.api_key_encrypted || undefined,
            model: row.model,
            availableModels,
            customHeaders: row.custom_headers ? JSON.parse(row.custom_headers) : undefined,
            autoCORSFix: row.auto_cors_fix === 1,
            isDefault: row.is_default === 1,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    });
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
      INSERT INTO ai_providers (id, name, type, endpoint, api_key_encrypted, model, available_models, custom_headers, auto_cors_fix, is_default, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.name,
      input.type,
      input.endpoint || null,
      apiKeyEncrypted,
      input.model,
      input.availableModels ? JSON.stringify(input.availableModels) : null,
      input.customHeaders ? JSON.stringify(input.customHeaders) : null,
      input.autoCORSFix !== false ? 1 : 0, // Default to true if undefined
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
      customHeaders: input.customHeaders,
      autoCORSFix: input.autoCORSFix ?? true,
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

    // Validate model vs availableModels
    let modelToSave = input.model;
    if (input.availableModels && input.availableModels.length > 0) {
        // Handle both string[] and object[] (ModelConfig[])
        const firstItem = input.availableModels[0];
        const isString = typeof firstItem === 'string';
        
        let enabledIds: string[] = [];
        let allIds: string[] = [];
        
        if (isString) {
            allIds = input.availableModels as unknown as string[];
            enabledIds = allIds; // Strings are always "enabled"
        } else {
            const list = input.availableModels as unknown as { id: string, enabled?: boolean }[];
            allIds = list.map(m => m.id);
            enabledIds = list.filter(m => m.enabled !== false).map(m => m.id);
        }
            
        // If current model is not ENABLED, default to the first enabled one
        if (!enabledIds.includes(modelToSave)) {
             if (enabledIds.length > 0) {
                 modelToSave = enabledIds[0];
             } else if (allIds.length > 0) {
                 // Fallback: If ALL are disabled, we still need to store *something* valid in DB
                 // effectively "first available" even if disabled, or keep current if it exists in allIds
                 // Let's pick first from allIds to be safe against deletions
                 modelToSave = allIds[0];
             }
        }
    }

    db.prepare(`
      UPDATE ai_providers SET
        name = ?,
        endpoint = ?,
        api_key_encrypted = ?,
        model = ?,
        available_models = ?,
        custom_headers = ?,
        auto_cors_fix = ?,
        is_default = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      input.name,
      input.endpoint || null,
      apiKeyEncrypted,
      modelToSave,
      input.availableModels ? JSON.stringify(input.availableModels) : null,
      input.customHeaders ? JSON.stringify(input.customHeaders) : null,
      input.autoCORSFix !== false ? 1 : 0,
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
  // Test connection and fetch models
  ipcMain.handle('ai:test-connection', async (_event, provider: { 
    type: string; 
    endpoint: string; 
    apiKey?: string;
    customHeaders?: Record<string, string>;
    autoCORSFix?: boolean;
  }): Promise<{ success: boolean; error?: string; models?: string[] }> => {
    if (provider.type !== 'openai-compatible') {
      return { success: false, error: 'Only OpenAI-compatible providers support testing currently' };
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...provider.customHeaders
      };

      if (provider.apiKey) {
        headers['Authorization'] = `Bearer ${provider.apiKey}`;
      }
      
      // Auto CORS fix simulation (setting Origin header)
      if (provider.autoCORSFix) {
        try {
          const url = new URL(provider.endpoint);
          headers['Origin'] = url.origin;
        } catch (e) {
          // invalid url, ignore
        }
      }

      const response = await fetch(`${provider.endpoint}/models`, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`API returned ${response.status}: ${response.statusText}`);
      }

      const data = await response.json() as { data: Array<{ id: string }> };
      
      // Extract model IDs
      const models = Array.isArray(data.data) 
        ? data.data.map(m => m.id).sort()
        : [];

      if (models.length === 0) {
          // Fallback if data is not in standard OpenAI format or empty
          return { success: true, models: [] }; 
      }

      return { success: true, models };
    } catch (error) {
       return { success: false, error: (error as Error).message };
    }
  });
}
