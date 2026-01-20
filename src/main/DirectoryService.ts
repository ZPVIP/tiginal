import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// Config path: ~/.config/tiginal/directories.db
const CONFIG_DIR = path.join(os.homedir(), '.config', 'tiginal');
const DB_PATH = path.join(CONFIG_DIR, 'directories.db');

interface VisitRow {
  path: string;
  score: number;
  last_visited: number;
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
  }

  public recordVisit(dirPath: string) {
    if (!dirPath || !path.isAbsolute(dirPath)) return;

    // Check if ignored
    const isIgnored = this.db.prepare('SELECT 1 FROM ignored WHERE path = ?').get(dirPath);
    if (isIgnored) return;

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
    // Get top 20, filter for existence, return top 10
    // We prioritize score, then recency
    const query = `
      SELECT path FROM visits 
      WHERE path LIKE ? 
      ORDER BY score DESC, last_visited DESC 
      LIMIT 20
    `;
    
    // Normalize partial for SQL LIKE
    // If partial is "proj", we match "%proj%" or just "proj%"?
    // User probably wants prefix match for "cd " but fuzzy for "frequent"?
    // Let's stick to simple "contains" or "starts with" based on partial.
    // If partial is empty, return top frequent.
    // If partial has content, filtering is tricky. 
    // Usually "Frequent" section is "Static" unless filtered?
    // Let's say: if partial is empty, show top frequent.
    // If partial is not empty, filter frequent by substring.
    
    const likePattern = partial ? `%${partial}%` : '%';
    const rows = this.db.prepare(query).all(likePattern) as { path: string }[];

    return rows
        .map(r => r.path)
        .filter(p => fs.existsSync(p) && fs.statSync(p).isDirectory())
        .slice(0, 10);
  }

  public close() {
    this.db.close();
  }
}

export const directoryService = new DirectoryService();
