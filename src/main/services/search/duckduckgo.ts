import { SearchResult } from './types';
import * as cheerio from 'cheerio';

export const duckDuckGoSearch = async (query: string, limit: number = 5): Promise<SearchResult[]> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

  try {
    const response = await fetch(
      "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query),
      {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" // Fake UA
        }
      }
    );

    if (!response.ok) {
        throw new Error(`DuckDuckGo responded with ${response.status}`);
    }

    const htmlString = await response.text();
    const $ = cheerio.load(htmlString);

    const results: SearchResult[] = [];

    $("div.results_links_deep").each((_, element) => {
        if (results.length >= limit) return false;

        const title = $(element).find("a.result__a").text();
        let link = $(element)
            .find("a.result__snippet")
            .attr("href");
        
        const content = $(element).find("a.result__snippet").text();

        if (link && title) {
            // Clean up DDG link
            link = link.replace("//duckduckgo.com/l/?uddg=", "").replace(/&rut=.*/, "");
            try {
                link = decodeURIComponent(link);
            } catch (e) {
                // ignore decoding errors
            }
            
            results.push({
                title: title.trim(),
                url: link,
                content: content.trim()
            });
        }
    });

    return results;

  } catch (error) {
    console.error('DuckDuckGo search failed:', error);
    return [];
  } finally {
    clearTimeout(timeoutId);
  }
};
