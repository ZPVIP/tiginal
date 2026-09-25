import WebSocket, { type RawData } from 'ws';
import type {
  SpeechProvider,
  T3POHistoryPair,
  TranslationLatencyMode,
  TranslationSessionEvent,
} from '../../shared/audio/types';

export interface StreamingTranslator {
  pushCommittedText(delta: string): void;
  flush(): Promise<string>;
  abort(): void;
}

export type T3PODirection = 'zh2en' | 'en2zh';

export interface T3POTerm {
  src: string;
  trg: string;
}

export interface T3POWebSocketTranslatorConfig {
  endpoint: string;
  token: string | null;
  direction: T3PODirection;
  latencyMode: TranslationLatencyMode;
  terms: readonly T3POTerm[];
  onEvent?: (event: TranslationSessionEvent) => void;
}

const INIT_TIMEOUT_MS = 8_000;
// The final forced translation runs a full model decode on the server.
const END_TIMEOUT_MS = 60_000;
const MAX_TERMS = 200;

type LanguageFamily = 'zh' | 'en' | 'auto' | 'other';

function languageFamily(language: string): LanguageFamily {
  const value = language.trim().toLowerCase();
  if (!value || value === 'auto' || value === 'zhen') return 'auto';
  if (value === 'zh' || value.startsWith('zh-') || value === 'cn' || value === 'chinese') return 'zh';
  if (value === 'en' || value.startsWith('en-') || value === 'english') return 'en';
  return 'other';
}

export function t3poDirection(sourceLanguage: string, targetLanguage: string): T3PODirection {
  const source = languageFamily(sourceLanguage);
  const target = languageFamily(targetLanguage);
  if (target === 'en' && (source === 'zh' || source === 'auto')) return 'zh2en';
  if (target === 'zh' && (source === 'en' || source === 'auto')) return 'en2zh';
  throw new Error(`T3PO translates only between Chinese and English, not from "${sourceLanguage}" to "${targetLanguage}"`);
}

/** Entries use `source=target`; an entry without `=` keeps the term unchanged in the translation. */
export function t3poTerms(entries: readonly (string | { source: string; target: string })[]): T3POTerm[] {
  const terms = new Map<string, string>();
  for (const entry of entries) {
    let source: string;
    let target: string;
    if (typeof entry === 'string') {
      const separator = entry.indexOf('=');
      source = (separator >= 0 ? entry.slice(0, separator) : entry).trim();
      target = (separator >= 0 ? entry.slice(separator + 1) : entry).trim();
    } else {
      source = entry.source.trim();
      target = entry.target.trim();
    }
    if (source && target && !terms.has(source)) terms.set(source, target);
  }
  return [...terms].slice(0, MAX_TERMS).map(([src, trg]) => ({ src, trg }));
}

export function t3poUrl(endpoint: string, token: string | null): URL {
  const url = new URL(endpoint);
  if (token) url.searchParams.set('token', token);
  return url;
}

interface Deferred {
  promise: Promise<void>;
  resolve(): void;
  reject(error: Error): void;
}

function deferred(): Deferred {
  let resolve: () => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<void>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  void promise.catch(() => undefined);
  return { promise, resolve, reject };
}

function rawText(data: RawData): string {
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return Buffer.concat(data).toString('utf8');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value : '';
}

/**
 * Client for the T3PO-ws `/ws/translate` text protocol. The server runs one model decision per text message,
 * which is slower than ASR updates arrive, so at most one text message is in flight and newer text is merged
 * until the server finishes it. A `stats` request follows each text message because the server sends no event
 * for some input, but it always answers `stats` with `metrics`.
 */
export class T3POWebSocketTranslator implements StreamingTranslator {
  private readonly socket: WebSocket;
  private readonly initialized = deferred();
  private readonly ended = deferred();
  private readonly startedAt = Date.now();
  private readonly initTimer: NodeJS.Timeout;
  private history: T3POHistoryPair[] = [];
  private translation = '';
  /** Source text the server has not translated yet, shown while T3PO waits. */
  private pendingSource = '';
  /** Source text not yet sent to the server. */
  private unsent = '';
  private ready = false;
  private inFlight = false;
  /** The next `metrics` belongs to a wait or translation event, not to our `stats` request. */
  private eventMetricsExpected = false;
  private flushRequested = false;
  private endSent = false;
  private failure: Error | null = null;
  private aborted = false;
  private hasEnded = false;

  constructor(private readonly config: T3POWebSocketTranslatorConfig) {
    this.socket = new WebSocket(t3poUrl(config.endpoint, config.token));
    this.initTimer = setTimeout(() => this.fail(new Error('T3PO did not confirm the session in time')), INIT_TIMEOUT_MS);
    this.socket.once('open', () => {
      this.socket.send(JSON.stringify({
        type: 'init',
        direction: config.direction,
        latency_mode: config.latencyMode,
        terms: config.terms,
      }));
    });
    this.socket.on('message', data => this.handleMessage(rawText(data)));
    this.socket.once('error', error => this.fail(new Error(`T3PO connection failed: ${error.message}`)));
    this.socket.once('close', (code, reason) => {
      // The server closes normally right after `ended`.
      if (this.hasEnded) return;
      const detail = reason.toString() || `code ${code}`;
      this.fail(new Error(`T3PO closed the connection before the session ended (${detail})`));
    });
  }

