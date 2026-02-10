import { SearchResult } from './types';
import * as cheerio from 'cheerio';

export const googleSearch = async (query: string, limit: number = 5): Promise<SearchResult[]> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

  try {
    const response = await fetch(
      "https://www.google.com/search?q=" + encodeURIComponent(query),
      {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
      }
    );

    if (!response.ok) {
        throw new Error(`Google responded with ${response.status}`);
    }

    const htmlString = await response.text();
    const $ = cheerio.load(htmlString);

    const results: SearchResult[] = [];

    // Selectors for Google search results often change, but generic structure usually has h3 inside a link
    // We look for 'div.g' which is the common container
    $("div.g").each((_, element) => {
        if (results.length >= limit) return false;

        const titleEl = $(element).find("h3");
        const linkEl = $(element).find("a").first();
        const snippetEl = $(element).find("div[style*='-webkit-line-clamp']").length > 0 
            ? $(element).find("div[style*='-webkit-line-clamp']") 
            : $(element).find("span").last(); // Fallback

        const title = titleEl.text();
        const link = linkEl.attr("href");
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
    console.error('Google search failed:', error);
    return [];
  } finally {
    clearTimeout(timeoutId);
  }
};
