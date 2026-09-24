import Database from 'better-sqlite3';
import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import {
  BUILT_IN_R2T2_TRIAL_ENDPOINT,
  BUILT_IN_R2T2_TRIAL_ID,
  BUILT_IN_R2T2_TRIAL_MAX_SECONDS,
} from '../../shared/audio/types';
import { defaultR2T2ProviderOptions } from '../../shared/audio/r2t2';

// Database schema version for migrations
const SCHEMA_VERSION = 33;

/**
 * Database service for Tiginal
 * Uses better-sqlite3 for synchronous, fast SQLite operations
 */
export class DatabaseService {
  private db: Database.Database | null = null;
  private dbPath: string;

  constructor() {
    let baseDir: string;
    
    if (process.platform === 'win32') {
      // Windows: %APPDATA%\Tiginal
      baseDir = path.join(process.env.APPDATA || os.homedir(), 'Tiginal');
    } else {
      // macOS and Linux: ~/.config/tiginal
      baseDir = path.join(os.homedir(), '.config', 'tiginal');
    }

    const dbDir = path.join(baseDir, 'data');
    
    // Ensure data directory exists
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    this.dbPath = path.join(dbDir, 'tiginal.db');
  }

  /**
   * Initialize the database connection and run migrations
   */
  initialize(): void {
    this.db = new Database(this.dbPath);
    
    // Enable WAL mode for better concurrency
    this.db.pragma('journal_mode = WAL');
    
    // Run migrations
    this.runMigrations();
  }