  pushCommittedText(delta: string): void {
    if (this.aborted || this.failure || !delta) return;
    this.pendingSource += delta;
    this.unsent += delta;
    this.emit({ kind: 'status-change', status: 'deciding', currentInput: this.pendingSource });
    this.pump();
  }

  async flush(): Promise<string> {
    if (this.aborted) return this.translation;
    this.emit({ kind: 'status-change', status: 'flushing', currentInput: this.pendingSource });
    await this.initialized.promise;
    this.flushRequested = true;
    this.pump();
    const timer = setTimeout(() => this.fail(new Error('T3PO did not finish the translation in time')), END_TIMEOUT_MS);
    try {
      await this.ended.promise;
    } finally {
      clearTimeout(timer);
    }
    this.emit({ kind: 'complete', fullTranslation: this.translation, durationMs: Date.now() - this.startedAt });
    return this.translation;
  }

  abort(): void {
    this.aborted = true;
    clearTimeout(this.initTimer);
    this.socket.terminate();
  }

  private handleMessage(raw: string): void {
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      this.fail(new Error('T3PO returned invalid JSON'));
      return;
    }
    if (!isRecord(payload)) return;

    switch (payload.type) {
      case 'init_ok':
        clearTimeout(this.initTimer);
        this.ready = true;
        this.initialized.resolve();
        this.pump();
        break;
      case 'wait':
        this.eventMetricsExpected = true;
        this.emit({ kind: 'wait', currentInput: this.pendingSource });
        break;
      case 'translation':
        this.eventMetricsExpected = true;
        this.appendTranslation(stringValue(payload, 'source'), stringValue(payload, 'text'));
        break;
      case 'metrics':
        if (this.eventMetricsExpected) {
          this.eventMetricsExpected = false;
        } else if (this.inFlight) {
          this.inFlight = false;
          this.pump();
        }
        break;
      case 'ended':
        this.hasEnded = true;
        this.ended.resolve();
        break;
      case 'error': {
        const code = stringValue(payload, 'code') || 'T3PO_ERROR';
        const message = stringValue(payload, 'message') || 'T3PO reported an error';
        this.fail(new Error(`${code}: ${message}`));
        break;
      }
      default:
        break;
    }
  }

  private appendTranslation(source: string, segment: string): void {
    if (!segment) return;
    const needsSpace = this.config.direction === 'zh2en'
      && this.translation !== ''
      && !/\s$/.test(this.translation)
      && !/^\s/.test(segment);
    this.translation += `${needsSpace ? ' ' : ''}${segment}`;
    this.history.push({ source, target: segment });
    this.pendingSource = '';
    this.emit({ kind: 'trans', segment, fullTranslation: this.translation, history: [...this.history] });
  }

  private pump(): void {
    if (!this.ready || this.inFlight || this.failure || this.aborted) return;
    if (this.unsent) {
      this.send({ type: 'text', text: this.unsent });
      this.send({ type: 'stats' });
      this.unsent = '';
      this.inFlight = true;
    } else if (this.flushRequested && !this.endSent) {
      this.endSent = true;
      this.send({ type: 'end' });
    }
  }

  private send(message: Record<string, unknown>): void {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  private fail(error: Error): void {
    if (this.aborted || this.failure) return;
    this.failure = error;
    clearTimeout(this.initTimer);
    this.initialized.reject(error);
    this.ended.reject(error);
    this.emit({ kind: 'error', message: error.message });
    this.socket.terminate();
  }

  private emit(event: TranslationSessionEvent): void {
    this.config.onEvent?.(event);
  }
}

export function createT3POTranslator(
  provider: SpeechProvider,
  credential: string | null,
  session: {
    sourceLanguage: string;
    targetLanguage: string;
    latencyMode?: TranslationLatencyMode;
    terminology?: readonly { source: string; target: string }[] | readonly string[];
    onEvent?: (event: TranslationSessionEvent) => void;
  },
): T3POWebSocketTranslator {
  return new T3POWebSocketTranslator({
    endpoint: provider.endpoint,
    token: provider.authMode === 'query-token' ? credential : null,
    direction: t3poDirection(session.sourceLanguage, session.targetLanguage),
    latencyMode: session.latencyMode ?? provider.options.latencyMode,
    terms: t3poTerms([...provider.options.terminology, ...(session.terminology ?? [])]),
    onEvent: session.onEvent,
  });
}

export async function testT3POConnection(provider: SpeechProvider, credential: string | null): Promise<void> {
  const translator = new T3POWebSocketTranslator({
    endpoint: provider.endpoint,
    token: provider.authMode === 'query-token' ? credential : null,
    direction: 'zh2en',
    latencyMode: provider.options.latencyMode,
    terms: t3poTerms(provider.options.terminology),
  });
  await translator.flush();
}
