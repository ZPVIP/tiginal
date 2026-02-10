import { SearchResult } from './types';
import * as cheerio from 'cheerio';

export const bingSearch = async (query: string, limit: number = 5): Promise<SearchResult[]> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

  try {
    const response = await fetch(
      "https://www.bing.com/search?q=" + encodeURIComponent(query),
      {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
      }
    );

    if (!response.ok) {
        throw new Error(`Bing responded with ${response.status}`);
    }

    const htmlString = await response.text();
    const $ = cheerio.load(htmlString);

    const results: SearchResult[] = [];

    // Bing results usually in 'li.b_algo'
    $("li.b_algo").each((_, element) => {
        if (results.length >= limit) return false;

        const titleEl = $(element).find("h2 a");
        const snippetEl = $(element).find("div.b_caption p");
        
        const title = titleEl.text();
        const link = titleEl.attr("href");
        const content = snippetEl.text();

        if (link && title && link.startsWith('http')) {
             results.push({
                title: title.trim(),
                url: link,
                content: content.trim()
            });
        }
    });

    return results;

  } catch (error) {
    console.error('Bing search failed:', error);
    return [];
  } finally {
    clearTimeout(timeoutId);
  }
};
