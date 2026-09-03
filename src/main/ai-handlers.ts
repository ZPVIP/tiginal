import { ipcMain } from 'electron';
import { getDatabase } from '../services/database/database';
import { getCrypto } from '../services/ssh/CryptoService';
import { fetchWithLocalhostFallback } from './utils/NetworkUtils';
import type { AIProvider, ApiFormat, ModelConfig } from '../shared/ai-provider';
import { normalizeApiFormat } from '../shared/ai-provider';
import { parseModelListPayload, parseStoredModels } from './services/ai/model-metadata';
import { invalidateProviderContextWindows } from './services/context-window';
import {
  enrichModelsFromLocalCatalog,
  loadProviderCatalog,
  updateModelCatalog,
} from './services/ai/model-catalog';
import { anthropicModelsUrl } from './services/ai/anthropic-stream';

interface AIProviderInput {
  id?: string;
  name: string;
  type: 'openai-compatible' | 'copilot';
  endpoint?: string;
  catalogProvider?: string;
  apiKey?: string;
  model: string;
  isDefault?: boolean;
  availableModels?: ModelConfig[];
  customHeaders?: Record<string, string>;
  autoCORSFix?: boolean;
  apiFormat?: ApiFormat;
  useMaxCompletionTokens?: boolean;
}

