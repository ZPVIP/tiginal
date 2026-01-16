export interface SearchResult {
  title: string;
  url: string;
  content: string;
}

export interface SearchOptions {
  limit?: number;
  provider?: string;
}
