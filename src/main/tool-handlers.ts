import { ipcMain, dialog, app } from 'electron';
import { getDatabase } from '../services/database/database';
import * as crypto from 'crypto';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import defaults from './defaults.json';
import { getDynamicPromptTemplates } from './dynamic-prompts';

interface Tool {
  id: string;
  categoryId: string | null;
  categoryName?: string;
  name: string;
  description?: string;
  inputSchema: object;
  isSystem: boolean;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

interface ToolInput {
  id?: string;
  categoryId?: string;
  name: string;
  description?: string;
  inputSchema: object;
  enabled?: boolean;
}

interface ToolCategory {
  id: string;
  name: string;
  rank: number;
  isExpanded: boolean;
  enabled: boolean;
}

interface SystemPrompt {
  id: number;
  title: string;
  content: string;
  isDefault: boolean;
  isActive: boolean;
  rank: number;
}

interface SystemPromptInput {
  id?: number;
  title: string;
  content: string;
  isActive?: boolean;
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
 * Initialize default system prompts from defaults.json (only if table is empty)
 * Called on startup - only inserts if no default prompts exist
 */
function initializeDefaultSystemPrompts(db: any): void {
  // Check if any default prompts exist (ID < 100)
  const count = db.prepare('SELECT COUNT(*) as c FROM system_prompts WHERE id < 100').get() as { c: number };
  if (count.c > 0) {
    // Default prompts already exist, skip initialization
    return;
  }

  const now = Date.now();
  const defaultPrompts = defaults.defaultSystemPrompt as Array<{
    id: number;
    title: string;
    content: string;
    is_default: boolean;
    is_active: boolean;
  }>;

  for (let i = 0; i < defaultPrompts.length; i++) {
    const prompt = defaultPrompts[i];
    db.prepare(`
      INSERT INTO system_prompts (id, title, content, is_default, is_active, rank, created_at, updated_at)
      VALUES (?, ?, ?, 1, ?, ?, ?, ?)
    `).run(prompt.id, prompt.title, prompt.content, prompt.is_active ? 1 : 0, i, now, now);
  }
  
  console.log(`[Init] Inserted ${defaultPrompts.length} default system prompts`);
}

/**
 * Reset default system prompts from defaults.json
 * Called when user clicks Reset button - updates/inserts all default prompts
 */
function resetDefaultSystemPrompts(db: any): void {
  const now = Date.now();
  const defaultPrompts = defaults.defaultSystemPrompt as Array<{
    id: number;
    title: string;
    content: string;
    is_default: boolean;
    is_active: boolean;
  }>;

  for (let i = 0; i < defaultPrompts.length; i++) {
    const prompt = defaultPrompts[i];
    const existing = db.prepare('SELECT id FROM system_prompts WHERE id = ?').get(prompt.id);
    
    if (existing) {
      // Update existing, reset all fields including is_active
      db.prepare(`
        UPDATE system_prompts SET
          title = ?,
          content = ?,
          is_default = 1,
          is_active = ?,
          rank = ?,
          updated_at = ?
        WHERE id = ?
      `).run(prompt.title, prompt.content, prompt.is_active ? 1 : 0, i, now, prompt.id);
    } else {
      // Insert new
      db.prepare(`
        INSERT INTO system_prompts (id, title, content, is_default, is_active, rank, created_at, updated_at)
        VALUES (?, ?, ?, 1, ?, ?, ?, ?)
      `).run(prompt.id, prompt.title, prompt.content, prompt.is_active ? 1 : 0, i, now, now);
    }
  }
}

/**
 * Sync system tools and categories from defaults.json
 */
function syncSystemDefaults(db: any) {
  const now = Date.now();

  // 1. Sync Categories
  const defaultCategories = new Set<string>();
  defaultCategories.add('Default');
  
  defaults.defaultTools.forEach((dt: any) => {
    if (dt.category) {
      defaultCategories.add(dt.category);
    }
  });

  // Ensure 'Default' exists with rank 0 if table is empty
  const catCount = db.prepare('SELECT count(*) as c FROM tool_categories').get().c;
  if (catCount === 0) {
    let rank = 0;
    // Insert Default first
    if (defaultCategories.has('Default')) {
      const existing = db.prepare('SELECT id FROM tool_categories WHERE name = ?').get('Default');
      if (!existing) {
        db.prepare('INSERT INTO tool_categories (id, name, rank, is_expanded, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
          crypto.randomUUID(), 'Default', rank++, 1, now, now
        );
      }
      defaultCategories.delete('Default');
    }

    // Insert others
    for (const catName of defaultCategories) {
      const existing = db.prepare('SELECT id FROM tool_categories WHERE name = ?').get(catName);
      if (!existing) {
        db.prepare('INSERT INTO tool_categories (id, name, rank, is_expanded, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
          crypto.randomUUID(), catName, rank++, 1, now, now
        );
      }
    }
  }

  // 2. Sync System Tools
  for (const tool of defaults.defaultTools) {
    // Determine category ID
    const catName = tool.category || 'Default';
    const cat = db.prepare('SELECT id FROM tool_categories WHERE name = ?').get(catName);
    const catId = cat ? cat.id : null;

    const existing = db.prepare('SELECT id, is_system FROM tools WHERE name = ?').get(tool.name);
    
    if (existing) {
      // Update system tools (if they are marked as system or we are reclaiming them as system)
      // Note: We force update properties for system tools
      if (existing.is_system) {
        db.prepare(`
          UPDATE tools SET 
            description = ?, 
            input_schema = ?, 
            category_id = ?,
            is_system = 1,
            updated_at = ?
          WHERE id = ?
        `).run(
          tool.description,
          JSON.stringify(tool.input_schema),
          catId,
          now,
          existing.id
        );
      }
    } else {
      // Insert new system tool
      db.prepare(`
        INSERT INTO tools (id, category_id, name, description, input_schema, is_system, enabled, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?)
      `).run(
        crypto.randomUUID(),
        catId,
        tool.name,
        tool.description,
        JSON.stringify(tool.input_schema),
        now,
        now
      );
    }
  }
}

/**
 * Setup Tool-related IPC handlers
 */
export function setupToolHandlers(): void {
  
  // Initialize system defaults on startup
  try {
    const db = getDatabase().getDb();
    syncSystemDefaults(db);
    initializeDefaultSystemPrompts(db);
  } catch (err) {
    console.error('Failed to sync system defaults:', err);
  }

  // Get all tools
  ipcMain.handle('tools:get-all', async (): Promise<Tool[]> => {
    const db = getDatabase().getDb();
    const rows = db.prepare(`
      SELECT 
        t.id, t.category_id, tc.name as category_name, t.name, t.description, 
        t.input_schema, t.is_system, t.enabled, t.created_at, t.updated_at
      FROM tools t
      LEFT JOIN tool_categories tc ON t.category_id = tc.id
      ORDER BY tc.rank ASC, t.name ASC
    `).all() as Array<{
      id: string;
      category_id: string | null;
      category_name: string | null;
      name: string;
      description: string | null;
      input_schema: string;
      is_system: number;
      enabled: number;
      created_at: number;
      updated_at: number;
    }>;

    return rows.map(row => ({
      id: row.id,
      categoryId: row.category_id,
      categoryName: row.category_name || undefined,
      name: row.name,
      description: row.description || undefined,
      inputSchema: JSON.parse(row.input_schema),
      isSystem: row.is_system === 1,
      enabled: row.enabled === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  });

  // Get enabled tools (for AI request)
  ipcMain.handle('tools:get-enabled', async (): Promise<Array<{ name: string; description: string; input_schema: object }>> => {
    const db = getDatabase().getDb();
    
    // Check global switch first
    const globalEnabled = getDatabase().getSetting('toolBoxGlobalEnabled');
    if (globalEnabled === 'false') {
      return [];
    }

    const rows = db.prepare(`
      SELECT t.name, t.description, t.input_schema
      FROM tools t
      LEFT JOIN tool_categories tc ON t.category_id = tc.id
      WHERE t.enabled = 1 AND (tc.enabled IS NULL OR tc.enabled = 1)
      ORDER BY t.name ASC
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

    try {
      db.prepare(`
        INSERT INTO tools (id, category_id, name, description, input_schema, is_system, enabled, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)
      `).run(
        id,
        input.categoryId || null,
        input.name,
        input.description || null,
        JSON.stringify(input.inputSchema),
        input.enabled !== false ? 1 : 0,
        now,
        now
      );

      const categoryName = input.categoryId ? 
        (db.prepare('SELECT name FROM tool_categories WHERE id = ?').get(input.categoryId) as any)?.name : undefined;

      return {
        id,
        categoryId: input.categoryId || null,
        categoryName,
        name: input.name,
        description: input.description,
        inputSchema: input.inputSchema,
        isSystem: false,
        enabled: input.enabled !== false,
        createdAt: now,
        updatedAt: now,
      };
    } catch (err: any) {
      if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        throw new Error('A tool with this name already exists.');
      }
      throw err;
    }
  });

  // Update a tool
  ipcMain.handle('tools:update', async (_event, input: ToolInput): Promise<void> => {
    if (!input.id) throw new Error('Tool ID required');

    const db = getDatabase().getDb();
    const now = Date.now();

    // Check if system tool
    const tool = db.prepare('SELECT is_system FROM tools WHERE id = ?').get(input.id) as { is_system: number };
    if (tool && tool.is_system === 1) {
      // Only allow updating enabled state for system tools (and maybe description logic if we allowed it, but user said system tools definition is fixed)
      // Actually user said user can enable/disable system tools.
      // And "Import System Preset" updates definition.
      // So manual update should probably only touch enabled or category? 
      // User said "Tools要按分类显示... Name 要是 uniq... 如果不是系统自带的定义... 窗口要是可以编辑的"
      // Implies system tools are NOT editable via this endpoint for schema/name.
      // But we might want to allow changing category?
      // For now, let's assume system tools are locked for schema/name changes via UI edit.
    }

    try {
      db.prepare(`
        UPDATE tools SET
          category_id = ?,
          name = ?,
          description = ?,
          input_schema = ?,
          enabled = ?,
          updated_at = ?
        WHERE id = ?
      `).run(
        input.categoryId || null,
        input.name,
        input.description || null,
        JSON.stringify(input.inputSchema),
        input.enabled !== false ? 1 : 0,
        now,
        input.id
      );
    } catch (err: any) {
      if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        throw new Error('A tool with this name already exists.');
      }
      throw err;
    }
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

  // Import tools from JSON
  ipcMain.handle('tools:import-from-json', async (_event, toolsJson: any[]): Promise<{ added: number; skipped: number }> => {
    const db = getDatabase().getDb();
    let added = 0;
    let skipped = 0;
    const now = Date.now();
    
    // Get default category
    const defaultCat = db.prepare('SELECT id FROM tool_categories WHERE name = ?').get('Default') as { id: string } | undefined;
    const defaultCatId = defaultCat?.id || null;

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

      db.prepare(`
        INSERT INTO tools (id, category_id, name, description, input_schema, is_system, enabled, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 0, 1, ?, ?)
      `).run(
        id,
        defaultCatId,
        tool.name,
        tool.description || null,
        JSON.stringify(tool.input_schema),
        now,
        now
      );
      added++;
    }

    return { added, skipped };
  });

  // --- Category Handlers ---

  // Get all categories
  ipcMain.handle('categories:get-all', async (): Promise<ToolCategory[]> => {
    const db = getDatabase().getDb();
    const rows = db.prepare(`
      SELECT id, name, rank, is_expanded, enabled FROM tool_categories ORDER BY rank ASC
    `).all() as Array<{ id: string; name: string; rank: number; is_expanded: number; enabled: number }>;
    
    return rows.map(r => ({
      id: r.id,
      name: r.name,
      rank: r.rank,
      isExpanded: r.is_expanded === 1,
      enabled: r.enabled !== 0 // Default to true if null or 1
    }));
  });

  // Add category
  ipcMain.handle('categories:add', async (_event, name: string): Promise<ToolCategory> => {
    const db = getDatabase().getDb();
    const id = crypto.randomUUID();
    const now = Date.now();

    // Get max rank
    const maxRank = db.prepare('SELECT MAX(rank) as m FROM tool_categories').get() as { m: number };
    const rank = (maxRank.m || 0) + 1;

    try {
      db.prepare(`
        INSERT INTO tool_categories (id, name, rank, is_expanded, enabled, created_at, updated_at)
        VALUES (?, ?, ?, 1, 1, ?, ?)
      `).run(id, name, rank, now, now);

      return { id, name, rank, isExpanded: true, enabled: true };
    } catch (err: any) {
      if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        throw new Error('Category already exists');
      }
      throw err;
    }
  });

  // Update category (rename)
  ipcMain.handle('categories:update', async (_event, id: string, name: string): Promise<void> => {
    const db = getDatabase().getDb();
    const now = Date.now();
    try {
      db.prepare('UPDATE tool_categories SET name = ?, updated_at = ? WHERE id = ?').run(name, now, id);
    } catch (err: any) {
      if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        throw new Error('Category name already exists');
      }
      throw err;
    }
  });

  // Delete category
  ipcMain.handle('categories:delete', async (_event, id: string): Promise<void> => {
    const db = getDatabase().getDb();
    
    // Don't allow deleting Default if it's the only one, or maybe just recreate it if needed
    // The requirement says "Default category" exists by default.
    // If we delete a category, tools should probably move to Default?
    // User didn't specify, but safer to move to 'Default' or 'Uncategorized'
    
    const category = db.prepare('SELECT name FROM tool_categories WHERE id = ?').get(id) as { name: string };
    if (!category) return;
    if (category.name === 'Default') {
      throw new Error('Cannot delete Default category');
    }

    const defaultCat = db.prepare('SELECT id FROM tool_categories WHERE name = ?').get('Default') as { id: string };
    
    db.transaction(() => {
      // Move tools to Default
      if (defaultCat) {
        db.prepare('UPDATE tools SET category_id = ? WHERE category_id = ?').run(defaultCat.id, id);
      } else {
        // If no default (shouldn't happen), set to null
        db.prepare('UPDATE tools SET category_id = NULL WHERE category_id = ?').run(id);
      }
      
      // Delete category
      db.prepare('DELETE FROM tool_categories WHERE id = ?').run(id);
    })();
  });

  // Reorder categories
  ipcMain.handle('categories:reorder', async (_event, orderedIds: string[]): Promise<void> => {
    const db = getDatabase().getDb();
    db.transaction(() => {
      const stmt = db.prepare('UPDATE tool_categories SET rank = ? WHERE id = ?');
      orderedIds.forEach((id, index) => {
        stmt.run(index, id);
      });
    })();
  });

  // Toggle category expansion
  ipcMain.handle('categories:toggle-expanded', async (_event, id: string, expanded: boolean): Promise<void> => {
    const db = getDatabase().getDb();
    db.prepare('UPDATE tool_categories SET is_expanded = ? WHERE id = ?').run(expanded ? 1 : 0, id);
  });

  // Toggle category enabled
  ipcMain.handle('categories:toggle-enabled', async (_event, id: string, enabled: boolean): Promise<void> => {
    const db = getDatabase().getDb();
    db.prepare('UPDATE tool_categories SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
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
    try {
      syncSystemDefaults(db);
      return { added: 0, updated: 0 }; // We don't track counts in the sync helper, could improve later
    } catch (err) {
      throw err;
    }
  });

  // --- System Prompt Handlers ---

  // Get all system prompts
  ipcMain.handle('system-prompts:get-all', async (): Promise<SystemPrompt[]> => {
    const db = getDatabase().getDb();
    const rows = db.prepare(`
      SELECT id, title, content, is_default, is_active, rank
      FROM system_prompts
      ORDER BY rank ASC
    `).all() as Array<{
      id: number;
      title: string;
      content: string;
      is_default: number;
      is_active: number;
      rank: number;
    }>;

    return rows.map(row => ({
      id: row.id,
      title: row.title,
      content: row.content,
      isDefault: row.is_default === 1,
      isActive: row.is_active === 1,
      rank: row.rank,
    }));
  });

  // Get enabled system prompts (for building the system message)
  ipcMain.handle('system-prompts:get-enabled', async (): Promise<SystemPrompt[]> => {
    const db = getDatabase().getDb();
    const rows = db.prepare(`
      SELECT id, title, content, is_default, is_active, rank
      FROM system_prompts
      WHERE is_active = 1
      ORDER BY rank ASC
    `).all() as Array<{
      id: number;
      title: string;
      content: string;
      is_default: number;
      is_active: number;
      rank: number;
    }>;

    return rows.map(row => ({
      id: row.id,
      title: row.title,
      content: row.content,
      isDefault: row.is_default === 1,
      isActive: row.is_active === 1,
      rank: row.rank,
    }));
  });

  // Add a custom system prompt (ID >= 100)
  ipcMain.handle('system-prompts:add', async (_event, input: SystemPromptInput): Promise<SystemPrompt> => {
    const db = getDatabase().getDb();
    const now = Date.now();

    // Find the next available ID >= 100
    const maxId = db.prepare('SELECT MAX(id) as m FROM system_prompts WHERE id >= 100').get() as { m: number | null };
    const newId = Math.max(100, (maxId.m || 99) + 1);

    // Get max rank
    const maxRank = db.prepare('SELECT MAX(rank) as m FROM system_prompts').get() as { m: number | null };
    const newRank = (maxRank.m || 0) + 1;

    db.prepare(`
      INSERT INTO system_prompts (id, title, content, is_default, is_active, rank, created_at, updated_at)
      VALUES (?, ?, ?, 0, ?, ?, ?, ?)
    `).run(newId, input.title, input.content, input.isActive !== false ? 1 : 0, newRank, now, now);

    return {
      id: newId,
      title: input.title,
      content: input.content,
      isDefault: false,
      isActive: input.isActive !== false,
      rank: newRank,
    };
  });

  // Update a system prompt
  ipcMain.handle('system-prompts:update', async (_event, input: SystemPromptInput): Promise<void> => {
    if (input.id === undefined) throw new Error('System prompt ID required');

    const db = getDatabase().getDb();
    const now = Date.now();

    // Check if it's a default prompt (ID < 100)
    const isDefault = input.id < 100;

    if (isDefault) {
      // For default prompts, only allow updating is_active
      db.prepare(`
        UPDATE system_prompts SET is_active = ?, updated_at = ? WHERE id = ?
      `).run(input.isActive ? 1 : 0, now, input.id);
    } else {
      // For custom prompts, allow full update
      db.prepare(`
        UPDATE system_prompts SET title = ?, content = ?, is_active = ?, updated_at = ? WHERE id = ?
      `).run(input.title, input.content, input.isActive ? 1 : 0, now, input.id);
    }
  });

  // Toggle system prompt active status
  ipcMain.handle('system-prompts:toggle', async (_event, id: number, isActive: boolean): Promise<void> => {
    const db = getDatabase().getDb();
    const now = Date.now();
    db.prepare('UPDATE system_prompts SET is_active = ?, updated_at = ? WHERE id = ?').run(isActive ? 1 : 0, now, id);
  });

  // Delete a custom system prompt (only ID >= 100)
  ipcMain.handle('system-prompts:delete', async (_event, id: number): Promise<void> => {
    if (id < 100) {
      throw new Error('Cannot delete default system prompts');
    }
    const db = getDatabase().getDb();
    db.prepare('DELETE FROM system_prompts WHERE id = ?').run(id);
  });

  // Reorder system prompts
  ipcMain.handle('system-prompts:reorder', async (_event, orderedIds: number[]): Promise<void> => {
    const db = getDatabase().getDb();
    db.transaction(() => {
      const stmt = db.prepare('UPDATE system_prompts SET rank = ? WHERE id = ?');
      orderedIds.forEach((id, index) => {
        stmt.run(index, id);
      });
    })();
  });

  // Reset default system prompts from defaults.json
  ipcMain.handle('system-prompts:reset-defaults', async (): Promise<void> => {
    const db = getDatabase().getDb();
    resetDefaultSystemPrompts(db);
  });

  // Get global system prompts enabled status
  ipcMain.handle('system-prompts:get-global-enabled', async (): Promise<boolean> => {
    const dbService = getDatabase();
    const value = dbService.getSetting('systemPromptsGlobalEnabled');
    return value !== 'false'; // Default to true if not set
  });

  // Set global system prompts enabled status
  ipcMain.handle('system-prompts:set-global-enabled', async (_event, enabled: boolean): Promise<void> => {
    const dbService = getDatabase();
    dbService.setSetting('systemPromptsGlobalEnabled', String(enabled));
  });

  // Get category enabled status (default or custom)
  ipcMain.handle('system-prompts:get-category-enabled', async (_event, category: 'default' | 'custom'): Promise<boolean> => {
    const dbService = getDatabase();
    const key = category === 'default' ? 'systemPromptsDefaultEnabled' : 'systemPromptsCustomEnabled';
    const value = dbService.getSetting(key);
    return value !== 'false'; // Default to true if not set
  });

  // Set category enabled status (default or custom)
  ipcMain.handle('system-prompts:set-category-enabled', async (_event, category: 'default' | 'custom', enabled: boolean): Promise<void> => {
    const dbService = getDatabase();
    const key = category === 'default' ? 'systemPromptsDefaultEnabled' : 'systemPromptsCustomEnabled';
    dbService.setSetting(key, String(enabled));
  });

  // Get dynamic prompt settings
  ipcMain.handle('system-prompts:get-dynamic-settings', async (): Promise<Record<string, boolean>> => {
    const dbService = getDatabase();
    return {
      dateInfo: dbService.getSetting('dynamicPrompt_dateInfo') !== 'false',
      wdInfo: dbService.getSetting('dynamicPrompt_wdInfo') !== 'false',
      systemInfo: dbService.getSetting('dynamicPrompt_systemInfo') !== 'false',
      appleScriptInfo: dbService.getSetting('dynamicPrompt_appleScriptInfo') !== 'false',
    };
  });

  // Set dynamic prompt setting
  ipcMain.handle('system-prompts:set-dynamic-setting', async (_event, key: string, value: boolean): Promise<void> => {
    const dbService = getDatabase();
    dbService.setSetting(`dynamicPrompt_${key}`, String(value));
  });

  // Get dynamic prompt templates (returns actual content used by AI)
  ipcMain.handle('system-prompts:get-dynamic-templates', async (): Promise<Record<string, { title: string; content: string; showAlways: boolean }>> => {
    return getDynamicPromptTemplates();
  });

  // Get global dynamic system prompts enabled status
  ipcMain.handle('system-prompts:get-dynamic-global-enabled', async (): Promise<boolean> => {
    const dbService = getDatabase();
    const value = dbService.getSetting('dynamicPromptsGlobalEnabled');
    return value !== 'false'; // Default to true if not set
  });

  // Set global dynamic system prompts enabled status
  ipcMain.handle('system-prompts:set-dynamic-global-enabled', async (_event, enabled: boolean): Promise<void> => {
    const dbService = getDatabase();
    dbService.setSetting('dynamicPromptsGlobalEnabled', String(enabled));
  });

  // Get all dynamic prompts with status (Convenience)
  ipcMain.handle('system-prompts:get-dynamic-all', async (): Promise<any[]> => {
    const db = getDatabase();
    const templates = getDynamicPromptTemplates();
    const prompts = [];
    
    for (const [key, template] of Object.entries(templates)) {
       // Skip macOS specific on non-mac
       if (key === 'appleScriptInfo' && process.platform !== 'darwin') continue;

       const enabled = db.getSetting(`dynamicPrompt_${key}`) !== 'false';
       prompts.push({
         id: key, 
         title: template.title,
         content: template.content,
         isActive: enabled
       });
    }
    // Sort by title or keep predefined order? 
    // Keys in object iteration order is usually insertion order for JS objects, which matches definition in dynamic-prompts.ts.
    return prompts;
  });

  // Toggle dynamic prompt
  ipcMain.handle('system-prompts:toggle-dynamic', async (_event, key: string, enabled: boolean): Promise<void> => {
     const db = getDatabase();
     db.setSetting(`dynamicPrompt_${key}`, String(enabled));
  });

  // Legacy handlers for backwards compatibility (deprecated, will be removed)
  ipcMain.handle('settings:get-default-system-prompt', async (): Promise<any> => {
    return defaults.defaultSystemPrompt;
  });

  ipcMain.handle('settings:reset-system-prompt', async (): Promise<void> => {
    const db = getDatabase().getDb();
    resetDefaultSystemPrompts(db);
  });
}
