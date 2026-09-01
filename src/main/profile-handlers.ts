import { ipcMain } from 'electron';
import { getDatabase } from '../services/database/database';
import * as crypto from 'crypto';
import { getMcpService } from './services/mcp/McpService';
import { parseStoredMcpProfile } from '../shared/profile-mcp';

interface ChatProfile {
  id: string;
  name: string;
  enabled: number;
  ai_provider_id: string | null;
  ai_model_id: string | null;
  system_prompts: string;
  tools: string;
  skills: string;
  mcp: string | null;
  rank: number;
  created_at: number;
  updated_at: number;
}

/**
 * Settings keys owned by other parts of the app. A profile snapshots and
 * restores these, so the names must stay in sync with tool-handlers.ts.
 */
const KEYS = {
  systemPromptsGlobal: 'systemPromptsGlobalEnabled',
  systemPromptsDefault: 'systemPromptsDefaultEnabled',
  systemPromptsCustom: 'systemPromptsCustomEnabled',
  dynamicPromptsGlobal: 'dynamicPromptsGlobalEnabled',
  toolsGlobal: 'toolBoxGlobalEnabled',
  skillsGlobal: 'skillsGlobalEnabled',
} as const;

const DYNAMIC_PROMPT_KEYS = ['dateInfo', 'wdInfo', 'systemInfo', 'appleScriptInfo'];

/**
 * Read a boolean setting using the app-wide convention: stored as String(bool),
 * absent means enabled.
 */
function readBool(key: string): boolean {
  return getDatabase().getSetting(key) !== 'false';
}

function serializeMcpProfile(value: unknown): string | null {
  const parsed = parseStoredMcpProfile(value);
  return parsed.kind === 'managed' ? JSON.stringify(parsed.snapshot) : null;
}

/**
 * Setup IPC handlers for Chat Profiles CRUD operations
 */
