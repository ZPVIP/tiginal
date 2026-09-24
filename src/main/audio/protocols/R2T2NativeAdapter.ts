import {
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
  buildUrl(provider: SpeechProvider, _credential: string | null): URL {
    return new URL(provider.endpoint);
  }

  buildOpeningMessage(input: SpeechSessionOptions): string {
    return JSON.stringify({
      requestId: input.requestId,
      channels: 1,
      sample_rate: 16_000,
      language: input.language,
      use_vad: input.options.useVad,
      secret_key: input.credential ?? '',
      mode: input.options.mode,
      ...(input.options.systemPrompt ? { system_prompt: input.options.systemPrompt } : {}),
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
    const payload = parseProtocolPayload(raw);
    const error = protocolError(payload);
    if (error) return [error];

    const events: TranscriptEvent[] = [];
    if (payload.status === 'connected' || payload.type === 'connected') {
      events.push({ kind: 'connected' });
    }

    const message = isRecord(payload.msg) ? payload.msg : payload;
    if (message.reset === true || payload.reset === true) {
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

    if (payload.is_final === true || payload.final === true || message.final === true) {
      state.partialText = '';
      events.push({ kind: 'final', text: state.committedText });
    }
    return events;
  }
}
