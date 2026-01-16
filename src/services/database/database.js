"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DatabaseService = void 0;
exports.getDatabase = getDatabase;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const electron_1 = require("electron");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
// Database schema version for migrations
const SCHEMA_VERSION = 1;
/**
 * Database service for Tiginal
 * Uses better-sqlite3 for synchronous, fast SQLite operations
 */
class DatabaseService {
    db = null;
    dbPath;
    constructor() {
        // Use userData directory for production, project root for development
        const userDataPath = electron_1.app?.getPath?.('userData') || process.cwd();
        const dbDir = path.join(userDataPath, 'data');
        // Ensure data directory exists
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }
        this.dbPath = path.join(dbDir, 'tiginal.db');
    }
    /**
     * Initialize the database connection and run migrations
     */
    initialize() {
        this.db = new better_sqlite3_1.default(this.dbPath);
        // Enable WAL mode for better concurrency
        this.db.pragma('journal_mode = WAL');
        // Run migrations
        this.runMigrations();
    }
    /**
     * Run database migrations
     */
    runMigrations() {
        if (!this.db)
            throw new Error('Database not initialized');
        // Create schema_version table if not exists
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY
      )
    `);
        // Get current schema version
        const row = this.db.prepare('SELECT version FROM schema_version').get();
        const currentVersion = row?.version || 0;
        // Run migrations based on version
        if (currentVersion < 1) {
            this.migrateV1();
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
    migrateV1() {
        if (!this.db)
            throw new Error('Database not initialized');
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
     * Get a setting value
     */
    getSetting(key) {
        if (!this.db)
            throw new Error('Database not initialized');
        const row = this.db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
        return row?.value || null;
    }
    /**
     * Set a setting value
     */
    setSetting(key, value) {
        if (!this.db)
            throw new Error('Database not initialized');
        this.db.prepare(`
      INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)
    `).run(key, value);
    }
    /**
     * Get the underlying database instance for direct queries
     */
    getDb() {
        if (!this.db)
            throw new Error('Database not initialized');
        return this.db;
    }
    /**
     * Close the database connection
     */
    close() {
        if (this.db) {
            this.db.close();
            this.db = null;
        }
    }
}
exports.DatabaseService = DatabaseService;
// Singleton instance
let dbInstance = null;
function getDatabase() {
    if (!dbInstance) {
        dbInstance = new DatabaseService();
        dbInstance.initialize();
    }
    return dbInstance;
}
