import {
  formatR2T2BookedWords,
  mapR2T2RStreamLanguage,
  type SpeechProtocolState,
  type SpeechSessionOptions,
} from '../../../shared/audio/r2t2';
import type { SpeechProvider, TranscriptEvent } from '../../../shared/audio/types';
import {
  isRecord,
  parseProtocolPayload,
  protocolError,
  rawPcmFrame,
  stringField,
  type SpeechProtocolAdapter,
} from './SpeechProtocolAdapter';

export const T3PO_RSTREAM_EOS = 'YOUDAO_T3PO_STREAM_EOS';

function recognitionText(value: unknown): string {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || (!trimmed.startsWith('[') && !trimmed.startsWith('{'))) return value;
    try {
      return recognitionText(JSON.parse(trimmed));
    } catch {
      return value;
    }
  }
  if (Array.isArray(value)) return value.map(recognitionText).join('');
  if (!isRecord(value)) return '';
  if (typeof value.sentence === 'string') return value.sentence;
  if (typeof value.translation === 'string') return value.translation;
  if (typeof value.text === 'string') return value.text;
  if (value.text !== undefined) return recognitionText(value.text);
  return '';
}

function firstRecognitionText(record: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    if (record[key] === undefined) continue;
    const text = recognitionText(record[key]);
    if (text) return text;
  }
  return '';
}

function appendRecognitionText(state: SpeechProtocolState, incoming: string): TranscriptEvent | null {
  if (!incoming) return null;
  const previous = state.committedText;
  if (previous.endsWith(incoming)) return null;
  const fullText = incoming.startsWith(previous) ? incoming : `${previous}${incoming}`;
  const delta = fullText.slice(previous.length);
  if (!delta) return null;
  state.committedText = fullText;
  return { kind: 'committed', text: delta, fullText };
}

export class T3PORStreamAdapter implements SpeechProtocolAdapter {
  readonly protocolName = 'T3PO';

  buildUrl(provider: SpeechProvider, credential: string | null): URL {
    const url = new URL(provider.endpoint);
    if (provider.authMode === 'query-token' && credential) url.searchParams.set('t', credential);
    return url;
  }

  buildOpeningMessage(input: SpeechSessionOptions): string {
    return JSON.stringify({
      action: 'start',
      service: 't3po-simultaneous-translation',
      lang: mapR2T2RStreamLanguage(input.language),
      booked_words: formatR2T2BookedWords(input.options.bookedWords ?? []),
      use_vad: input.options.useVad,
      smooth: input.options.smooth,
      requestId: input.requestId,
    });
  }

  encodeAudioFrame(frame: Int16Array, _sequence: number): ArrayBuffer {
    return rawPcmFrame(frame);
  }

  eosMarker(): string {
    return T3PO_RSTREAM_EOS;
  }

  tailSilenceSamples(): number {
    return 0;
  }

  readMessage(raw: string, state: SpeechProtocolState): TranscriptEvent[] {
    const payload = parseProtocolPayload(raw, this.protocolName);
    const error = protocolError(payload, this.protocolName);
    if (error) return [error];

    const events: TranscriptEvent[] = [];
    if (payload.status === 'connected' || payload.type === 'connected') {
      events.push({ kind: 'connected' });
    }

    const message = isRecord(payload.msg) ? payload.msg : payload;
    if (message.reset === true || payload.reset === true) {
      state.partialText = '';
      events.push({ kind: 'segment-reset' });
    }

    const delta = stringField(message, ['delta_text', 'delta', 'segment']);
    if (delta) {
      state.committedText += delta;
      events.push({ kind: 'committed', text: delta, fullText: state.committedText });
    } else {
      const fullText = firstRecognitionText(message, ['text', 'sentence', 'translation']);
      const committed = appendRecognitionText(state, fullText);
      if (committed) events.push(committed);
    }

    const partial = firstRecognitionText(message, ['partial', 'partial_text']);
    if (partial !== state.partialText) {
      state.partialText = partial;
      events.push({ kind: 'partial', text: partial });
    }

    if (payload.is_final === true || payload.final === true || message.final === true) {
      state.partialText = '';
      events.push({ kind: 'final', text: state.committedText });
    }

    return events;
  }
}
