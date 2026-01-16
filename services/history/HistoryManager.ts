import { CommandHistoryEntry } from '../../src/shared/types';

/**
 * Command history manager
 * Stores and retrieves command history per session
 */
export class HistoryManager {
  private history: Map<string, CommandHistoryEntry[]> = new Map();
  private globalHistory: CommandHistoryEntry[] = [];
  private maxEntriesPerSession = 1000;
  private maxGlobalEntries = 10000;
  private storageKey = 'tiginal-command-history';

  /**
   * Add a command to history
   */
  addCommand(
    command: string,
    sessionId: string,
    cwd?: string,
    exitCode?: number
  ): CommandHistoryEntry {
    const entry: CommandHistoryEntry = {
      id: crypto.randomUUID(),
      command: command.trim(),
      timestamp: Date.now(),
      sessionId,
      cwd,
      exitCode,
    };

    // Add to session history
    let sessionHistory = this.history.get(sessionId);
    if (!sessionHistory) {
      sessionHistory = [];
      this.history.set(sessionId, sessionHistory);
    }
    sessionHistory.push(entry);

    // Trim session history if needed
    if (sessionHistory.length > this.maxEntriesPerSession) {
      sessionHistory.shift();
    }

    // Add to global history
    this.globalHistory.push(entry);
    if (this.globalHistory.length > this.maxGlobalEntries) {
      this.globalHistory.shift();
    }

    return entry;
  }

  /**
   * Get history for a session
   */
  getSessionHistory(sessionId: string): CommandHistoryEntry[] {
    return this.history.get(sessionId) || [];
  }

  /**
   * Get global history
   */
  getGlobalHistory(limit?: number): CommandHistoryEntry[] {
    if (limit) {
      return this.globalHistory.slice(-limit);
    }
    return [...this.globalHistory];
  }

  /**
   * Search history by command pattern
   */
  search(pattern: string, sessionId?: string): CommandHistoryEntry[] {
    const source = sessionId
      ? this.history.get(sessionId) || []
      : this.globalHistory;

    const lowerPattern = pattern.toLowerCase();
    return source.filter((entry) =>
      entry.command.toLowerCase().includes(lowerPattern)
    );
  }

  /**
   * Search history with regex
   */
  searchRegex(regex: RegExp, sessionId?: string): CommandHistoryEntry[] {
    const source = sessionId
      ? this.history.get(sessionId) || []
      : this.globalHistory;

    return source.filter((entry) => regex.test(entry.command));
  }

  /**
   * Get unique commands (deduplicated)
   */
  getUniqueCommands(sessionId?: string, limit?: number): string[] {
    const source = sessionId
      ? this.history.get(sessionId) || []
      : this.globalHistory;

    const seen = new Set<string>();
    const unique: string[] = [];

    // Iterate from most recent
    for (let i = source.length - 1; i >= 0 && (!limit || unique.length < limit); i--) {
      const cmd = source[i].command;
      if (!seen.has(cmd)) {
        seen.add(cmd);
        unique.push(cmd);
      }
    }

    return unique;
  }

  /**
   * Clear session history
   */
  clearSession(sessionId: string): void {
    this.history.delete(sessionId);
  }

  /**
   * Clear all history
   */
  clearAll(): void {
    this.history.clear();
    this.globalHistory = [];
  }

  /**
   * Get recent commands for AI context
   */
  getRecentForAI(sessionId: string, count: number = 50): string[] {
    const sessionHistory = this.history.get(sessionId) || [];
    return sessionHistory.slice(-count).map((e) => e.command);
  }

  /**
   * Save history to storage
   * TODO: Implement persistent storage
   */
  async saveToStorage(): Promise<void> {
    // Placeholder
  }

  /**
   * Load history from storage
   * TODO: Implement persistent storage
   */
  async loadFromStorage(): Promise<void> {
    // Placeholder
  }
}
