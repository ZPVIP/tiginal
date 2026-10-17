import {
  formatR2T2BookedWords,
  mapR2T2RStreamLanguage,
  R2T2_SAMPLE_RATE,
  R2T2_RSTREAM_EOS,
  type SpeechProtocolState,
  type SpeechSessionOptions,
} from '../../../shared/audio/r2t2';
import type { SpeechProvider, TranscriptEvent } from '../../../shared/audio/types';
import { smartJoinText, separateGluedWords, suppressRepetitiveLoops } from '../../../shared/audio/textUtils';
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
  const cleanedIncoming = separateGluedWords(incoming);
  if (!cleanedIncoming) return null;

  if (state.completedHistory === undefined) {
    state.completedHistory = '';
    state.currentUtterance = '';
  }

  // 1. If incoming is identical to current utterance, no new content
  if (state.currentUtterance && cleanedIncoming === state.currentUtterance) {
    return null;
  }

  // 2. If incoming extends the whole session history (whole-session cumulative mode)
  if (state.committedText && cleanedIncoming.startsWith(state.committedText)) {
    const delta = cleanedIncoming.slice(state.committedText.length);
    if (!delta) return null;
    state.committedText = suppressRepetitiveLoops(cleanedIncoming, 3);
    state.currentUtterance = state.committedText;
    state.completedHistory = '';
    return { kind: 'committed', text: delta, fullText: state.committedText };
  }

  // 3. If incoming extends current utterance (per-utterance cumulative mode, like r2t2-ws)
  if (state.currentUtterance && cleanedIncoming.startsWith(state.currentUtterance)) {
    const rawDelta = cleanedIncoming.slice(state.currentUtterance.length);
    state.currentUtterance = cleanedIncoming;
    const rawFull = smartJoinText(state.completedHistory, state.currentUtterance);
    const fullText = suppressRepetitiveLoops(rawFull, 3);
    const delta = fullText.startsWith(state.committedText)
      ? fullText.slice(state.committedText.length)
      : rawDelta;
    if (!delta) return null;
    state.committedText = fullText;
    return { kind: 'committed', text: delta, fullText };
  }

  // 4. New utterance started! (Commit previous utterance into history)
  if (state.currentUtterance) {
    state.completedHistory = smartJoinText(state.completedHistory, state.currentUtterance);
  }
  state.currentUtterance = cleanedIncoming;
  const rawFull = smartJoinText(state.completedHistory, state.currentUtterance);
  const fullText = suppressRepetitiveLoops(rawFull, 3);
  const delta = fullText.startsWith(state.committedText)
    ? fullText.slice(state.committedText.length)
    : cleanedIncoming;
  if (!delta) return null;
  state.committedText = fullText;
  return { kind: 'committed', text: delta, fullText };
}

export class R2T2RStreamAdapter implements SpeechProtocolAdapter {
  readonly protocolName = 'R2T2';

  buildUrl(provider: SpeechProvider, credential: string | null): URL {
    const url = new URL(provider.endpoint);
    if (provider.authMode === 'query-token' && credential) url.searchParams.set('t', credential);
    return url;
  }

  buildOpeningMessage(input: SpeechSessionOptions): string {
    return JSON.stringify({
      lang: mapR2T2RStreamLanguage(input.language),
      booked_words: formatR2T2BookedWords(input.options.bookedWords),
      use_vad: false,
      smooth: input.options.smooth,
      mode: input.options.mode,
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
