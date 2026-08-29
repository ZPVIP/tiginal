import { ipcMain } from 'electron';
import { duckDuckGoSearch } from './duckduckgo';
import { googleSearch } from './google';
import { bingSearch } from './bing';
import { SearchOptions, SearchResult } from './types';
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

function resultLimit(value: number | undefined): number {
    return Number.isInteger(value) && value !== undefined
        ? Math.min(10, Math.max(1, value))
        : 5;
}

function normalizeDomain(value: string): string | null {
    const candidate = value.trim().toLowerCase();
    if (!candidate) return null;

    try {
        const url = new URL(candidate.includes('://') ? candidate : `https://${candidate}`);
        return url.hostname.replace(/^www\./, '');
    } catch {
        return null;
    }
}

function matchesDomain(hostname: string, domain: string): boolean {
    return hostname === domain || hostname.endsWith(`.${domain}`);
}

export function filterSearchResults(results: SearchResult[], options: SearchOptions = {}): SearchResult[] {
    const allowedDomains = (options.allowedDomains || [])
        .map(normalizeDomain)
        .filter((domain): domain is string => domain !== null);
    const blockedDomains = (options.blockedDomains || [])
        .map(normalizeDomain)
        .filter((domain): domain is string => domain !== null);

    return results.filter(result => {
        let hostname: string;
        try {
            hostname = new URL(result.url).hostname.toLowerCase().replace(/^www\./, '');
        } catch {
            return false;
        }

        if (allowedDomains.length > 0 && !allowedDomains.some(domain => matchesDomain(hostname, domain))) {
            return false;
        }
        return !blockedDomains.some(domain => matchesDomain(hostname, domain));
    }).slice(0, resultLimit(options.maxResults));
}

export async function performSearch(
    query: string,
    provider: string = 'duckduckgo',
    options: SearchOptions = {},
): Promise<SearchResult[]> {
    provider = provider?.toLowerCase() || 'duckduckgo';
    console.log(`[SearchService] Executing search for "${query}" via ${provider}`);
    const maxResults = resultLimit(options.maxResults);
    const providerLimit = options.allowedDomains?.length || options.blockedDomains?.length
        ? 50
        : maxResults;
    
    try {
        let results: SearchResult[];
        if (provider === 'google') results = await googleSearch(query, providerLimit);
        else if (provider === 'bing') results = await bingSearch(query, providerLimit);
        else results = await duckDuckGoSearch(query, providerLimit);
        return filterSearchResults(results, { ...options, maxResults });
    } catch (err) {
        console.error(`[SearchService] Search failed for ${provider}:`, err);
        return [];
    }
}



export const setupSearchHandlers = () => {
    new SearchService();
};
