import { ipcMain } from 'electron';
import { getDatabase } from '../services/database/database';

/**
 * Setup Statistics-related IPC handlers
 */
export function setupStatisticsHandlers(): void {
  /**
   * Query token statistics for a date range.
   * For dates with done=true, use cached data from statistics table.
   * For dates with done=false or missing, compute from messages table.
   */
  ipcMain.handle('statistics:query', async (_event, { startDate, endDate }: { startDate: string; endDate: string }) => {
    const db = getDatabase().getDb();
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    // Get all cached statistics for the date range
    const cachedRows = db.prepare(`
      SELECT date, done, provider_id, model_id, prompt_tokens, cached_tokens,
             completion_tokens, reasoning_tokens, total_tokens
      FROM statistics
      WHERE date >= ? AND date <= ?
    `).all(startDate, endDate) as any[];

    // Build a map of date -> provider_id -> stats
    const statsMap = new Map<string, Map<string, any>>();
    const doneDates = new Set<string>();

    for (const row of cachedRows) {
      if (row.done) {
        doneDates.add(row.date);
      }
      if (!statsMap.has(row.date)) {
        statsMap.set(row.date, new Map());
      }
      statsMap.get(row.date)!.set(row.provider_id, {
        providerId: row.provider_id,
        modelId: row.model_id,
        promptTokens: row.prompt_tokens,
        cachedTokens: row.cached_tokens,
        completionTokens: row.completion_tokens,
        reasoningTokens: row.reasoning_tokens,
        totalTokens: row.total_tokens,
      });
    }

    // Generate all dates in range
    const dates: string[] = [];
    let current = new Date(startDate + 'T00:00:00');
    const end = new Date(endDate + 'T00:00:00');
    while (current <= end) {
      dates.push(current.toISOString().split('T')[0]);
      current.setDate(current.getDate() + 1);
    }

    // For dates with done=false or missing, compute from messages
    for (const date of dates) {
      if (doneDates.has(date)) continue; // Already have finalized data

      // Compute from messages for this date
      const rows = db.prepare(`
        SELECT provider_id, model_id,
          SUM(prompt_tokens) as prompt_tokens,
          SUM(cached_tokens) as cached_tokens,
          SUM(completion_tokens) as completion_tokens,
          SUM(reasoning_tokens) as reasoning_tokens,
          SUM(total_tokens) as total_tokens
        FROM messages
        WHERE date(created_at/1000, 'unixepoch', 'localtime') = ?
          AND total_tokens > 0
        GROUP BY provider_id
      `).all(date) as any[];

      const providerMap = new Map<string, any>();
      for (const row of rows) {
        if (!row.provider_id) continue;
        providerMap.set(row.provider_id, {
          providerId: row.provider_id,
          modelId: row.model_id || '',
          promptTokens: row.prompt_tokens || 0,
          cachedTokens: row.cached_tokens || 0,
          completionTokens: row.completion_tokens || 0,
          reasoningTokens: row.reasoning_tokens || 0,
          totalTokens: row.total_tokens || 0,
        });

        // Cache in statistics table
        const isDone = date < today ? 1 : 0;
        db.prepare(`
          INSERT OR REPLACE INTO statistics (date, done, provider_id, model_id, prompt_tokens, cached_tokens, completion_tokens, reasoning_tokens, total_tokens)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          date, isDone, row.provider_id, row.model_id || '',
          row.prompt_tokens || 0, row.cached_tokens || 0,
          row.completion_tokens || 0, row.reasoning_tokens || 0,
          row.total_tokens || 0
        );
      }

      if (providerMap.size > 0) {
        statsMap.set(date, providerMap);
      }
    }

    // Mark past dates with done=false as done
    db.prepare(`
      UPDATE statistics SET done = 1 WHERE date < ? AND done = 0
    `).run(today);

    // Get provider names for display
    const providers = db.prepare('SELECT id, name FROM ai_providers').all() as any[];
    const providerNames = new Map<string, string>();
    for (const p of providers) {
      providerNames.set(p.id, p.name);
    }

    // Aggregate by provider (across all dates in range)
    const providerTotals = new Map<string, {
      providerId: string;
      providerName: string;
      modelId: string;
      promptTokens: number;
      cachedTokens: number;
      completionTokens: number;
      reasoningTokens: number;
      totalTokens: number;
    }>();

    for (const [, providerMap] of statsMap) {
      for (const [providerId, stats] of providerMap) {
        if (!providerTotals.has(providerId)) {
          providerTotals.set(providerId, {
            providerId,
            providerName: providerNames.get(providerId) || providerId,
            modelId: stats.modelId,
            promptTokens: 0,
            cachedTokens: 0,
            completionTokens: 0,
            reasoningTokens: 0,
            totalTokens: 0,
          });
        }
        const total = providerTotals.get(providerId)!;
        total.promptTokens += stats.promptTokens;
        total.cachedTokens += stats.cachedTokens;
        total.completionTokens += stats.completionTokens;
        total.reasoningTokens += stats.reasoningTokens;
        total.totalTokens += stats.totalTokens;
        total.modelId = stats.modelId; // Keep latest model
      }
    }

    return {
      providers: Array.from(providerTotals.values()).filter(p => p.totalTokens > 0),
      dateRange: { startDate, endDate },
    };
  });
}