  /**
   * Run database migrations
   */
  private runMigrations(): void {
    if (!this.db) throw new Error('Database not initialized');

    // Create schema_version table if not exists
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY
      )
    `);

    // Get current schema version
    const row = this.db.prepare('SELECT version FROM schema_version').get() as { version: number } | undefined;
    const currentVersion = row?.version || 0;

    // Run migrations based on version
    if (currentVersion < 1) {
      this.migrateV1();
    }

    if (currentVersion < 2) {
      this.migrateV2();
    }

    if (currentVersion < 3) {
      this.migrateV3();
    }

    if (currentVersion < 4) {
      this.migrateV4();
    }

    if (currentVersion < 5) {
      this.migrateV5();
    }

    if (currentVersion < 6) {
      this.migrateV6();
    }

    if (currentVersion < 7) {
      this.migrateV7();
    }

    if (currentVersion < 8) {
      this.migrateV8();
    }

    if (currentVersion < 9) {
      this.migrateV9();
    }

    if (currentVersion < 10) {
      this.migrateV10();
    }

    if (currentVersion < 11) {
      this.migrateV11();
    }

    if (currentVersion < 12) {
      this.migrateV12();
    }

    if (currentVersion < 13) {
      this.migrateV13();
    }

    if (currentVersion < 14) {
      this.migrateV14();
    }

    if (currentVersion < 15) {
      this.migrateV15();
    }

    if (currentVersion < 16) {
      this.migrateV16();
    }

    if (currentVersion < 17) {
      this.migrateV17();
    }

    if (currentVersion < 18) {
      this.migrateV18();
    }

    if (currentVersion < 19) {
      this.migrateV19();
    }

    if (currentVersion < 20) {
      this.migrateV20();
    }

    if (currentVersion < 21) {
      this.migrateV21();
    }

    if (currentVersion < 22) {
      this.migrateV22();
    }

    if (currentVersion < 23) {
      this.migrateV23();
    }

    if (currentVersion < 24) {
      this.migrateV24();
    }

    if (currentVersion < 25) {
      this.migrateV25();
    }

    if (currentVersion < 26) {
      this.migrateV26();
    }

    if (currentVersion < 27) {
      this.migrateV27();
    }

    if (currentVersion < 28) {
      this.migrateV28();
    }

    if (currentVersion < 29) {
      this.migrateV29();
    }

    if (currentVersion < 30) {
      this.migrateV30();
    }

    if (currentVersion < 31) {
      this.migrateV31();
    }

    if (currentVersion < 32) {
      this.migrateV32();
    }

    if (currentVersion < 33) {
      this.migrateV33();
    }

    // Update schema version
    if (currentVersion < SCHEMA_VERSION) {
      this.db.prepare('DELETE FROM schema_version').run();
      this.db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(SCHEMA_VERSION);
    }
  }

  /**
   * Migration v1: Initial schema
   */
  private migrateV1(): void {
    if (!this.db) throw new Error('Database not initialized');

    this.db.exec(`
      -- App settings (key-value store)
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      -- AI Providers
      CREATE TABLE IF NOT EXISTS ai_providers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('openai-compatible', 'copilot')),
        endpoint TEXT,
        api_key_encrypted TEXT,
        model TEXT NOT NULL,
        is_default INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- Conversations
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        title TEXT,
        provider_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (provider_id) REFERENCES ai_providers(id) ON DELETE SET NULL
      );

      -- Messages
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      );

      -- SSH Servers
      CREATE TABLE IF NOT EXISTS ssh_servers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        host TEXT NOT NULL,
        port INTEGER NOT NULL DEFAULT 22,
        username TEXT NOT NULL,
        auth_type TEXT NOT NULL CHECK (auth_type IN ('password', 'key', 'agent')),
        encrypted_credential TEXT,
        encrypted_passphrase TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- Create indexes
      CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at DESC);
    `);
  }

  /**
   * Migration v2: Add available_models to ai_providers
   */
  private migrateV2(): void {
    if (!this.db) throw new Error('Database not initialized');

    this.db.exec(`
      ALTER TABLE ai_providers ADD COLUMN available_models TEXT;
    `);
  }

  /**
   * Migration v3: Add custom_headers and auto_cors_fix to ai_providers
   */
  private migrateV3(): void {
    if (!this.db) throw new Error('Database not initialized');

    this.db.exec(`
      ALTER TABLE ai_providers ADD COLUMN custom_headers TEXT;
      ALTER TABLE ai_providers ADD COLUMN auto_cors_fix INTEGER DEFAULT 1;
    `);
  }

  /**
   * Migration v4: Create commands table for command history
   */
  private migrateV4(): void {
    if (!this.db) throw new Error('Database not initialized');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS commands (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        command TEXT UNIQUE NOT NULL,
        score INTEGER DEFAULT 1,
        last_used INTEGER,
        is_favorite INTEGER DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_commands_score ON commands(score DESC);
    `);
  }

  /**
   * Migration v5: Create blacklist tables
   */
  private migrateV5(): void {
    if (!this.db) throw new Error('Database not initialized');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS command_blacklist (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pattern TEXT UNIQUE NOT NULL
      );

      CREATE TABLE IF NOT EXISTS directory_blacklist (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pattern TEXT UNIQUE NOT NULL
      );
    `);
  }

  /**
   * Migration v6: Create command history tables
   */
  private migrateV6(): void {
    if (!this.db) throw new Error('Database not initialized');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS command_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        command TEXT NOT NULL,
        executed_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_command_history_time ON command_history(executed_at DESC);

      CREATE TABLE IF NOT EXISTS command_history_blacklist (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pattern TEXT UNIQUE NOT NULL
      );
    `);
  }

  /**
   * Migration v7: Create skill_directories and skills tables
   */
  private migrateV7(): void {
    if (!this.db) throw new Error('Database not initialized');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS skill_directories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT UNIQUE NOT NULL,
        enabled INTEGER DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS skills (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        skill_folder TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        skill_directory_id TEXT NOT NULL,
        scan_at INTEGER,
        enabled INTEGER DEFAULT 0,
        FOREIGN KEY (skill_directory_id) REFERENCES skill_directories(id) ON DELETE CASCADE,
        UNIQUE(skill_folder, skill_directory_id)
      );

      CREATE INDEX IF NOT EXISTS idx_skills_directory ON skills(skill_directory_id);
    `);
  }

  /**
   * Migration v8: Create tools table for AI tool definitions
   */
  private migrateV8(): void {
    if (!this.db) throw new Error('Database not initialized');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tools (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        input_schema TEXT NOT NULL,
        enabled INTEGER DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_tools_enabled ON tools(enabled);
    `);
  }

  /**
   * Migration v9: Revamp tools with categories and system flags
   * - Create tool_categories table
   * - Populate default categories
   * - Recreate tools table with category_id and is_system fields
   */
  private migrateV9(): void {
    if (!this.db) throw new Error('Database not initialized');

    // 1. Create tool_categories table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tool_categories (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        rank INTEGER DEFAULT 0,
        is_expanded INTEGER DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      
      CREATE INDEX IF NOT EXISTS idx_tool_categories_rank ON tool_categories(rank);
    `);

    // 2. Drop existing tools table (as per user request to clear old tools)
    this.db.exec('DROP TABLE IF EXISTS tools');

    // 3. Recreate tools table with new schema
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tools (
        id TEXT PRIMARY KEY,
        category_id TEXT,
        name TEXT UNIQUE NOT NULL,
        description TEXT,
        input_schema TEXT NOT NULL,
        is_system INTEGER DEFAULT 0,
        enabled INTEGER DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (category_id) REFERENCES tool_categories(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_tools_category ON tools(category_id);
      CREATE INDEX IF NOT EXISTS idx_tools_enabled_v9 ON tools(enabled);
    `);
  }

  /**
   * Migration v10: Add enabled status to tool_categories
   */
  private migrateV10(): void {
    if (!this.db) throw new Error('Database not initialized');

    this.db.exec(`
      ALTER TABLE tool_categories ADD COLUMN enabled INTEGER DEFAULT 1;
    `);
  }

  /**
   * Migration v11: Create system_prompts table and migrate from app_settings
   */
  private migrateV11(): void {
    if (!this.db) throw new Error('Database not initialized');

    // Create system_prompts table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS system_prompts (
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        is_default INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        rank INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_system_prompts_rank ON system_prompts(rank);
      CREATE INDEX IF NOT EXISTS idx_system_prompts_active ON system_prompts(is_active);
    `);

    // Delete old systemPrompt key from app_settings
    this.db.exec(`DELETE FROM app_settings WHERE key = 'systemPrompt'`);
  }

  /**
   * Migration v12: Create conversation_categories table and add fields to conversations
   */
  private migrateV12(): void {
    if (!this.db) throw new Error('Database not initialized');

    // Create conversation_categories table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversation_categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        is_pinned INTEGER DEFAULT 0,
        is_expanded INTEGER DEFAULT 1,
        rank INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      
      CREATE INDEX IF NOT EXISTS idx_conversation_categories_rank ON conversation_categories(rank);
    `);

    // Insert default category (id=1)
    const now = Date.now();
    const existing = this.db.prepare('SELECT id FROM conversation_categories WHERE id = 1').get();
    if (!existing) {
      this.db.prepare(`
        INSERT INTO conversation_categories (id, name, is_pinned, is_expanded, rank, created_at, updated_at)
        VALUES (1, 'Default', 0, 1, 0, ?, ?)
      `).run(now, now);
    }

    // Add new columns to conversations table
    // SQLite doesn't support adding FK constraints via ALTER, so we just add the column
    try {
      this.db.exec(`ALTER TABLE conversations ADD COLUMN category_id INTEGER DEFAULT 1`);
    } catch (e) {
      // Column might already exist
    }
    try {
      this.db.exec(`ALTER TABLE conversations ADD COLUMN is_pinned INTEGER DEFAULT 0`);
    } catch (e) {
      // Column might already exist
    }
    try {
      this.db.exec(`ALTER TABLE conversations ADD COLUMN is_favorite INTEGER DEFAULT 0`);
    } catch (e) {
      // Column might already exist
    }

    // Create indexes for new columns
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_conversations_category ON conversations(category_id);
      CREATE INDEX IF NOT EXISTS idx_conversations_pinned ON conversations(is_pinned);
      CREATE INDEX IF NOT EXISTS idx_conversations_favorite ON conversations(is_favorite);
    `);
  }

  /**
   * Migration v13: Add is_current field to conversation_categories
   * Only one category can be current at a time; new conversations go into the current category.
   */
  private migrateV13(): void {
    if (!this.db) throw new Error('Database not initialized');

    try {
      this.db.exec(`ALTER TABLE conversation_categories ADD COLUMN is_current INTEGER DEFAULT 0`);
    } catch (e) {
      // Column might already exist
    }

    // Set Default category (id=1) as current
    this.db.prepare(`UPDATE conversation_categories SET is_current = 1 WHERE id = 1`).run();
  }

  /**
   * Migration v14: Add token tracking to messages, conversations, and create statistics table
   */
  private migrateV14(): void {
    if (!this.db) throw new Error('Database not initialized');

    // Add token fields to messages table
    try { this.db.exec(`ALTER TABLE messages ADD COLUMN provider_id TEXT`); } catch (e) {}
    try { this.db.exec(`ALTER TABLE messages ADD COLUMN model_id TEXT`); } catch (e) {}
    try { this.db.exec(`ALTER TABLE messages ADD COLUMN prompt_tokens INTEGER DEFAULT 0`); } catch (e) {}
    try { this.db.exec(`ALTER TABLE messages ADD COLUMN completion_tokens INTEGER DEFAULT 0`); } catch (e) {}
    try { this.db.exec(`ALTER TABLE messages ADD COLUMN reasoning_tokens INTEGER DEFAULT 0`); } catch (e) {}
    try { this.db.exec(`ALTER TABLE messages ADD COLUMN cached_tokens INTEGER DEFAULT 0`); } catch (e) {}
    try { this.db.exec(`ALTER TABLE messages ADD COLUMN total_tokens INTEGER DEFAULT 0`); } catch (e) {}

    // Add tokens JSON field to conversations table
    try { this.db.exec(`ALTER TABLE conversations ADD COLUMN tokens TEXT`); } catch (e) {}

    // Create statistics table for daily token aggregates
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS statistics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        done INTEGER DEFAULT 0,
        provider_id TEXT NOT NULL,
        model_id TEXT NOT NULL DEFAULT '',
        prompt_tokens INTEGER DEFAULT 0,
        cached_tokens INTEGER DEFAULT 0,
        completion_tokens INTEGER DEFAULT 0,
        reasoning_tokens INTEGER DEFAULT 0,
        total_tokens INTEGER DEFAULT 0,
        UNIQUE(date, provider_id)
      );

      CREATE INDEX IF NOT EXISTS idx_statistics_date ON statistics(date);
      CREATE INDEX IF NOT EXISTS idx_statistics_done ON statistics(done);
    `);
  }

  /**
   * Migration v15: Create chat_profiles table and add profile_id to conversations
   */
  private migrateV15(): void {
    if (!this.db) throw new Error('Database not initialized');

    // Create chat_profiles table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chat_profiles (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        enabled INTEGER DEFAULT 1,
        ai_provider_id TEXT,
        ai_model_id TEXT,
        system_prompts TEXT NOT NULL DEFAULT '{}',
        tools TEXT NOT NULL DEFAULT '{}',
        skills TEXT NOT NULL DEFAULT '{}',
        rank INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (ai_provider_id) REFERENCES ai_providers(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_chat_profiles_rank ON chat_profiles(rank);
      CREATE INDEX IF NOT EXISTS idx_chat_profiles_enabled ON chat_profiles(enabled);
    `);

    // Add profile_id column to conversations
    try {
      this.db.exec(`ALTER TABLE conversations ADD COLUMN profile_id TEXT DEFAULT NULL`);
    } catch (e) {
      // Column might already exist
    }
  }

  /**
   * Migration v16: Store assistant reasoning text alongside the message
   */
  private migrateV16(): void {
    if (!this.db) throw new Error('Database not initialized');

    try {
      this.db.exec(`ALTER TABLE messages ADD COLUMN reasoning TEXT`);
    } catch (e) {
      // Column might already exist
    }
  }

  /**
   * Migration v17: Create mcp_servers table
   *
   * A server is stored as a name plus a raw JSON config so the UI can edit and
   * import the same shape other MCP clients use. `tools_cache` holds the last
   * successful tools/list result so the UI can render without reconnecting.
   */
  private migrateV17(): void {
    if (!this.db) throw new Error('Database not initialized');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS mcp_servers (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        type TEXT NOT NULL DEFAULT 'stdio',
        description TEXT,
        config TEXT NOT NULL DEFAULT '{}',
        is_builtin INTEGER NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 0,
        disabled_tools TEXT NOT NULL DEFAULT '[]',
        tools_cache TEXT,
        last_error TEXT,
        rank INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_mcp_servers_rank ON mcp_servers(rank);
      CREATE INDEX IF NOT EXISTS idx_mcp_servers_enabled ON mcp_servers(enabled);
    `);
  }

  /**
   * Migration v18: Record how large the context actually was for a turn
   *
   * prompt_tokens is accumulated across every turn of the agent loop, so it
   * over-reports once tools are involved. context_tokens holds just the final
   * turn's prompt + completion, which is what the next request starts from.
   */
  private migrateV18(): void {
    if (!this.db) throw new Error('Database not initialized');

    try {
      this.db.exec(`ALTER TABLE messages ADD COLUMN context_tokens INTEGER DEFAULT 0`);
    } catch (e) {
      // Column might already exist
    }
  }

  /**
   * Migration v19: Remember images attached to a message
   *
   * Stores the paths of files written under <workspace>/pictures, not the image
   * data, so conversation rows stay small and the originals stay browsable.
   */
  private migrateV19(): void {
    if (!this.db) throw new Error('Database not initialized');

    try {
      this.db.exec(`ALTER TABLE messages ADD COLUMN images TEXT`);
    } catch (e) {
      // Column might already exist
    }
  }

  /**
   * Migration v20: Preserve whether cache telemetry reported a hit or miss
   *
   * A zero cached_tokens value is ambiguous on older rows because providers
   * often omitted cache telemetry entirely. Keep those rows unknown.
   */
  private migrateV20(): void {
    if (!this.db) throw new Error('Database not initialized');

    try {
      this.db.exec(`ALTER TABLE messages ADD COLUMN cache_status TEXT DEFAULT 'unknown'`);
    } catch (e) {
      // Column might already exist.
    }
    this.db.exec(`UPDATE messages SET cache_status = 'hit' WHERE cached_tokens > 0`);
  }

  /** Migration v21: Attribute title-generation usage to the first reply. */
  private migrateV21(): void {
    if (!this.db) throw new Error('Database not initialized');

    try {
      this.db.exec(`ALTER TABLE messages ADD COLUMN title_tokens INTEGER DEFAULT 0`);
    } catch (e) {
      // Column might already exist.
    }
  }

  /** Migration v22: Store local default arguments for tool execution. */
  private migrateV22(): void {
    if (!this.db) throw new Error('Database not initialized');

    try {
      this.db.exec(`ALTER TABLE tools ADD COLUMN default_input TEXT NOT NULL DEFAULT '{}'`);
    } catch {
      // Column might already exist.
    }
  }

  /** Migration v23: Store the final LLM request separately from total consumption. */
  private migrateV23(): void {
    if (!this.db) throw new Error('Database not initialized');

    const columns = [
      'request_prompt_tokens INTEGER',
      'request_completion_tokens INTEGER',
      'request_cached_tokens INTEGER',
      'request_cache_status TEXT',
      'request_total_tokens INTEGER',
    ];
    for (const column of columns) {
      try {
        this.db.exec(`ALTER TABLE messages ADD COLUMN ${column}`);
      } catch {
        // Column might already exist.
      }
    }
  }

  /** Migration v24: Let chat profiles optionally manage MCP selection. */
  private migrateV24(): void {
    if (!this.db) throw new Error('Database not initialized');

    try {
      this.db.exec(`ALTER TABLE chat_profiles ADD COLUMN mcp TEXT DEFAULT NULL`);
    } catch {
      // Column might already exist.
    }
  }

  /** Migration v25: Store the provider request format and token-limit field. */
  private migrateV25(): void {
    if (!this.db) throw new Error('Database not initialized');

    try {
      this.db.exec(`ALTER TABLE ai_providers ADD COLUMN api_format TEXT NOT NULL DEFAULT 'chat-completions'`);
    } catch {
      // Column might already exist.
    }
    try {
      this.db.exec(`ALTER TABLE ai_providers ADD COLUMN use_max_completion_tokens INTEGER NOT NULL DEFAULT 0`);
    } catch {
      // Column might already exist.
    }

    this.db.exec(`
      UPDATE ai_providers
      SET api_format = 'anthropic-messages'
      WHERE lower(endpoint) LIKE '%api.anthropic.com%'
    `);
    this.db.exec(`
      UPDATE ai_providers
      SET use_max_completion_tokens = 1
      WHERE lower(endpoint) LIKE '%api.openai.com%'
    `);
  }

  /** Migration v26: Link a configured provider to the downloaded model catalog. */
  private migrateV26(): void {
    if (!this.db) throw new Error('Database not initialized');

    try {
      this.db.exec(`ALTER TABLE ai_providers ADD COLUMN catalog_provider TEXT DEFAULT NULL`);
    } catch {
      // Column might already exist.
    }
  }

  /**
   * Migration v27: Developer Credential Manager metadata.
   *
   * Only `credential_entries.value_encrypted` holds a secret, and it holds
   * ciphertext from the existing CryptoService. The session and audit tables
   * record names, counts, and outcomes so a deployment can be traced without
   * the trail itself becoming a place secrets leak to.
   *
   * `parent_id` is `''` rather than NULL for a root group: SQLite treats NULLs
   * as distinct in a unique index, so two roots could otherwise share a slug
   * and break CLI addressing.
   */
  private migrateV27(): void {
    if (!this.db) throw new Error('Database not initialized');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS credential_groups (
        id TEXT PRIMARY KEY,
        parent_id TEXT NOT NULL DEFAULT '',
        slug TEXT NOT NULL,
        name TEXT NOT NULL,
        scope TEXT NOT NULL DEFAULT 'project',
        kind TEXT NOT NULL DEFAULT 'generic',
        root_path TEXT,
        allowed_commands TEXT NOT NULL DEFAULT '[]',
        rank INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_credential_groups_slug
        ON credential_groups(parent_id, slug);
      CREATE INDEX IF NOT EXISTS idx_credential_groups_parent
        ON credential_groups(parent_id, rank);

      CREATE TABLE IF NOT EXISTS credential_files (
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL,
        absolute_path TEXT NOT NULL UNIQUE,
        relative_path TEXT NOT NULL DEFAULT '',
        format TEXT NOT NULL,
        injection TEXT NOT NULL DEFAULT 'env',
        safe_fingerprint TEXT,
        file_mode INTEGER,
        swap_during_session INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (group_id) REFERENCES credential_groups(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_credential_files_group
        ON credential_files(group_id);

      CREATE TABLE IF NOT EXISTS credential_entries (
        id TEXT PRIMARY KEY,
        file_id TEXT NOT NULL,
        key_name TEXT NOT NULL,
        secret_type TEXT NOT NULL,
        value_encrypted TEXT NOT NULL,
        fake_value TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (file_id) REFERENCES credential_files(id) ON DELETE CASCADE
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_credential_entries_key
        ON credential_entries(file_id, key_name);

      CREATE TABLE IF NOT EXISTS credential_sessions (
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL,
        status TEXT NOT NULL,
        access_mode TEXT NOT NULL,
        approved_by TEXT,
        tmp_dir TEXT,
        pid INTEGER,
        command_summary TEXT,
        exit_code INTEGER,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        ended_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_credential_sessions_group
        ON credential_sessions(group_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_credential_sessions_status
        ON credential_sessions(status);

      CREATE TABLE IF NOT EXISTS credential_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at INTEGER NOT NULL,
        group_id TEXT,
        session_id TEXT,
        event TEXT NOT NULL,
        detail TEXT NOT NULL DEFAULT ''
      );

      CREATE INDEX IF NOT EXISTS idx_credential_audit_at
        ON credential_audit(at DESC);
    `);
  }

  /**
   * Migration v28: the user declares what a managed credential file is.
   *
   * `kind` records which add action created the row. A path cannot say whether
   * a file is a whole-file secret, a key/value file, or an SSH private key,
   * and the value rules differ for each, so guessing from the name was the
   * thing to remove. Existing rows are backfilled from their format, which is
   * exactly what the old detection produced.
   *
   * `swap_during_session` goes with it. The session dialog already chooses
   * between writing real values at the original paths and authorizing the CLI,
   * so a per-file opt-in was a second place to say the same thing.
   */
  private migrateV28(): void {
    if (!this.db) throw new Error('Database not initialized');

    try {
      this.db.exec(`ALTER TABLE credential_files ADD COLUMN kind TEXT NOT NULL DEFAULT 'env'`);
    } catch {
      // Column might already exist.
    }
    try {
      this.db.exec(`ALTER TABLE credential_files ADD COLUMN public_key_path TEXT`);
    } catch {
      // Column might already exist.
    }

    this.db.exec(`UPDATE credential_files SET kind = 'key' WHERE format = 'opaque'`);

    try {
      this.db.exec(`ALTER TABLE credential_files DROP COLUMN swap_during_session`);
    } catch {
      // An older SQLite cannot drop a column. Nothing reads it either way.
    }
  }

  /** Migration v29: speech providers and persisted audio sessions. */
  private migrateV29(): void {
    if (!this.db) throw new Error('Database not initialized');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS speech_providers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        protocol TEXT NOT NULL CHECK (protocol IN ('r2t2-rstream', 'r2t2-native')),
        endpoint TEXT NOT NULL,
        auth_mode TEXT NOT NULL CHECK (auth_mode IN ('none', 'query-token', 'handshake-secret')),
        credential_encrypted TEXT,
        built_in_kind TEXT CHECK (built_in_kind IS NULL OR built_in_kind = 'r2t2-online-trial'),
        user_modified INTEGER NOT NULL DEFAULT 0,
        max_session_seconds INTEGER,
        default_language TEXT NOT NULL,
        options_json TEXT NOT NULL DEFAULT '{}',
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_speech_providers_built_in
        ON speech_providers(built_in_kind)
        WHERE built_in_kind IS NOT NULL;

      CREATE TABLE IF NOT EXISTS audio_sessions (
        id TEXT PRIMARY KEY,
        source_kind TEXT NOT NULL CHECK (source_kind IN ('microphone', 'file')),
        source_path TEXT,
        recording_path TEXT,
        speech_provider_id TEXT,
        recognition_language TEXT NOT NULL,
        transcript TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL CHECK (status IN ('connecting', 'recording', 'finalizing', 'completed', 'failed', 'aborted')),
        duration_ms INTEGER NOT NULL DEFAULT 0,
        started_at_iso TEXT NOT NULL,
        timezone_offset_minutes INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (speech_provider_id) REFERENCES speech_providers(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_audio_sessions_created
        ON audio_sessions(created_at DESC);
    `);

    const now = Date.now();
    this.db.prepare(`
      INSERT OR IGNORE INTO speech_providers (
        id, name, protocol, endpoint, auth_mode, credential_encrypted,
        built_in_kind, user_modified, max_session_seconds, default_language,
        options_json, enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, NULL, ?, 0, ?, ?, ?, 1, ?, ?)
    `).run(
      BUILT_IN_R2T2_TRIAL_ID,
      'R2T2 Online Demo',
      'r2t2-rstream',
      BUILT_IN_R2T2_TRIAL_ENDPOINT,
      'query-token',
      'r2t2-online-trial',
      BUILT_IN_R2T2_TRIAL_MAX_SECONDS,
      'zh',
      JSON.stringify(defaultR2T2ProviderOptions()),
      now,
      now,
    );
  }

  /** Migration v30: local model library, downloads, favorites, and run profiles. */
  private migrateV30(): void {
    if (!this.db) throw new Error('Database not initialized');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS model_directories (
        path TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('user')),
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS model_favorites (
        source TEXT NOT NULL CHECK (source IN ('huggingface', 'modelscope')),
        repo_id TEXT NOT NULL,
        revision TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (source, repo_id, revision)
      );

      CREATE TABLE IF NOT EXISTS model_downloads (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL CHECK (source IN ('huggingface', 'modelscope')),
        repo_id TEXT NOT NULL,
        revision TEXT NOT NULL,
        target_path TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('queued', 'downloading', 'completed', 'failed', 'cancelled')),
        downloaded_bytes INTEGER NOT NULL DEFAULT 0,
        total_bytes INTEGER,
        error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS model_run_profiles (
        id TEXT PRIMARY KEY,
        engine_id TEXT NOT NULL,
        model_path TEXT NOT NULL,
        display_name TEXT NOT NULL,
        parameters_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_model_downloads_updated
        ON model_downloads(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_model_run_profiles_updated
        ON model_run_profiles(updated_at DESC);
    `);
  }

  /** Migration v31: identify an individual file within a model download. */
  private migrateV31(): void {
    if (!this.db) throw new Error('Database not initialized');

    try {
      this.db.exec(`ALTER TABLE model_downloads ADD COLUMN file_path TEXT`);
    } catch {
      // Column might already exist.
    }

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_model_downloads_file
        ON model_downloads(source, repo_id, revision, file_path, updated_at DESC);
    `);
  }

  /** Migration v32: retain the exact command shown for a local model service. */
  private migrateV32(): void {
    if (!this.db) throw new Error('Database not initialized');

    try {
      this.db.exec(`ALTER TABLE model_run_profiles ADD COLUMN command_line TEXT`);
    } catch {
      // Column might already exist.
    }
  }

  /** Migration v33: persist user-defined names for downloaded models. */
  private migrateV33(): void {
    if (!this.db) throw new Error('Database not initialized');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS model_aliases (
        storage_path TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  }

  /**
   * Get a setting value
   */
  getSetting(key: string): string | null {
    if (!this.db) throw new Error('Database not initialized');
    const row = this.db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value || null;
  }

  /**
   * Set a setting value
   */
  setSetting(key: string, value: string): void {
    if (!this.db) throw new Error('Database not initialized');
    this.db.prepare(`
      INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)
    `).run(key, value);
  }

  /**
   * Get the underlying database instance for direct queries
   */
  getDb(): Database.Database {
    if (!this.db) throw new Error('Database not initialized');
    return this.db;
  }
  
  /**
   * Get the path to the database file
   */
  getDbPath(): string {
    return this.dbPath;
  }

  /**
   * Close the database connection
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

// Singleton instance
let dbInstance: DatabaseService | null = null;

export function getDatabase(): DatabaseService {
  if (!dbInstance) {
    dbInstance = new DatabaseService();
    dbInstance.initialize();
  }
  return dbInstance;
}
