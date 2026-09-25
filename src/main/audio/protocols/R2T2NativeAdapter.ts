import {
  formatR2T2BookedWords,
  R2T2_NATIVE_EOS,
  tailSilenceSamples,
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

export class R2T2NativeAdapter implements SpeechProtocolAdapter {
  readonly protocolName = 'R2T2';

  buildUrl(provider: SpeechProvider, _credential: string | null): URL {
    return new URL(provider.endpoint);
  }

  buildOpeningMessage(input: SpeechSessionOptions): string {
    // The native header has no booked_words field; both servers read system_prompt as recognition context.
    const systemPrompt = [input.options.systemPrompt.trim(), formatR2T2BookedWords(input.options.bookedWords)]
      .filter(Boolean)
      .join('\n')
      .slice(0, 4_000);
    return JSON.stringify({
      requestId: input.requestId,
      channels: 1,
      sample_rate: 16_000,
      language: input.language,
      use_vad: false,
      secret_key: input.credential ?? '',
      mode: input.options.mode,
      smooth: input.options.smooth,
      ...(systemPrompt ? { system_prompt: systemPrompt } : {}),
    });
  }

  encodeAudioFrame(frame: Int16Array, _sequence: number): ArrayBuffer {
    return rawPcmFrame(frame);
  }

  eosMarker(): string {
    return R2T2_NATIVE_EOS;
  }

  tailSilenceSamples(): number {
    return tailSilenceSamples('r2t2-native');
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
    const reset = message.reset === true || payload.reset === true;
    if (reset) {
      events.push({ kind: 'segment-reset' });
    }

    const delta = stringField(message, ['text', 'delta_text', 'delta']);
    if (delta) {
      state.committedText += delta;
      events.push({ kind: 'committed', text: delta, fullText: state.committedText });
    }

    const partial = stringField(message, ['partial', 'partial_text']);
    if (partial !== state.partialText) {
      state.partialText = partial;
      events.push({ kind: 'partial', text: partial });
    }

    // Servers also reset mid-session (soft reset, VAD speech end); only the reset answering EOS ends the stream.
    if (payload.is_final === true || payload.final === true || message.final === true || (reset && state.eosSent)) {
      state.partialText = '';
      events.push({ kind: 'final', text: state.committedText });
    }
    return events;
  }
}
