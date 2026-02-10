import { ipcMain } from 'electron';
import { duckDuckGoSearch } from './duckduckgo';
import { googleSearch } from './google';
import { bingSearch } from './bing';
import { SearchResult } from './types';
import { getDatabase } from '../../../services/database/database';

// Simple in-memory cache for search settings (or fetch from DB every time)
// For now, we only implement DuckDuckGo as the default
export class SearchService {
  constructor() {
    this.setupHandlers();
  }

  private setupHandlers() {
    try {
        ipcMain.handle('ai:search', async (_, query: string, provider?: string): Promise<SearchResult[]> => {
           // Get provider from DB if not specified
           if (!provider) {
              const db = getDatabase();
              provider = db.getSetting('search_provider') || 'duckduckgo';
           }
           console.log(`[IPC] ai:search called with query: ${query}, provider: ${provider}`);
           return performSearch(query, provider);
        });

        ipcMain.handle('ai:get-search-settings', async (): Promise<string> => {
           const db = getDatabase();
           return db.getSetting('search_provider') || 'duckduckgo';
        });

        ipcMain.handle('ai:set-search-settings', async (_, { provider }: { provider: string }): Promise<void> => {
            const db = getDatabase();
            db.setSetting('search_provider', provider);
        });
    } catch (e) {
        console.warn('[SearchService] Failed to register handlers (likely duplicate):', e);
    }
  }
}

export async function performSearch(query: string, provider: string = 'duckduckgo'): Promise<SearchResult[]> {
    provider = provider?.toLowerCase() || 'duckduckgo';
    console.log(`[SearchService] Executing search for "${query}" via ${provider}`);
    
    try {
        if (provider === 'google') return await googleSearch(query);
        if (provider === 'bing') return await bingSearch(query);
        return await duckDuckGoSearch(query);
    } catch (err) {
        console.error(`[SearchService] Search failed for ${provider}:`, err);
        return [];
    }
}



export const setupSearchHandlers = () => {
    new SearchService();
};
