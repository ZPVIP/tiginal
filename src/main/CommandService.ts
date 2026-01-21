import { getDatabase } from '../services/database/database';

interface CommandRow {
  id: number;
  command: string;
  score: number;
  last_used: number;
  is_favorite: number;
}

interface BlacklistRow {
  id: number;
  pattern: string;
}

export class CommandService {
  private getDb() {
    return getDatabase().getDb();
  }

  /**
   * Check if command matches any blacklist pattern
   * Patterns are automatically wrapped with ^...$ for exact matching
   */
  private isBlacklisted(command: string): boolean {
    const db = this.getDb();
    const patterns = db.prepare('SELECT pattern FROM command_blacklist').all() as { pattern: string }[];
    
    for (const { pattern } of patterns) {
      try {
        // Auto-wrap with ^...$ for exact matching
        const wrappedPattern = `^${pattern}$`;
        const regex = new RegExp(wrappedPattern);
        if (regex.test(command)) return true;
      } catch {
        // Invalid regex, treat as exact literal match
        if (command === pattern) return true;
      }
    }
    return false;
  }

  /**
   * Record a command execution (upsert: increment score or insert)
   */
  recordCommand(command: string): void {
    if (!command || command.trim().length === 0) return;
    const cmd = command.trim();
    
    // Check blacklist
    if (this.isBlacklisted(cmd)) {
      console.log('[CommandService] Command blacklisted, not recording:', cmd);
      return;
    }

    console.log('[CommandService] Recording command to DB:', cmd);
    const now = Date.now();
    const db = this.getDb();
    const stmt = db.prepare(`
      INSERT INTO commands (command, score, last_used, is_favorite)
      VALUES (?, 1, ?, 0)
      ON CONFLICT(command) DO UPDATE SET
        score = score + 1,
        last_used = ?
    `);
    stmt.run(cmd, now, now);
    console.log('[CommandService] Command recorded successfully');
  }

  /**
   * Add or update a favorite command
   */
  addFavorite(command: string): void {
    if (!command || command.trim().length === 0) return;
    const cmd = command.trim();
    const now = Date.now();

    const db = this.getDb();
    const stmt = db.prepare(`
      INSERT INTO commands (command, score, last_used, is_favorite)
      VALUES (?, 1, ?, 1)
      ON CONFLICT(command) DO UPDATE SET
        is_favorite = 1,
        last_used = ?
    `);
    stmt.run(cmd, now, now);
  }

  /**
   * Remove a command from history
   */
  removeCommand(command: string): void {
    if (!command) return;
    const db = this.getDb();
    db.prepare('DELETE FROM commands WHERE command = ?').run(command.trim());
  }

  /**
   * Get command suggestions by prefix, sorted by score
   */
  getCommandSuggestions(prefix: string): string[] {
    const db = this.getDb();
    const pattern = prefix ? `${prefix}%` : '%';
    
    const rows = db.prepare(`
      SELECT command FROM commands
      WHERE command LIKE ?
      ORDER BY score DESC, last_used DESC
      LIMIT 20
    `).all(pattern) as { command: string }[];

    return rows.map(r => r.command);
  }

  /**
   * Get all commands for CRUD in settings
   */
  getAllCommands(): CommandRow[] {
    const db = this.getDb();
    return db.prepare(`
      SELECT id, command, score, last_used, is_favorite
      FROM commands
      ORDER BY score DESC, last_used DESC
    `).all() as CommandRow[];
  }

  /**
   * Update command (for editing in settings)
   */
  updateCommand(id: number, newCommand: string): void {
    const db = this.getDb();
    db.prepare('UPDATE commands SET command = ? WHERE id = ?').run(newCommand.trim(), id);
  }

  /**
   * Toggle favorite status
   */
  toggleFavorite(id: number): void {
    const db = this.getDb();
    db.prepare('UPDATE commands SET is_favorite = 1 - is_favorite WHERE id = ?').run(id);
  }

  // === Blacklist CRUD ===

  getBlacklist(): BlacklistRow[] {
    const db = this.getDb();
    return db.prepare('SELECT id, pattern FROM command_blacklist ORDER BY id').all() as BlacklistRow[];
  }

  addBlacklist(pattern: string): void {
    if (!pattern || !pattern.trim()) return;
    // Strip ^...$ if user added them manually
    let cleaned = pattern.trim();
    if (cleaned.startsWith('^')) cleaned = cleaned.slice(1);
    if (cleaned.endsWith('$')) cleaned = cleaned.slice(0, -1);
    const db = this.getDb();
    db.prepare('INSERT OR IGNORE INTO command_blacklist (pattern) VALUES (?)').run(cleaned);
  }

  updateBlacklist(id: number, pattern: string): void {
    // Strip ^...$ if user added them manually
    let cleaned = pattern.trim();
    if (cleaned.startsWith('^')) cleaned = cleaned.slice(1);
    if (cleaned.endsWith('$')) cleaned = cleaned.slice(0, -1);
    const db = this.getDb();
    db.prepare('UPDATE command_blacklist SET pattern = ? WHERE id = ?').run(cleaned, id);
  }

  removeBlacklist(id: number): void {
    const db = this.getDb();
    db.prepare('DELETE FROM command_blacklist WHERE id = ?').run(id);
  }

  /**
   * Cleanup low-frequency commands
   */
  cleanupLowFrequency(minScore: number = 2): number {
    const db = this.getDb();
    const result = db.prepare('DELETE FROM commands WHERE score <= ? AND is_favorite = 0').run(minScore);
    return result.changes;
  }
}

export const commandService = new CommandService();

