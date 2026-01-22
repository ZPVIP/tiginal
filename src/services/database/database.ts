import Database from 'better-sqlite3';
import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// Database schema version for migrations
const SCHEMA_VERSION = 7;

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
