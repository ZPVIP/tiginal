// Basic placeholders for prompt templates - these should ideally be loaded from DB or Settings
export const DEFAULT_WEBSEARCH_PROMPT = `You are an AI model who is expert at searching the web and answering user's queries.

Generate a response that is informative and relevant to the user's query based on provided search results. The current date and time are {current_date_time}.

<search-results>
 {search_results}
</search-results>
`;

export const DEFAULT_WEBSEARCH_FOLLOWUP_PROMPT = `You will rephrase follow-up questions into concise, standalone search queries optimized for internet search engines. Transform conversational questions into keyword-focused search terms by removing unnecessary words, question formats, and context dependencies while preserving the core information need.

ONLY RETURN QUERY WITHOUT ANY TEXT

Examples:
Follow-up question: What are the symptoms of a heart attack?
heart attack symptoms

Previous Conversation:
{chat_history}

Follow-up question: {question}
`;

export class PromptService {
  static formatSystemPrompt(template: string, replacements: Record<string, string>): string {
    let content = template;
    const currentDate = new Date();
    
    const defaults = {
      "{current_date_time}": currentDate.toLocaleString(),
      "{current_year}": currentDate.getFullYear().toString(),
      "{current_month}": (currentDate.getMonth() + 1).toString(),
      "{current_day}": currentDate.getDate().toString(),
    };

    const allReplacements = { ...defaults, ...replacements };

    for (const [key, value] of Object.entries(allReplacements)) {
      content = content.replaceAll(key, value);
    }
    return content;
  }

  static async formatWebSearchSystemPrompt(searchResults: string): Promise<string> {
    // In a real app, we'd fetch the template from settings
    return this.formatSystemPrompt(DEFAULT_WEBSEARCH_PROMPT, {
      "{search_results}": searchResults
    });
  }

  static async createSearchQueryPrompt(history: any[], lastQuestion: string): Promise<string> {
    const chatHistoryStr = history.map(msg => `${msg.role === 'user' ? 'Human' : 'Assistant'}: ${msg.content}`).join('\n');
    return DEFAULT_WEBSEARCH_FOLLOWUP_PROMPT
      .replace('{chat_history}', chatHistoryStr)
      .replace('{question}', lastQuestion);
  }
}
