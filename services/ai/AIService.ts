import { AIServiceConfig, CommandHistoryEntry } from '../../src/shared/types';

export interface AISuggestion {
  command: string;
  confidence: number;
  explanation?: string;
}

/**
 * AI service for command suggestions
 * Compatible with OpenAI API and similar services
 */
export class AIService {
  private config: AIServiceConfig | null = null;

  /**
   * Initialize the AI service
   */
  initialize(config: AIServiceConfig): void {
    this.config = config;
  }

  /**
   * Check if the service is configured
   */
  isConfigured(): boolean {
    return this.config !== null;
  }

  /**
   * Suggest commands based on history and context
   */
  async suggestFromHistory(
    history: string[],
    context: {
      cwd?: string;
      partialInput?: string;
      recentOutput?: string;
    }
  ): Promise<AISuggestion[]> {
    if (!this.config) {
      throw new Error('AI service not configured');
    }

    const systemPrompt = `You are a command-line assistant. Suggest relevant shell commands based on the user's command history and current context. Return suggestions as JSON array.`;

    const userPrompt = this.buildPrompt(history, context);

    try {
      const response = await this.callAPI(systemPrompt, userPrompt);
      return this.parseResponse(response);
    } catch (error) {
      console.error('AI suggestion failed:', error);
      return [];
    }
  }

  /**
   * Build the prompt for the AI
   */
  private buildPrompt(
    history: string[],
    context: { cwd?: string; partialInput?: string; recentOutput?: string }
  ): string {
    let prompt = `Recent commands:\n${history.slice(-20).join('\n')}\n\n`;

    if (context.cwd) {
      prompt += `Current directory: ${context.cwd}\n`;
    }

    if (context.partialInput) {
      prompt += `User is typing: ${context.partialInput}\n`;
    }

    if (context.recentOutput) {
      prompt += `Recent output:\n${context.recentOutput.slice(-500)}\n`;
    }

    prompt += `\nSuggest up to 5 relevant commands the user might want to run next. Return as JSON: [{"command": "...", "confidence": 0.0-1.0, "explanation": "..."}]`;

    return prompt;
  }

  /**
   * Call the OpenAI-compatible API
   */
  private async callAPI(systemPrompt: string, userPrompt: string): Promise<string> {
    if (!this.config) {
      throw new Error('AI service not configured');
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }

    const response = await fetch(`${this.config.endpoint}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: this.config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  }

  /**
   * Parse the AI response
   */
  private parseResponse(response: string): AISuggestion[] {
    try {
      // Extract JSON from response (may be wrapped in markdown code blocks)
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        return [];
      }

      const suggestions = JSON.parse(jsonMatch[0]);
      return suggestions.filter(
        (s: AISuggestion) =>
          typeof s.command === 'string' &&
          typeof s.confidence === 'number'
      );
    } catch {
      return [];
    }
  }

  /**
   * Get autocomplete suggestions (simpler, faster)
   */
  async getAutocompletions(
    partialCommand: string,
    history: CommandHistoryEntry[]
  ): Promise<string[]> {
    // First, try local matching from history
    const localMatches = history
      .filter((e) => e.command.startsWith(partialCommand))
      .map((e) => e.command);

    const unique = [...new Set(localMatches)].slice(0, 10);

    // If we have enough local matches or AI is not configured, return them
    if (unique.length >= 5 || !this.config) {
      return unique;
    }

    // Otherwise, try AI for more suggestions
    try {
      const suggestions = await this.suggestFromHistory(
        history.map((e) => e.command),
        { partialInput: partialCommand }
      );
      return [
        ...unique,
        ...suggestions
          .filter((s) => s.command.startsWith(partialCommand))
          .map((s) => s.command),
      ].slice(0, 10);
    } catch {
      return unique;
    }
  }
}
