import type { SpeechProtocolState, SpeechSessionOptions } from '../../../shared/audio/r2t2';
import type { SpeechProvider, TranscriptEvent } from '../../../shared/audio/types';
import {
  isRecord,
  parseProtocolPayload,
  protocolError,
  rawPcmFrame,
  stringField,
  type SpeechProtocolAdapter,
} from './SpeechProtocolAdapter';

export const T3PO_NATIVE_EOS = 'YOUDAO_T3PO_NATIVE_EOS';

export class T3PONativeAdapter implements SpeechProtocolAdapter {
  readonly protocolName = 'T3PO';

  buildUrl(provider: SpeechProvider, _credential: string | null): URL {
    return new URL(provider.endpoint);
  }

  buildOpeningMessage(input: SpeechSessionOptions): string {
    return JSON.stringify({
      action: 'handshake',
      service: 't3po-native',
      requestId: input.requestId,
      channels: 1,
      sample_rate: 16_000,
      language: input.language,
      secret_key: input.credential ?? '',
      mode: input.options.mode,
      use_vad: input.options.useVad,
      ...(input.options.systemPrompt ? { system_prompt: input.options.systemPrompt } : {}),
    });
  }

  encodeAudioFrame(frame: Int16Array, _sequence: number): ArrayBuffer {
    return rawPcmFrame(frame);
  }

  eosMarker(): string {
    return T3PO_NATIVE_EOS;
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
      events.push({ kind: 'segment-reset' });
    }

    const delta = stringField(message, ['text', 'delta_text', 'delta', 'segment']);
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