function parseHeaders(value: string | null): Record<string, string> | undefined {
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
    const headers = Object.entries(parsed).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    );
    return Object.fromEntries(headers);
  } catch {
    return undefined;
  }
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
      SELECT id, name, type, endpoint, catalog_provider, api_key_encrypted, model, available_models, custom_headers,
             auto_cors_fix, api_format, use_max_completion_tokens, is_default, created_at, updated_at
      FROM ai_providers ORDER BY is_default DESC, name ASC
    `).all() as Array<{
      id: string;
      name: string;
      type: string;
      endpoint: string | null;
      catalog_provider: string | null;
      api_key_encrypted: string | null;
      model: string;
      is_default: number;
      created_at: number;
      updated_at: number;
      available_models: string | null;
      custom_headers: string | null;
      auto_cors_fix: number | null;
      api_format: string | null;
      use_max_completion_tokens: number | null;
    }>;

    return rows.map(row => ({
            id: row.id,
            name: row.name,
            type: row.type === 'copilot' ? 'copilot' : 'openai-compatible',
            endpoint: row.endpoint || undefined,
            catalogProvider: row.catalog_provider || undefined,
            apiKeyEncrypted: row.api_key_encrypted || undefined,
            model: row.model,
            availableModels: parseStoredModels(row.available_models),
            customHeaders: parseHeaders(row.custom_headers),
            autoCORSFix: row.auto_cors_fix === 1,
            apiFormat: normalizeApiFormat(row.api_format),
            useMaxCompletionTokens: row.use_max_completion_tokens === 1,
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
      INSERT INTO ai_providers (
        id, name, type, endpoint, catalog_provider, api_key_encrypted, model, available_models, custom_headers,
        auto_cors_fix, api_format, use_max_completion_tokens, is_default, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.name,
      input.type,
      input.endpoint || null,
      input.catalogProvider || null,
      apiKeyEncrypted,
      input.model,
      input.availableModels ? JSON.stringify(input.availableModels) : null,
      input.customHeaders ? JSON.stringify(input.customHeaders) : null,
      input.autoCORSFix !== false ? 1 : 0, // Default to true if undefined
      normalizeApiFormat(input.apiFormat),
      input.useMaxCompletionTokens ? 1 : 0,
      input.isDefault ? 1 : 0,
      now,
      now
    );

    return {
      id,
      name: input.name,
      type: input.type,
      endpoint: input.endpoint,
      catalogProvider: input.catalogProvider,
      apiKeyEncrypted: apiKeyEncrypted || undefined,
      model: input.model,
      availableModels: input.availableModels,
      customHeaders: input.customHeaders,
      autoCORSFix: input.autoCORSFix ?? true,
      apiFormat: normalizeApiFormat(input.apiFormat),
      useMaxCompletionTokens: input.useMaxCompletionTokens ?? false,
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
      catalog_provider: string | null;
      api_format: string | null;
      use_max_completion_tokens: number | null;
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

    // Keep the active model inside the enabled model set when possible.
    let modelToSave = input.model;
    if (input.availableModels && input.availableModels.length > 0) {
        const enabledIds = input.availableModels.filter(model => model.enabled).map(model => model.id);
        if (!enabledIds.includes(modelToSave)) {
          modelToSave = enabledIds[0] || '';
        }
    }
    const useMaxCompletionTokens = input.useMaxCompletionTokens
      ?? existing.use_max_completion_tokens === 1;

    db.prepare(`
      UPDATE ai_providers SET
        name = ?,
        endpoint = ?,
        catalog_provider = ?,
        api_key_encrypted = ?,
        model = ?,
        available_models = ?,
        custom_headers = ?,
        auto_cors_fix = ?,
        api_format = ?,
        use_max_completion_tokens = ?,
        is_default = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      input.name,
      input.endpoint || null,
      input.catalogProvider === undefined ? existing.catalog_provider : input.catalogProvider || null,
      apiKeyEncrypted,
      modelToSave,
      input.availableModels ? JSON.stringify(input.availableModels) : null,
      input.customHeaders ? JSON.stringify(input.customHeaders) : null,
      input.autoCORSFix !== false ? 1 : 0,
      normalizeApiFormat(input.apiFormat ?? existing.api_format),
      useMaxCompletionTokens ? 1 : 0,
      input.isDefault ? 1 : 0,
      now,
      input.id
    );
    invalidateProviderContextWindows(input.id);
  });

  ipcMain.handle('ai:get-model-catalog-providers', async () => {
    return loadProviderCatalog();
  });

  ipcMain.handle('ai:update-model-catalog', async () => {
    return updateModelCatalog();
  });

  // Delete provider
  ipcMain.handle('ai:delete-provider', async (_event, id: string): Promise<void> => {
    const db = getDatabase().getDb();
    db.prepare('DELETE FROM ai_providers WHERE id = ?').run(id);
    invalidateProviderContextWindows(id);
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
    apiFormat?: ApiFormat;
    catalogProvider?: string;
  }): Promise<{ success: boolean; error?: string; models?: ModelConfig[] }> => {
    
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

      const apiFormat = normalizeApiFormat(provider.apiFormat);
      const headers: Record<string, string> = {
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
        if (finalApiKey && apiFormat === 'anthropic-messages') {
          headers['x-api-key'] = finalApiKey;
          headers['anthropic-version'] = headers['anthropic-version'] || '2023-06-01';
        } else if (finalApiKey) {
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

      const modelsUrl = apiFormat === 'anthropic-messages'
        ? anthropicModelsUrl(endpoint)
        : `${endpoint}/models`;
      let models: ModelConfig[] = [];
      let errorDetail = '';
      try {
        if (process.env.NODE_ENV !== 'production') console.log(`Fetching models from: ${modelsUrl}`);
        const response = await fetchWithLocalhostFallback(modelsUrl, {
          method: 'GET',
          headers,
          signal: controller.signal,
        });
        if (response.ok) {
          const payload: unknown = await response.json();
          models = enrichModelsFromLocalCatalog(
            parseModelListPayload(payload),
            provider.catalogProvider,
          );
        } else {
          errorDetail = `${modelsUrl} returned ${response.status}: ${await response.text()}`;
        }
      } finally {
        clearTimeout(timeoutId);
      }

      // -- Copilot Fallback & Merging --
      if (provider.type === 'copilot') {
          // Known Copilot Models
          const fallbackModels: ModelConfig[] = [
              'gpt-4',
              'gpt-3.5-turbo',
              'o1-preview',
              'o1-mini',
              'claude-3.5-sonnet'
          ].map(id => ({ id, name: id, enabled: true }));
          const uniqueModels = new Map(models.map(model => [model.id, model]));
          for (const model of fallbackModels) {
            if (!uniqueModels.has(model.id)) uniqueModels.set(model.id, model);
          }
          models = [...uniqueModels.values()].sort((left, right) => left.name.localeCompare(right.name));
          return { success: true, models };
      }

      // If we failed to fetch models and it's NOT copilot, we should warn user unless we decide to succeed anyway?
      // For generic OpenAI, listing models is crucial.
      // If we failed to fetch models and it's NOT copilot
      if (models.length === 0) {
           return { success: false, error: `Could not fetch models from ${modelsUrl}. ${errorDetail}`.trim() };
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
