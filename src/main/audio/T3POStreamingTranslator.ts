import type {
  T3POHistoryPair,
  TranslationLatencyMode,
  TranslationSessionEvent,
} from '../../shared/audio/types';

export interface T3POTranslatorConfig {
  endpoint: string;
  apiKey?: string;
  model?: string;
  sourceLanguage: string;
  targetLanguage: string;
  latencyMode?: TranslationLatencyMode;
  instructions?: string;
  terminology?: readonly { source: string; target: string }[] | string[];
  maxHistoryPairs?: number;
  onEvent?: (event: TranslationSessionEvent) => void;
  fetcher?: (url: string, init: RequestInit) => Promise<Response>;
}

import {
  defaultT3POInstructions,
  formatT3POHistory,
} from '../../shared/audio/t3po-prompt';
import { fetchOpenAIWithCompatibility } from '../services/ai/openai-request';

export { defaultT3POInstructions, formatT3POHistory };

export function parseModelResponse(raw: string): { action: 'WAIT' | 'TRANS'; segment: string } {
  let text = (raw || '').replace(/<\|im_end\|>/g, '').trim();
  if (!text || /^<?\s*WAIT\s*>?$/i.test(text)) {
    return { action: 'WAIT', segment: '' };
  }
  if (/^<?\s*TRANS\s*>?$/i.test(text)) {
    return { action: 'WAIT', segment: '' };
  }
  text = text.replace(/^(?:<\s*TRANS\s*>\s*|TRANS(?:\s*[:：]\s*|\s+))/i, '').trim();
  text = text.replace(/¦/g, '｜').replace(/§/g, '；').trim();
  return { action: 'TRANS', segment: text };
}

export function buildT3POPrompt(
  instructions: string,
  history: readonly T3POHistoryPair[],
  currentInput: string,
  force = false,
): string {
  const historyString = formatT3POHistory(history);
  const forceNotice = force
    ? '\n\nNote: This is the final end of speech. You MUST translate all remaining text in <CURRENT_INPUT> now.'
    : '';

  return `${instructions}${forceNotice}

<STREAMING_HISTORY>
${historyString}

<CURRENT_INPUT>
${currentInput}`;
}

export function getT3POLogitBias(mode: TranslationLatencyMode = 'native'): Record<string, number> | undefined {
  if (mode === 'native') return undefined;
  // Calibrated for Confucius4-T3PO:
  // low: tau = 0.9375 -> stop token bias ~ -0.94 and -0.98
  // high: tau = -0.39 -> stop token bias ~ +0.39 and +0.41
  const tau = mode === 'low' ? 0.9375 : -0.39;
  return {
    '151643': Math.round(-tau * 1.0 * 100) / 100,
    '151645': Math.round(-tau * 1.05 * 100) / 100,
  };
}

export class T3POStreamingTranslator {
  public history: T3POHistoryPair[] = [];
  public currentInput = '';
  public committedTranslation = '';
  public status: 'idle' | 'deciding' | 'waiting' | 'flushing' | 'complete' | 'failed' = 'idle';

  private readonly maxHistoryPairs: number;
  private readonly instructions: string;
  private readonly latencyMode: TranslationLatencyMode;
  private readonly endpoint: string;
  private readonly apiKey?: string;
  private readonly model: string;
  private readonly onEvent?: (event: TranslationSessionEvent) => void;
  private readonly fetcher: (url: string, init: RequestInit) => Promise<Response>;
  private readonly startedAt = Date.now();

  private isProcessing = false;
  private hasPendingInput = false;
  private aborted = false;
  private lastError: string | null = null;

  constructor(config: T3POTranslatorConfig) {
    this.endpoint = config.endpoint.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
    this.model = config.model || 'Confucius4-T3PO';
    this.latencyMode = config.latencyMode ?? 'native';
    this.instructions = config.instructions || defaultT3POInstructions(config.sourceLanguage, config.targetLanguage);
    this.maxHistoryPairs = config.maxHistoryPairs ?? 20;
    this.onEvent = config.onEvent;
    this.fetcher = config.fetcher ?? (globalThis.fetch as any);
  }

  public pushCommittedText(delta: string): void {
    if (this.aborted || !delta) return;
    this.currentInput += delta;
    this.hasPendingInput = true;
    void this.pump(false);
  }

  public async flush(): Promise<string> {
    if (this.aborted) return this.committedTranslation;
    // Wait until any active step finishes
    while (this.isProcessing) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }

    if (this.currentInput.trim()) {
      this.status = 'flushing';
      this.emit({ kind: 'status-change', status: 'flushing', currentInput: this.currentInput });
      await this.runInferenceStep(true);
    }

    if (this.status === 'failed' || this.lastError) {
      throw new Error(this.lastError || 'T3PO translation failed');
    }

