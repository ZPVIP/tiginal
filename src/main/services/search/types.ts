export interface SearchResult {
  title: string;
  url: string;
  content: string;
}

export interface SearchOptions {
  maxResults?: number;
  allowedDomains?: string[];
  blockedDomains?: string[];
}
