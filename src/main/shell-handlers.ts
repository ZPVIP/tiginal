import { ipcMain } from 'electron';
import { getPathCompletions } from './shellHistory';
import { directoryService } from './DirectoryService';
import { commandService } from './CommandService';

export function setupShellHandlers() {
  ipcMain.handle('shell:get-directory-suggestions', async (_, partial: string, cwd: string) => {
    // 1. Local Completions (Current Directory subdirs)
    // We reuse getPathCompletions but want specifically direct subdirectories for "Local"
    // getPathCompletions returns formatted strings "subdir/"
    const local = getPathCompletions(partial, cwd);

    // 2. Frequent Directories (Global history)
    const frequent = directoryService.getFrequentDirectories(partial);
    
    // Filter frequent to exclude items already in local to avoid duplicates?
    // Or just distinct sections.
    // Let's keep them distinct. UI will render separate sections.

    return {
        local,
        frequent
    };
  });

  ipcMain.handle('shell:record-visit', async (_, path: string) => {
    directoryService.recordVisit(path);
  });

  ipcMain.handle('shell:ignore-visit', async (_, path: string) => {
    directoryService.ignoreDirectory(path);
  });

  // Command history handlers
  ipcMain.handle('shell:get-command-suggestions', async (_, prefix: string) => {
    return commandService.getCommandSuggestions(prefix);
  });

  ipcMain.handle('shell:record-command', async (_, command: string) => {
    commandService.recordCommand(command);
  });

  ipcMain.handle('shell:add-favorite-command', async (_, command: string) => {
    commandService.addFavorite(command);
  });

  ipcMain.handle('shell:remove-command', async (_, command: string) => {
    commandService.removeCommand(command);
  });

  ipcMain.handle('shell:get-all-commands', async () => {
    return commandService.getAllCommands();
  });

  ipcMain.handle('shell:update-command', async (_, id: number, newCommand: string) => {
    commandService.updateCommand(id, newCommand);
  });

  ipcMain.handle('shell:toggle-favorite', async (_, id: number) => {
    commandService.toggleFavorite(id);
  });

  ipcMain.handle('shell:get-all-directories', async () => {
    return directoryService.getAllDirectories();
  });

  // Command blacklist handlers
  ipcMain.handle('shell:get-command-blacklist', async () => {
    return commandService.getBlacklist();
  });

  ipcMain.handle('shell:add-command-blacklist', async (_, pattern: string) => {
    commandService.addBlacklist(pattern);
  });

  ipcMain.handle('shell:update-command-blacklist', async (_, id: number, pattern: string) => {
    commandService.updateBlacklist(id, pattern);
  });

  ipcMain.handle('shell:remove-command-blacklist', async (_, id: number) => {
    commandService.removeBlacklist(id);
  });

  // Directory blacklist handlers
  ipcMain.handle('shell:get-directory-blacklist', async () => {
    return directoryService.getBlacklist();
  });

  ipcMain.handle('shell:add-directory-blacklist', async (_, pattern: string) => {
    directoryService.addBlacklist(pattern);
  });

  ipcMain.handle('shell:update-directory-blacklist', async (_, id: number, pattern: string) => {
    directoryService.updateBlacklist(id, pattern);
  });

  ipcMain.handle('shell:remove-directory-blacklist', async (_, id: number) => {
    directoryService.removeBlacklist(id);
  });

  // Cleanup handlers
  ipcMain.handle('shell:cleanup-commands', async (_, minScore: number) => {
    return commandService.cleanupLowFrequency(minScore);
  });

  ipcMain.handle('shell:cleanup-directories', async (_, minScore: number) => {
    return directoryService.cleanupLowFrequency(minScore);
  });

  // Normalize command using AI
  ipcMain.handle('command:normalize', async (_, command: string, providerId: string, modelId: string) => {
    const { getDatabase } = await import('../services/database/database');
    const { getCrypto } = await import('../services/ssh/CryptoService');
    const { getCopilotToken } = await import('./services/ai/CopilotAuthService');
    
    const db = getDatabase().getDb();
    const crypto = getCrypto();
    
    // Get provider
    const provider = db.prepare(`
      SELECT id, name, type, endpoint, api_key_encrypted, custom_headers
      FROM ai_providers WHERE id = ?
    `).get(providerId) as {
      id: string;
      name: string;
      type: string;
      endpoint: string | null;
      api_key_encrypted: string | null;
      custom_headers: string | null;
    } | undefined;

    if (!provider) return command;

    // Get API key
    let apiKey: string | null = null;
    if (provider.api_key_encrypted && crypto.isUnlocked()) {
      try {
        apiKey = crypto.decrypt(provider.api_key_encrypted);
      } catch {
        return command;
      }
    }

    if (!apiKey) return command;

    // Build headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    let endpoint = provider.endpoint || 'https://api.openai.com/v1';
    
    if (provider.type === 'copilot') {
      if (!endpoint || endpoint.includes('api.openai.com')) {
        endpoint = 'https://api.githubcopilot.com';
      }
      try {
        const copilotToken = await getCopilotToken(apiKey);
        headers['Authorization'] = `Bearer ${copilotToken}`;
        headers['Copilot-Integration-Id'] = 'vscode-chat';
        headers['Editor-Version'] = 'vscode/1.107.0';
        headers['Editor-Plugin-Version'] = 'copilot-chat/0.35.0';
        headers['User-Agent'] = 'GitHubCopilotChat/0.35.0';
        headers['Openai-Intent'] = 'conversation-edits';
      } catch (err) {
        console.error('Copilot token exchange failed:', err);
        return command;
      }
    } else {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    // Parse custom headers
    if (provider.custom_headers) {
      try {
        Object.assign(headers, JSON.parse(provider.custom_headers));
      } catch {}
    }

    const prompt = `You are a command normalizer. Given a shell command, remove any dynamic/variable values (like commit messages, timestamps, file paths that look temporary, etc.) and replace them with empty placeholders or remove them entirely.

Examples:
- "git commit -am 'fixed bug'" → "git commit -am ''"
- "docker run --name app-20240120 myimage" → "docker run --name myimage"
- "curl https://api.example.com/users/12345" → "curl https://api.example.com/users/"
- "kamal deploy -d staging" → "kamal deploy -d staging" (keep as-is, stable flag)

Return ONLY the normalized command, nothing else.

Command: ${command}`;

    try {
      const response = await fetch(`${endpoint}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0,
          max_tokens: 200,
        }),
      });

      if (!response.ok) return command;

      const data = await response.json() as any;
      const result = data.choices?.[0]?.message?.content?.trim();
      return result || command;
    } catch (err) {
      console.error('Command normalize error:', err);
      return command;
    }
  });
}
