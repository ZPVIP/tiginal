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
    if (this.isBlacklisted(cmd)) return;

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

  // ============================================
  // Command History Methods
  // ============================================

  /**
   * Check if command matches any history blacklist pattern
   * Patterns are automatically wrapped with ^...$ for exact matching
   */
  private isHistoryBlacklisted(command: string): boolean {
    const db = this.getDb();
    const patterns = db.prepare('SELECT pattern FROM command_history_blacklist').all() as { pattern: string }[];
    
    for (const { pattern } of patterns) {
      try {
        const wrappedPattern = `^${pattern}$`;
        const regex = new RegExp(wrappedPattern);
        if (regex.test(command)) return true;
      } catch {
        if (command === pattern) return true;
      }
    }
    return false;
  }

  /**
   * Record command to history (chronological, allows duplicates)
   */
  recordHistory(command: string): void {
    if (!command || command.trim().length === 0) return;
    const cmd = command.trim();
    
    if (this.isHistoryBlacklisted(cmd)) return;

    const now = Date.now();
    const db = this.getDb();
    db.prepare('INSERT INTO command_history (command, executed_at) VALUES (?, ?)').run(cmd, now);
  }

  /**
   * Trim history to keep only the most recent N entries
   */
  trimHistory(maxCount: number): number {
    const db = this.getDb();
    // Get the id of the Nth newest record
    const cutoffRow = db.prepare(`
      SELECT id FROM command_history 
      ORDER BY executed_at DESC 
      LIMIT 1 OFFSET ?
    `).get(maxCount - 1) as { id: number } | undefined;

    if (!cutoffRow) return 0;

    const result = db.prepare('DELETE FROM command_history WHERE id < ?').run(cutoffRow.id);
    return result.changes;
  }

  /**
   * Get recent history with pagination (newest first)
   */
  getRecentHistory(offset: number = 0, limit: number = 15): { id: number; command: string; executed_at: number }[] {
    const db = this.getDb();
    return db.prepare(`
      SELECT id, command, executed_at FROM command_history
      ORDER BY executed_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset) as { id: number; command: string; executed_at: number }[];
  }

  /**
   * Get total history count
   */
  getHistoryCount(): number {
    const db = this.getDb();
    const row = db.prepare('SELECT COUNT(*) as count FROM command_history').get() as { count: number };
    return row.count;
  }

  /**
   * Get all history for settings display
   */
  getAllHistory(): { id: number; command: string; executed_at: number }[] {
    const db = this.getDb();
    return db.prepare(`
      SELECT id, command, executed_at FROM command_history
      ORDER BY executed_at DESC
    `).all() as { id: number; command: string; executed_at: number }[];
  }

  /**
   * Delete a single history entry
   */
  deleteHistory(id: number): void {
    const db = this.getDb();
    db.prepare('DELETE FROM command_history WHERE id = ?').run(id);
  }

  /**
   * Clear all history
   */
  clearAllHistory(): void {
    const db = this.getDb();
    db.prepare('DELETE FROM command_history').run();
  }

  // === History Blacklist CRUD ===

  getHistoryBlacklist(): { id: number; pattern: string }[] {
    const db = this.getDb();
    return db.prepare('SELECT id, pattern FROM command_history_blacklist ORDER BY id').all() as { id: number; pattern: string }[];
  }

  addHistoryBlacklist(pattern: string): void {
    if (!pattern || !pattern.trim()) return;
    let cleaned = pattern.trim();
    if (cleaned.startsWith('^')) cleaned = cleaned.slice(1);
    if (cleaned.endsWith('$')) cleaned = cleaned.slice(0, -1);
    const db = this.getDb();
    db.prepare('INSERT OR IGNORE INTO command_history_blacklist (pattern) VALUES (?)').run(cleaned);
  }

  updateHistoryBlacklist(id: number, pattern: string): void {
    let cleaned = pattern.trim();
    if (cleaned.startsWith('^')) cleaned = cleaned.slice(1);
    if (cleaned.endsWith('$')) cleaned = cleaned.slice(0, -1);
    const db = this.getDb();
    db.prepare('UPDATE command_history_blacklist SET pattern = ? WHERE id = ?').run(cleaned, id);
  }

  removeHistoryBlacklist(id: number): void {
    const db = this.getDb();
    db.prepare('DELETE FROM command_history_blacklist WHERE id = ?').run(id);
  }
}

export const commandService = new CommandService();
