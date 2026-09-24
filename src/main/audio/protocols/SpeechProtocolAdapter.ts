import type { SpeechProvider, TranscriptEvent } from '../../../shared/audio/types';
import type { SpeechProtocolState, SpeechSessionOptions } from '../../../shared/audio/r2t2';

export interface SpeechProtocolAdapter {
  readonly protocolName: string;
  buildUrl(provider: SpeechProvider, credential: string | null): URL;
  buildOpeningMessage(input: SpeechSessionOptions): string;
  encodeAudioFrame(frame: Int16Array, sequence: number): ArrayBuffer;
  eosMarker(): string;
  tailSilenceSamples(): number;
  readMessage(raw: string, state: SpeechProtocolState): TranscriptEvent[];
}

export function rawPcmFrame(frame: Int16Array): ArrayBuffer {
  const copy = new Uint8Array(frame.byteLength);
  copy.set(new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength));
  return copy.buffer;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function stringField(record: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string') return value;
  }
  return '';
}

export function numberField(record: Record<string, unknown>, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}

export function parseProtocolPayload(raw: string, protocolName = 'Speech protocol'): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`${protocolName} returned invalid JSON`);
  }
  if (!isRecord(value)) throw new Error(`${protocolName} returned an invalid message`);
  return value;
}

export function protocolError(payload: Record<string, unknown>, protocolName = 'Speech protocol'): TranscriptEvent | null {
  if (payload.status !== 'error' && payload.type !== 'error') return null;
  const nested = isRecord(payload.msg) ? payload.msg : null;
  const message = stringField(nested ?? payload, ['msg', 'message', 'error'])
    || stringField(payload, ['message', 'error'])
    || `${protocolName} reported an error`;
  const code = stringField(payload, ['code']) || `${protocolName.toUpperCase().replace(/\s+/g, '_')}_ERROR`;
  return { kind: 'error', code, message };
}
