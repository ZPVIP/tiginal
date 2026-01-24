import { ipcMain, dialog, app } from 'electron';
import { getDatabase } from '../services/database/database';
import * as crypto from 'crypto';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import defaults from './defaults.json';

interface Tool {
  id: string;
  name: string;
  description?: string;
  inputSchema: object;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

interface ToolInput {
  id?: string;
  name: string;
  description?: string;
  inputSchema: object;
  enabled?: boolean;
}

/**
 * Get platform-specific default workspace path
 */
function getDefaultWorkspacePath(): string {
  let baseDir: string;
  
  if (process.platform === 'win32') {
    // Windows: %APPDATA%\Tiginal\workspaces
    baseDir = path.join(process.env.APPDATA || os.homedir(), 'Tiginal');
  } else {
    // macOS and Linux: ~/.config/tiginal/workspaces
    baseDir = path.join(os.homedir(), '.config', 'tiginal');
  }
  
  return path.join(baseDir, 'workspaces');
}

/**
 * Ensure workspace directory exists
 */
function ensureWorkspaceDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Setup Tool-related IPC handlers
 */
export function setupToolHandlers(): void {
  
  // Get all tools
  ipcMain.handle('tools:get-all', async (): Promise<Tool[]> => {
    const db = getDatabase().getDb();
    const rows = db.prepare(`
      SELECT id, name, description, input_schema, enabled, created_at, updated_at
      FROM tools ORDER BY name ASC
    `).all() as Array<{
      id: string;
      name: string;
      description: string | null;
      input_schema: string;
      enabled: number;
      created_at: number;
      updated_at: number;
    }>;

    return rows.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description || undefined,
      inputSchema: JSON.parse(row.input_schema),
      enabled: row.enabled === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  });

  // Get enabled tools (for AI request)
  ipcMain.handle('tools:get-enabled', async (): Promise<Array<{ name: string; description: string; input_schema: object }>> => {
    const db = getDatabase().getDb();
    const rows = db.prepare(`
      SELECT name, description, input_schema
      FROM tools WHERE enabled = 1 ORDER BY name ASC
    `).all() as Array<{
      name: string;
      description: string | null;
      input_schema: string;
    }>;

    return rows.map(row => ({
      name: row.name,
      description: row.description || '',
      input_schema: JSON.parse(row.input_schema),
    }));
  });

  // Add a new tool
  ipcMain.handle('tools:add', async (_event, input: ToolInput): Promise<Tool> => {
    const db = getDatabase().getDb();
    const id = crypto.randomUUID();
    const now = Date.now();

    db.prepare(`
      INSERT INTO tools (id, name, description, input_schema, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.name,
      input.description || null,
      JSON.stringify(input.inputSchema),
      input.enabled !== false ? 1 : 0,
      now,
      now
    );

    return {
      id,
      name: input.name,
      description: input.description,
      inputSchema: input.inputSchema,
      enabled: input.enabled !== false,
      createdAt: now,
      updatedAt: now,
    };
  });

  // Update a tool
  ipcMain.handle('tools:update', async (_event, input: ToolInput): Promise<void> => {
    if (!input.id) throw new Error('Tool ID required');

    const db = getDatabase().getDb();
    const now = Date.now();

    db.prepare(`
      UPDATE tools SET
        name = ?,
        description = ?,
        input_schema = ?,
        enabled = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      input.name,
      input.description || null,
      JSON.stringify(input.inputSchema),
      input.enabled !== false ? 1 : 0,
      now,
      input.id
    );
  });

  // Toggle tool enabled status
  ipcMain.handle('tools:toggle', async (_event, id: string, enabled: boolean): Promise<void> => {
    const db = getDatabase().getDb();
    const now = Date.now();

    db.prepare(`
      UPDATE tools SET enabled = ?, updated_at = ? WHERE id = ?
    `).run(enabled ? 1 : 0, now, id);
  });

  // Delete a tool
  ipcMain.handle('tools:delete', async (_event, id: string): Promise<void> => {
    const db = getDatabase().getDb();
    db.prepare('DELETE FROM tools WHERE id = ?').run(id);
  });

  // Import tools from JSON (like the ones in request.json)
  ipcMain.handle('tools:import-from-json', async (_event, toolsJson: any[]): Promise<{ added: number; skipped: number }> => {
    const db = getDatabase().getDb();
    let added = 0;
    let skipped = 0;

    for (const tool of toolsJson) {
      if (!tool.name || !tool.input_schema) {
        skipped++;
        continue;
      }

      // Check if tool with same name exists
      const existing = db.prepare('SELECT id FROM tools WHERE name = ?').get(tool.name);
      if (existing) {
        skipped++;
        continue;
      }

      const id = crypto.randomUUID();
      const now = Date.now();

      db.prepare(`
        INSERT INTO tools (id, name, description, input_schema, enabled, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        tool.name,
        tool.description || null,
        JSON.stringify(tool.input_schema),
        1, // enabled by default
        now,
        now
      );
      added++;
    }

    return { added, skipped };
  });

  // Workspace handlers
  ipcMain.handle('workspace:get-default-path', async (): Promise<string> => {
    return getDefaultWorkspacePath();
  });

  ipcMain.handle('workspace:get-path', async (): Promise<string> => {
    const db = getDatabase();
    const saved = db.getSetting('workspacePath');
    if (saved) return saved;
    
    // Return default and ensure it exists
    const defaultPath = getDefaultWorkspacePath();
    ensureWorkspaceDir(defaultPath);
    return defaultPath;
  });

  ipcMain.handle('workspace:set-path', async (_event, newPath: string): Promise<void> => {
    const db = getDatabase();
    ensureWorkspaceDir(newPath);
    db.setSetting('workspacePath', newPath);
  });

  ipcMain.handle('workspace:open-dialog', async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select Workspace Directory',
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0];
  });

  // Get tool model setting
  ipcMain.handle('tools:get-model', async (): Promise<string | null> => {
    const db = getDatabase();
    return db.getSetting('toolModel');
  });

  // Set tool model setting
  ipcMain.handle('tools:set-model', async (_event, model: string): Promise<void> => {
    const db = getDatabase();
    db.setSetting('toolModel', model);
  });

  // Get global tools enabled setting
  ipcMain.handle('tools:get-global-enabled', async (): Promise<boolean> => {
    const db = getDatabase();
    // Default to true if not set
    const val = db.getSetting('toolBoxGlobalEnabled');
    return val !== 'false';
  });

  // Set global tools enabled setting
  ipcMain.handle('tools:set-global-enabled', async (_event, enabled: boolean): Promise<void> => {
    const db = getDatabase();
    db.setSetting('toolBoxGlobalEnabled', String(enabled));
  });

  // Import system preset tools (upsert by name)
  ipcMain.handle('tools:import-preset', async (): Promise<{ added: number; updated: number }> => {
    const db = getDatabase().getDb();
    let added = 0;
    let updated = 0;
    const now = Date.now();

    for (const tool of defaults.defaultTools) {
      // Check if tool with same name exists
      const existing = db.prepare('SELECT id, description FROM tools WHERE name = ?').get(tool.name) as { id: string; description: string | null } | undefined;
      
      if (existing) {
        // Update if name matches (regardless of description)
        db.prepare(`
          UPDATE tools SET
            description = ?,
            input_schema = ?,
            updated_at = ?
          WHERE id = ?
        `).run(
          tool.description,
          JSON.stringify(tool.input_schema),
          now,
          existing.id
        );
        updated++;
      } else {
        // Insert new tool
        db.prepare(`
          INSERT INTO tools (id, name, description, input_schema, enabled, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          crypto.randomUUID(),
          tool.name,
          tool.description,
          JSON.stringify(tool.input_schema),
          1,
          now,
          now
        );
        added++;
      }
    }

    return { added, updated };
  });

  // Get default system prompt
  ipcMain.handle('settings:get-default-system-prompt', async (): Promise<string> => {
    return defaults.defaultSystemPrompt;
  });

  // Reset system prompt to default
  ipcMain.handle('settings:reset-system-prompt', async (): Promise<string> => {
    const db = getDatabase();
    const prompt = defaults.defaultSystemPrompt;
    db.setSetting('systemPrompt', prompt);
    return prompt;
  });
}