    this.status = 'complete';
    const durationMs = Date.now() - this.startedAt;
    this.emit({
      kind: 'complete',
      fullTranslation: this.committedTranslation,
      durationMs,
    });
    return this.committedTranslation;
  }

  public abort(): void {
    this.aborted = true;
    this.status = 'complete';
    this.isProcessing = false;
    this.hasPendingInput = false;
  }

  private async pump(force: boolean): Promise<void> {
    if (this.isProcessing || this.aborted) return;
    if (!this.hasPendingInput && !force) return;

    this.isProcessing = true;
    this.hasPendingInput = false;

    try {
      await this.runInferenceStep(force);
    } finally {
      this.isProcessing = false;
      if (this.hasPendingInput && !this.aborted) {
        // More text arrived while inference was in flight, process next chunk
        void this.pump(false);
      }
    }
  }

  private async runInferenceStep(force: boolean): Promise<void> {
    const inputSnapshot = this.currentInput;
    if (!inputSnapshot.trim()) {
      this.status = 'idle';
      return;
    }

    // Confucius4-T3PO rule: if input contains sentence punctuation or is long, force output
    const PUNCTUATION_END = new Set(['。', '！', '？', '!', '?', '；', ';', '…', '～', '~']);
    const hasPunctuation = Array.from(PUNCTUATION_END).some(p => inputSnapshot.includes(p));
    const isTooLong = inputSnapshot.length >= 15;
    const shouldForce = force || hasPunctuation || isTooLong;

    this.status = shouldForce ? 'flushing' : 'deciding';
    this.emit({ kind: 'status-change', status: this.status, currentInput: inputSnapshot });

    try {
      const decision = await this.callModel(inputSnapshot, shouldForce);
      if (this.aborted) return;

      if (decision.action === 'TRANS' && decision.segment) {
        const cleanSegment = decision.segment
          .replace(/[¦§]/g, ' ')
          .replace(/<think>[\s\S]*?<\/think>/g, '')
          .trim();

        if (cleanSegment) {
          this.history.push({ source: inputSnapshot, target: cleanSegment });
          if (this.history.length > this.maxHistoryPairs) {
            this.history = this.history.slice(-this.maxHistoryPairs);
          }

          // Append to committed translation
          if (this.committedTranslation) {
            const needsSpace = !this.committedTranslation.endsWith(' ') && !cleanSegment.startsWith(' ')
              && /[a-zA-Z0-9]/.test(cleanSegment[0]) && /[a-zA-Z0-9]/.test(this.committedTranslation.slice(-1));
            this.committedTranslation += (needsSpace ? ' ' : '') + cleanSegment;
          } else {
            this.committedTranslation = cleanSegment;
          }

          // Consume processed input
          this.currentInput = this.currentInput.slice(inputSnapshot.length);

          this.status = 'idle';
          this.emit({
            kind: 'trans',
            segment: cleanSegment,
            fullTranslation: this.committedTranslation,
            history: [...this.history],
          });
          return;
        }
      }

      // If WAIT
      this.status = 'waiting';
      this.emit({ kind: 'wait', currentInput: this.currentInput });
    } catch (error) {
      if (this.aborted) return;
      const message = error instanceof Error ? error.message : String(error);
      this.lastError = message;
      this.status = 'failed';
      this.emit({ kind: 'error', message });
    }
  }

  private async callModel(input: string, force: boolean): Promise<{ action: 'WAIT' | 'TRANS'; segment: string }> {
    const prompt = buildT3POPrompt(this.instructions, this.history, input, force);
    const logitBias = getT3POLogitBias(this.latencyMode);

    let base = this.endpoint.trim();
    if (base.startsWith('wss://')) {
      base = 'https://' + base.slice('wss://'.length);
    } else if (base.startsWith('ws://')) {
      base = 'http://' + base.slice('ws://'.length);
    }

    const baseUrl = base.includes('/v1') || base.includes('/chat/completions')
      ? (base.endsWith('/chat/completions') ? base : `${base.replace(/\/+$/, '')}/chat/completions`)
      : `${base.replace(/\/+$/, '')}/v1/chat/completions`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const payload: Record<string, unknown> = {
      model: this.model,
      temperature: 0,
      max_tokens: 128,
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: prompt },
      ],
    };

    if (logitBias && !force) {
      payload.logit_bias = logitBias;
    }
    if (force) {
      payload.min_tokens = 1;
    }

    const { response, errorText } = await fetchOpenAIWithCompatibility(
      this.fetcher as any,
      baseUrl,
      { method: 'POST', headers },
      payload,
    );

    if (!response.ok) {
      throw new Error(errorText || `T3PO request failed (${response.status})`);
    }

    const data = await response.json() as any;
    const rawText = data?.choices?.[0]?.message?.content ?? '';
    const { action, segment } = parseModelResponse(typeof rawText === 'string' ? rawText : '');
    return { action, segment };
  }

  private emit(event: TranslationSessionEvent): void {
    if (this.onEvent) {
      try {
        this.onEvent(event);
      } catch (err) {
        console.error('Error emitting translation event:', err);
      }
    }
  }
}