export function setupProfileHandlers(): void {
  const db = getDatabase().getDb();

  // Reject a name already taken by another profile (name is UNIQUE in the schema)
  const assertNameAvailable = (name: string, excludeId?: string): void => {
    const row = excludeId
      ? db.prepare('SELECT id FROM chat_profiles WHERE name = ? AND id != ?').get(name, excludeId)
      : db.prepare('SELECT id FROM chat_profiles WHERE name = ?').get(name);
    if (row) throw new Error(`A profile named "${name}" already exists`);
  };

  // Get all profiles ordered by rank
  ipcMain.handle('profiles:get-all', async (): Promise<ChatProfile[]> => {
    return db.prepare('SELECT * FROM chat_profiles ORDER BY rank ASC, created_at ASC').all() as ChatProfile[];
  });

  // Get a single profile by id
  ipcMain.handle('profiles:get', async (_event, id: string): Promise<ChatProfile | null> => {
    const row = db.prepare('SELECT * FROM chat_profiles WHERE id = ?').get(id) as ChatProfile | undefined;
    return row || null;
  });

  // Get all enabled profiles (for drawer display)
  ipcMain.handle('profiles:get-enabled', async (): Promise<ChatProfile[]> => {
    return db.prepare('SELECT * FROM chat_profiles WHERE enabled = 1 ORDER BY rank ASC, created_at ASC').all() as ChatProfile[];
  });

  // Add a new profile
  ipcMain.handle('profiles:add', async (_event, data: {
    name: string;
    ai_provider_id?: string;
    ai_model_id?: string;
    system_prompts?: object;
    tools?: object;
    skills?: object;
    mcp?: object | null;
  }): Promise<ChatProfile> => {
    const name = data.name?.trim();
    if (!name) throw new Error('Profile name is required');
    assertNameAvailable(name);

    const now = Date.now();
    const id = crypto.randomUUID();

    // Get next rank value
    const maxRank = db.prepare('SELECT MAX(rank) as max FROM chat_profiles').get() as { max: number | null };
    const rank = (maxRank.max ?? -1) + 1;

    db.prepare(`
      INSERT INTO chat_profiles (id, name, enabled, ai_provider_id, ai_model_id, system_prompts, tools, skills, mcp, rank, created_at, updated_at)
      VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      name,
      data.ai_provider_id || null,
      data.ai_model_id || null,
      JSON.stringify(data.system_prompts || {}),
      JSON.stringify(data.tools || {}),
      JSON.stringify(data.skills || {}),
      data.mcp === undefined ? null : serializeMcpProfile(data.mcp),
      rank,
      now,
      now
    );

    return db.prepare('SELECT * FROM chat_profiles WHERE id = ?').get(id) as ChatProfile;
  });

  // Update an existing profile
  ipcMain.handle('profiles:update', async (_event, id: string, data: {
    name?: string;
    ai_provider_id?: string | null;
    ai_model_id?: string | null;
    system_prompts?: object;
    tools?: object;
    skills?: object;
    mcp?: object | null;
  }): Promise<ChatProfile> => {
    const now = Date.now();
    const existing = db.prepare('SELECT * FROM chat_profiles WHERE id = ?').get(id) as ChatProfile | undefined;
    if (!existing) throw new Error(`Profile not found: ${id}`);

    const name = data.name !== undefined ? data.name.trim() : existing.name;
    if (!name) throw new Error('Profile name is required');
    assertNameAvailable(name, id);

    db.prepare(`
      UPDATE chat_profiles
      SET name = ?, ai_provider_id = ?, ai_model_id = ?, system_prompts = ?, tools = ?, skills = ?, mcp = ?, updated_at = ?
      WHERE id = ?
    `).run(
      name,
      data.ai_provider_id !== undefined ? data.ai_provider_id : existing.ai_provider_id,
      data.ai_model_id !== undefined ? data.ai_model_id : existing.ai_model_id,
      data.system_prompts ? JSON.stringify(data.system_prompts) : existing.system_prompts,
      data.tools ? JSON.stringify(data.tools) : existing.tools,
      data.skills ? JSON.stringify(data.skills) : existing.skills,
      data.mcp !== undefined ? serializeMcpProfile(data.mcp) : existing.mcp,
      now,
      id
    );

    return db.prepare('SELECT * FROM chat_profiles WHERE id = ?').get(id) as ChatProfile;
  });

  // Delete a profile
  ipcMain.handle('profiles:delete', async (_event, id: string): Promise<void> => {
    // Clear profile_id from any conversations using this profile
    db.prepare('UPDATE conversations SET profile_id = NULL WHERE profile_id = ?').run(id);
    db.prepare('DELETE FROM chat_profiles WHERE id = ?').run(id);
  });

  // Toggle profile enabled/disabled
  ipcMain.handle('profiles:toggle', async (_event, id: string, enabled: boolean): Promise<void> => {
    db.prepare('UPDATE chat_profiles SET enabled = ?, updated_at = ? WHERE id = ?').run(
      enabled ? 1 : 0,
      Date.now(),
      id
    );
  });

  // Reorder profiles: orderedIds is the full list in the desired order
  ipcMain.handle('profiles:reorder', async (_event, orderedIds: string[]): Promise<void> => {
    const now = Date.now();
    const stmt = db.prepare('UPDATE chat_profiles SET rank = ?, updated_at = ? WHERE id = ?');
    const reorder = db.transaction((ids: string[]) => {
      ids.forEach((id, index) => stmt.run(index, now, id));
    });
    reorder(orderedIds);
  });

  // Apply a profile: write its config to the global settings
  // Returns the profile data so the renderer can update local state
  ipcMain.handle('profiles:apply', async (_event, profileId: string): Promise<ChatProfile | null> => {
    const profile = db.prepare('SELECT * FROM chat_profiles WHERE id = ?').get(profileId) as ChatProfile | undefined;
    if (!profile) return null;

    // Validate MCP before applying any part of the profile. A corrupt snapshot
    // must not leave the other settings half-applied.
    const storedMcp = parseStoredMcpProfile(profile.mcp);

    const dbService = getDatabase();

    // 1. Apply AI provider/model selection
    if (profile.ai_provider_id && profile.ai_model_id) {
      const update = db.transaction(() => {
        db.prepare('UPDATE ai_providers SET is_default = 0').run();
        db.prepare('UPDATE ai_providers SET model = ?, is_default = 1 WHERE id = ?').run(
          profile.ai_model_id,
          profile.ai_provider_id
        );
      });
      update();
    }

    // 2. Apply system prompts config
    try {
      const spConfig = JSON.parse(profile.system_prompts);

      // Set global system prompt enabled flag
      if (spConfig.global_enabled !== undefined) {
        dbService.setSetting(KEYS.systemPromptsGlobal, String(!!spConfig.global_enabled));
      }

      // Set default prompts enabled flag
      if (spConfig.default_enabled !== undefined) {
        dbService.setSetting(KEYS.systemPromptsDefault, String(!!spConfig.default_enabled));
      }

      // Set custom prompts enabled flag
      if (spConfig.custom_enabled !== undefined) {
        dbService.setSetting(KEYS.systemPromptsCustom, String(!!spConfig.custom_enabled));
      }

      // Set dynamic prompts global toggle
      if (spConfig.dynamic_prompts_global_enabled !== undefined) {
        dbService.setSetting(KEYS.dynamicPromptsGlobal, String(!!spConfig.dynamic_prompts_global_enabled));
      }

      // Apply active prompt IDs: deactivate all first, then activate selected
      if (Array.isArray(spConfig.active_prompt_ids)) {
        db.prepare('UPDATE system_prompts SET is_active = 0').run();
        if (spConfig.active_prompt_ids.length > 0) {
          const placeholders = spConfig.active_prompt_ids.map(() => '?').join(',');
          db.prepare(`UPDATE system_prompts SET is_active = 1 WHERE id IN (${placeholders})`).run(
            ...spConfig.active_prompt_ids
          );
        }
      }

      // Apply dynamic prompt settings
      if (spConfig.dynamic_settings) {
        for (const [key, value] of Object.entries(spConfig.dynamic_settings)) {
          if (!DYNAMIC_PROMPT_KEYS.includes(key)) continue;
          dbService.setSetting(`dynamicPrompt_${key}`, String(!!value));
        }
      }
    } catch (e) {
      console.error('Failed to apply system prompts config:', e);
    }

    // 3. Apply tools config
    try {
      const toolsConfig = JSON.parse(profile.tools);

      // Set global tools enabled flag
      if (toolsConfig.global_enabled !== undefined) {
        dbService.setSetting(KEYS.toolsGlobal, String(!!toolsConfig.global_enabled));
      }

      // Apply category enabled states
      if (Array.isArray(toolsConfig.enabled_category_ids)) {
        db.prepare('UPDATE tool_categories SET enabled = 0').run();
        if (toolsConfig.enabled_category_ids.length > 0) {
          const placeholders = toolsConfig.enabled_category_ids.map(() => '?').join(',');
          db.prepare(`UPDATE tool_categories SET enabled = 1 WHERE id IN (${placeholders})`).run(
            ...toolsConfig.enabled_category_ids
          );
        }
      }

      // Apply tool enabled states
      if (Array.isArray(toolsConfig.enabled_tool_ids)) {
        db.prepare('UPDATE tools SET enabled = 0').run();
        if (toolsConfig.enabled_tool_ids.length > 0) {
          const placeholders = toolsConfig.enabled_tool_ids.map(() => '?').join(',');
          db.prepare(`UPDATE tools SET enabled = 1 WHERE id IN (${placeholders})`).run(
            ...toolsConfig.enabled_tool_ids
          );
        }
      }
    } catch (e) {
      console.error('Failed to apply tools config:', e);
    }

    // 4. Apply skills config
    try {
      const skillsConfig = JSON.parse(profile.skills);

      // Set global skills enabled flag
      if (skillsConfig.global_enabled !== undefined) {
        dbService.setSetting(KEYS.skillsGlobal, String(!!skillsConfig.global_enabled));
      }

      // Apply directory enabled states
      if (Array.isArray(skillsConfig.enabled_directory_ids)) {
        db.prepare('UPDATE skill_directories SET enabled = 0').run();
        if (skillsConfig.enabled_directory_ids.length > 0) {
          const placeholders = skillsConfig.enabled_directory_ids.map(() => '?').join(',');
          db.prepare(`UPDATE skill_directories SET enabled = 1 WHERE id IN (${placeholders})`).run(
            ...skillsConfig.enabled_directory_ids
          );
        }
      }

      // Apply skill enabled states
      if (Array.isArray(skillsConfig.enabled_skill_ids)) {
        db.prepare('UPDATE skills SET enabled = 0').run();
        if (skillsConfig.enabled_skill_ids.length > 0) {
          const placeholders = skillsConfig.enabled_skill_ids.map(() => '?').join(',');
          db.prepare(`UPDATE skills SET enabled = 1 WHERE id IN (${placeholders})`).run(
            ...skillsConfig.enabled_skill_ids
          );
        }
      }
    } catch (e) {
      console.error('Failed to apply skills config:', e);
    }

    // 5. Apply MCP config. NULL means this older profile does not manage MCP.
    if (storedMcp.kind === 'managed') {
      await getMcpService().applyProfileSnapshot(storedMcp.snapshot);
    }

    return profile;
  });

  // Snapshot current global settings into a profile config object
  ipcMain.handle('profiles:snapshot-current', async (): Promise<{
    ai_provider_id: string | null;
    ai_model_id: string | null;
    system_prompts: object;
    tools: object;
    skills: object;
    mcp: object;
  }> => {
    const dbService = getDatabase();

    // Get current default provider and its model
    const defaultProvider = db.prepare('SELECT id, model FROM ai_providers WHERE is_default = 1').get() as
      { id: string; model: string } | undefined;

    const activePrompts = db.prepare('SELECT id FROM system_prompts WHERE is_active = 1').all() as { id: number }[];

    // Get dynamic prompt settings
    const dynamicSettings: Record<string, boolean> = {};
    for (const key of DYNAMIC_PROMPT_KEYS) {
      dynamicSettings[key] = readBool(`dynamicPrompt_${key}`);
    }

    // Get tools config
    const enabledCategories = db.prepare('SELECT id FROM tool_categories WHERE enabled = 1').all() as { id: string }[];
    const enabledTools = db.prepare('SELECT id FROM tools WHERE enabled = 1').all() as { id: string }[];

    // Get skills config
    const enabledDirs = db.prepare('SELECT id FROM skill_directories WHERE enabled = 1').all() as { id: string }[];
    const enabledSkills = db.prepare('SELECT id FROM skills WHERE enabled = 1').all() as { id: number }[];

    return {
      ai_provider_id: defaultProvider?.id || null,
      ai_model_id: defaultProvider?.model || null,
      system_prompts: {
        global_enabled: readBool(KEYS.systemPromptsGlobal),
        default_enabled: readBool(KEYS.systemPromptsDefault),
        custom_enabled: readBool(KEYS.systemPromptsCustom),
        dynamic_prompts_global_enabled: readBool(KEYS.dynamicPromptsGlobal),
        active_prompt_ids: activePrompts.map(p => p.id),
        dynamic_settings: dynamicSettings,
      },
      tools: {
        global_enabled: readBool(KEYS.toolsGlobal),
        enabled_category_ids: enabledCategories.map(c => c.id),
        enabled_tool_ids: enabledTools.map(t => t.id),
      },
      skills: {
        global_enabled: readBool(KEYS.skillsGlobal),
        enabled_directory_ids: enabledDirs.map(d => d.id),
        enabled_skill_ids: enabledSkills.map(s => s.id),
      },
      mcp: getMcpService().captureProfileSnapshot(),
    };
  });

  // Set profile_id on a conversation
  ipcMain.handle('profiles:set-conversation-profile', async (_event, conversationId: string, profileId: string | null): Promise<void> => {
    db.prepare('UPDATE conversations SET profile_id = ? WHERE id = ?').run(profileId, conversationId);
  });

  // Get profile_id for a conversation
  ipcMain.handle('profiles:get-conversation-profile', async (_event, conversationId: string): Promise<string | null> => {
    const row = db.prepare('SELECT profile_id FROM conversations WHERE id = ?').get(conversationId) as { profile_id: string | null } | undefined;
    return row?.profile_id || null;
  });
}
