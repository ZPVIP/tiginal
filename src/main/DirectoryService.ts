import Database from 'better-sqlite3';
import { configDir } from './utils/paths';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// Config path: <config dir>/directories.db
const CONFIG_DIR = configDir();
const DB_PATH = path.join(CONFIG_DIR, 'directories.db');

interface VisitRow {
  path: string;
  score: number;
  last_visited: number;
}

interface BlacklistRow {
  id: number;
  pattern: string;
}

export class DirectoryService {
  private db: Database.Database;

  constructor() {
    this.ensureConfigDir();
    this.db = new Database(DB_PATH);
    this.init();
  }

  private ensureConfigDir() {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
  }

  private init() {
    // Visits table: tracks score and last visited time
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS visits (
        path TEXT PRIMARY KEY,
        score INTEGER DEFAULT 1,
        last_visited INTEGER
      )
    `);

    // Ignored table: tracks paths user explicitly deleted
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ignored (
        path TEXT PRIMARY KEY
      )
    `);

    // Blacklist table: regex patterns
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS directory_blacklist (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pattern TEXT UNIQUE NOT NULL
      )
    `);
  }

  /**
   * Check if directory matches any blacklist pattern
   */
  private isBlacklisted(dirPath: string): boolean {
    const patterns = this.db.prepare('SELECT pattern FROM directory_blacklist').all() as { pattern: string }[];
    
    for (const { pattern } of patterns) {
      try {
        const regex = new RegExp(pattern);
        if (regex.test(dirPath)) return true;
      } catch {
        // Invalid regex, treat as literal match
        if (dirPath.includes(pattern)) return true;
      }
    }
    return false;
  }

  public recordVisit(dirPath: string) {
    if (!dirPath || !path.isAbsolute(dirPath)) return;

    // Check if ignored
    const isIgnored = this.db.prepare('SELECT 1 FROM ignored WHERE path = ?').get(dirPath);
    if (isIgnored) return;

    // Check blacklist
    if (this.isBlacklisted(dirPath)) return;

    const now = Date.now();
    
    // Upsert visit
    const stmt = this.db.prepare(`
      INSERT INTO visits (path, score, last_visited)
      VALUES (?, 1, ?)
      ON CONFLICT(path) DO UPDATE SET
        score = score + 1,
        last_visited = ?
    `);
    
    stmt.run(dirPath, now, now);
  }

  public ignoreDirectory(dirPath: string) {
    if (!dirPath) return;

    this.db.transaction(() => {
        this.db.prepare('INSERT OR IGNORE INTO ignored (path) VALUES (?)').run(dirPath);
        this.db.prepare('DELETE FROM visits WHERE path = ?').run(dirPath);
    })();
  }

  public getFrequentDirectories(partial: string): string[] {
    const query = `
      SELECT path FROM visits 
      WHERE path LIKE ? 
      ORDER BY score DESC, last_visited DESC 
      LIMIT 20
    `;
    
    const likePattern = partial ? `%${partial}%` : '%';
    const rows = this.db.prepare(query).all(likePattern) as { path: string }[];

    return rows
        .map(r => r.path)
        .filter(p => fs.existsSync(p) && fs.statSync(p).isDirectory())
        .slice(0, 10);
  }

  public getAllDirectories(): { path: string; score: number; last_visited: number }[] {
    const rows = this.db.prepare(`
      SELECT path, score, last_visited
      FROM visits
      ORDER BY score DESC, last_visited DESC
    `).all() as { path: string; score: number; last_visited: number }[];
    return rows;
  }

  // === Blacklist CRUD ===

  getBlacklist(): BlacklistRow[] {
    return this.db.prepare('SELECT id, pattern FROM directory_blacklist ORDER BY id').all() as BlacklistRow[];
  }

  addBlacklist(pattern: string): void {
    if (!pattern || !pattern.trim()) return;
    this.db.prepare('INSERT OR IGNORE INTO directory_blacklist (pattern) VALUES (?)').run(pattern.trim());
  }

  updateBlacklist(id: number, pattern: string): void {
    this.db.prepare('UPDATE directory_blacklist SET pattern = ? WHERE id = ?').run(pattern.trim(), id);
  }

  removeBlacklist(id: number): void {
    this.db.prepare('DELETE FROM directory_blacklist WHERE id = ?').run(id);
  }

  /**
   * Cleanup low-frequency directories
   */
  cleanupLowFrequency(minScore: number = 2): number {
    const result = this.db.prepare('DELETE FROM visits WHERE score <= ?').run(minScore);
    return result.changes;
  }

  public close() {
    this.db.close();
  }
}

export const directoryService = new DirectoryService();

