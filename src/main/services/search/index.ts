import { ipcMain } from 'electron';
import { duckDuckGoSearch } from './duckduckgo';
import { SearchResult } from './types';
import { getDatabase } from '../../../services/database/database';

// Simple in-memory cache for search settings (or fetch from DB every time)
// For now, we only implement DuckDuckGo as the default
export class SearchService {
  constructor() {
    this.setupHandlers();
  }

  private setupHandlers() {
    ipcMain.handle('ai:search', async (_, query: string, provider?: string): Promise<SearchResult[]> => {
       // Get provider from DB if not specified
       if (!provider) {
          const db = getDatabase();
          provider = db.getSetting('search_provider') || 'duckduckgo';
       }
       return this.performSearch(query, provider);
    });

    ipcMain.handle('ai:get-search-settings', async (): Promise<string> => {
       const db = getDatabase();
       return db.getSetting('search_provider') || 'duckduckgo';
    });

    ipcMain.handle('ai:set-search-settings', async (_, { provider }: { provider: string }): Promise<void> => {
        const db = getDatabase();
        db.setSetting('search_provider', provider);
    });
  }

  async performSearch(query: string, provider: string = 'duckduckgo'): Promise<SearchResult[]> {
      // Logic to switch providers would go here
      // For now, default to DuckDuckGo
      return await duckDuckGoSearch(query);
  }
}

export const setupSearchHandlers = () => {
    new SearchService();
};
