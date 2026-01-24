import { ipcMain } from 'electron';
import { getDatabase } from '../services/database/database';
import { getCrypto } from '../services/ssh/CryptoService';
import { fetchWithLocalhostFallback } from './utils/NetworkUtils';

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
    id?: string;
    type: string; 
    endpoint: string; 
    apiKey?: string;
    customHeaders?: Record<string, string>;
    autoCORSFix?: boolean;
  }): Promise<{ success: boolean; error?: string; models?: string[] }> => {
    
    // Handle OpenAI Compatible & Copilot
    if (provider.type !== 'openai-compatible' && provider.type !== 'copilot') {
      return { success: false, error: 'Provider type not supported for testing' };
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout
      
      let endpoint = provider.endpoint || '';
      // Remove trailing slash
      if (endpoint.endsWith('/')) endpoint = endpoint.slice(0, -1);

      let headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...provider.customHeaders
      };

      // -- Resolve API Key --
      let finalApiKey = provider.apiKey;
      // If no key provided but we have an ID, try to load it from DB
      if (!finalApiKey && provider.id) {
          const db = getDatabase().getDb();
          const crypto = getCrypto();
          const row = db.prepare('SELECT api_key_encrypted FROM ai_providers WHERE id = ?').get(provider.id) as { api_key_encrypted: string } | undefined;
          
          if (row?.api_key_encrypted && crypto.isUnlocked()) {
              try {
                  finalApiKey = crypto.decrypt(row.api_key_encrypted);
              } catch (e) {
                  console.error("Failed to decrypt key for test-connection", e);
              }
          }
      }
      
      // -- Copilot Specific Logic --
      if (provider.type === 'copilot') {
          if (!finalApiKey) throw new Error("No API Key provided");
          
          const { getCopilotToken } = require('./services/ai/CopilotAuthService');
          const copilotToken = await getCopilotToken(finalApiKey);
          
          headers['Authorization'] = `Bearer ${copilotToken}`;
          headers['Copilot-Integration-Id'] = 'vscode-chat';
          headers['Editor-Version'] = 'vscode/1.107.0'; 
          headers['Editor-Plugin-Version'] = 'copilot-chat/0.35.0';
          headers['User-Agent'] = 'GitHubCopilotChat/0.35.0'; 
          
          // Copilot usually needs the standard github endpoint if not set
          if (!endpoint || endpoint === 'https://api.openai.com/v1') {
              endpoint = 'https://api.githubcopilot.com'; 
          }
      } else {
         // Standard OpenAI / Ollama Logic
         if (finalApiKey) {
           headers['Authorization'] = `Bearer ${finalApiKey}`;
         }
      }

      // Auto CORS fix
      if (provider.autoCORSFix) {
        try {
          const url = new URL(endpoint);
          headers['Origin'] = url.origin;
        } catch (e) { }
      }

      let models: string[] = [];
      let fetchSuccess = false;
      let usedUrl = '';
      let errorLog: string[] = [];

      // Helper for trying a URL
      const tryFetch = async (url: string, isOllamaNative: boolean = false) => {
          if (fetchSuccess) return;
          try {
              if (process.env.NODE_ENV !== 'production') console.log(`Testing connection URL: ${url}`);
              const res = await fetchWithLocalhostFallback(url, { method: 'GET', headers, signal: controller.signal });
              
              if (res.ok) {
                  const data = await res.json() as any;
                  
                  if (isOllamaNative && data.models && Array.isArray(data.models)) {
                      // Ollama native format: { models: [ { name: "llama2", ... }, ... ] }
                      models = data.models.map((m: any) => m.name || m.model);
                      fetchSuccess = true;
                      usedUrl = url;
                  } else if (Array.isArray(data.data)) {
                      // OpenAI format: { data: [ { id: "gpt-4", ... }, ... ] }
                      models = data.data.map((m: any) => m.id);
                      fetchSuccess = true;
                      usedUrl = url;
                  }
              } else {
                  const text = await res.text();
                  errorLog.push(`${url} returned ${res.status}: ${text}`);
              }
          } catch (e) {
              errorLog.push(`${url} failed: ${(e as Error).message}`);
          }
      };

      // 1. Try Standard OpenAI path (e.g. endpoint/models)
      await tryFetch(`${endpoint}/models`);

      clearTimeout(timeoutId);

      if (models.length > 0) {
          models.sort();
      }

      // -- Copilot Fallback & Merging --
      if (provider.type === 'copilot') {
          // Known Copilot Models
          const fallbackModels = [
              'gpt-4',
              'gpt-3.5-turbo',
              'o1-preview',
              'o1-mini',
              'claude-3.5-sonnet'
          ];
          const uniqueModels = new Set([...models, ...fallbackModels]);
          models = Array.from(uniqueModels).sort();
          return { success: true, models };
      }

      // If we failed to fetch models and it's NOT copilot, we should warn user unless we decide to succeed anyway?
      // For generic OpenAI, listing models is crucial.
      // If we failed to fetch models and it's NOT copilot
      if (!fetchSuccess || models.length === 0) {
           return { success: false, error: `Could not fetch models. Verified: ${endpoint}. Details: ${errorLog.join('; ')}` }; 
      }

      return { success: true, models };
    } catch (error) {
       console.error("Test connection failed:", error);
       return { success: false, error: (error as Error).message };
    }
  });

  // Proxy for GitHub Device Code (fixes CORS in renderer)
  ipcMain.handle('ai:github-auth-device-code', async (_event, clientId: string): Promise<any> => {
      const response = await fetch('https://github.com/login/device/code', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          client_id: clientId,
          scope: 'read:user'
        })
      });

      if (!response.ok) {
          throw new Error(`GitHub API Error: ${response.status} ${await response.text()}`);
      }
      return await response.json();
  });

  // Proxy for GitHub Poll Token (fixes CORS in renderer)
  ipcMain.handle('ai:github-auth-poll-token', async (_event, { clientId, deviceCode }: { clientId: string, deviceCode: string }): Promise<any> => {
      const response = await fetch('https://github.com/login/oauth/access_token', {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            client_id: clientId,
            device_code: deviceCode,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
          })
        });

        const data = await response.json();
        return data; // Return raw data, let frontend handle logic
  });
}
