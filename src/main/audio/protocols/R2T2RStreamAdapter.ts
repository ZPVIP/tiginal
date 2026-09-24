import {
  formatR2T2BookedWords,
  mapR2T2RStreamLanguage,
  R2T2_SAMPLE_RATE,
  R2T2_RSTREAM_EOS,
  type SpeechProtocolState,
  type SpeechSessionOptions,
} from '../../../shared/audio/r2t2';
import type { SpeechProvider, TranscriptEvent } from '../../../shared/audio/types';
import {
  isRecord,
  numberField,
  parseProtocolPayload,
  protocolError,
  rawPcmFrame,
  stringField,
  type SpeechProtocolAdapter,
} from './SpeechProtocolAdapter';

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

export class R2T2RStreamAdapter implements SpeechProtocolAdapter {
  buildUrl(provider: SpeechProvider, credential: string | null): URL {
    const url = new URL(provider.endpoint);
    if (provider.authMode === 'query-token' && credential) url.searchParams.set('t', credential);
    return url;
  }

  buildOpeningMessage(input: SpeechSessionOptions): string {
    return JSON.stringify({
      lang: mapR2T2RStreamLanguage(input.language),
      booked_words: formatR2T2BookedWords(input.options.bookedWords),
      use_vad: input.options.useVad,
      smooth: input.options.smooth,
      requestId: input.requestId,
    });
  }

  encodeAudioFrame(frame: Int16Array, _sequence: number): ArrayBuffer {
    return rawPcmFrame(frame);
  }

  eosMarker(): string {
    return R2T2_RSTREAM_EOS;
  }

  tailSilenceSamples(): number {
    return 0;
  }

  readMessage(raw: string, state: SpeechProtocolState): TranscriptEvent[] {
    const payload = parseProtocolPayload(raw);
    const error = protocolError(payload);
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

    const incomingText = firstRecognitionText(message, ['delta_text', 'delta', 'text', 'sentence']);
    const committed = appendRecognitionText(state, incomingText);
    if (committed) events.push(committed);

    const partial = stringField(message, ['partial', 'partial_text']);
    if (partial !== state.partialText) {
      state.partialText = partial;
      events.push({ kind: 'partial', text: partial });
    }

    const ackedSamples = numberField(message, ['acked_samples', 'ackedSamples']);
    const serverBufferedMs = numberField(message, ['server_buffered_ms', 'serverBufferedMs']);
    const audioMs = numberField(message, ['audio_ms', 'audioMs']);
    const acknowledgedSamples = ackedSamples
      ?? (audioMs === undefined ? undefined : Math.round(audioMs * R2T2_SAMPLE_RATE / 1_000));
    if (acknowledgedSamples !== undefined || serverBufferedMs !== undefined) {
      events.push({ kind: 'metrics', ackedSamples: acknowledgedSamples, serverBufferedMs });
    }

    if (payload.is_final === true || payload.final === true
      || message.is_final === true || message.final === true) {
      state.partialText = '';
      events.push({ kind: 'final', text: state.committedText });
    }
    return events;
  }
}
