import * as crypto from 'crypto';
import WebSocket, { type RawData } from 'ws';
import type { SpeechProvider, TranscriptEvent } from '../../shared/audio/types';
import {
  R2T2_FRAME_DURATION_MS,
  R2T2_FRAME_SAMPLES,
  type SpeechProtocolState,
} from '../../shared/audio/r2t2';
import { createSpeechProtocolAdapter, type SpeechProtocolAdapter } from './protocols';

const CONNECT_TIMEOUT_MS = 8_000;
const PROBE_TIMEOUT_MS = 8_000;
const FINAL_TIMEOUT_MS = 30_000;
const MAX_BUFFERED_BYTES = 512 * 1_024;
const MAX_QUEUED_BYTES = 2 * 1_024 * 1_024;
const QUEUE_POLL_MS = 10;

type ClientState = 'idle' | 'connecting' | 'open' | 'finishing' | 'closed';

interface Deferred {
  promise: Promise<void>;
  resolve(): void;
  reject(error: Error): void;
}

function deferred(): Deferred {
  let resolvePromise: (() => void) | undefined;
  let rejectPromise: ((error: Error) => void) | undefined;
  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve: () => resolvePromise?.(),
    reject: error => rejectPromise?.(error),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function rawText(data: RawData): string | null {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return null;
}

export class R2T2Client {
  private readonly adapter: SpeechProtocolAdapter;
  private readonly protocolState: SpeechProtocolState = { committedText: '', partialText: '' };
  private readonly completion = deferred();
  private readonly protocolReady = deferred();
  private socket: WebSocket | null = null;
  private state: ClientState = 'idle';
  private sequence = 1;
  private receivedFinal = false;
  private readonly pendingFrames: Int16Array[] = [];
  private queuedBytes = 0;
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly provider: SpeechProvider,
    private readonly credential: string | null,
    private readonly onEvent: (event: TranscriptEvent) => void,
  ) {
    this.adapter = createSpeechProtocolAdapter(provider.protocol);
    void this.completion.promise.catch(() => undefined);
    void this.protocolReady.promise.catch(() => undefined);
  }

  async connect(language = this.provider.defaultLanguage): Promise<void> {
    if (this.state !== 'idle') throw new Error('R2T2 client has already been started');
    this.state = 'connecting';
    const socket = new WebSocket(this.adapter.buildUrl(this.provider, this.credential));
    this.socket = socket;
    socket.binaryType = 'arraybuffer';

    const opened = deferred();
    socket.once('open', () => {
      if (this.state !== 'connecting') return;
      this.state = 'open';
      socket.send(this.adapter.buildOpeningMessage({
        requestId: `tiginal-${crypto.randomUUID()}`,
        language,
        credential: this.credential,
        options: this.provider.options,
      }));
      opened.resolve();
    });
    socket.on('message', data => this.handleMessage(data));
    socket.once('error', error => {
      const wrapped = new Error(`R2T2 connection failed: ${error.message}`);
      opened.reject(wrapped);
      this.protocolReady.reject(wrapped);
      this.completion.reject(wrapped);
    });
    socket.once('close', (code, reason) => this.handleClose(code, reason.toString()));

    try {
      await withTimeout(opened.promise, CONNECT_TIMEOUT_MS, 'R2T2 connection timed out');
    } catch (error) {
      this.close();
      throw error;
    }
  }

  async waitForProtocolReady(): Promise<void> {
    await withTimeout(this.protocolReady.promise, PROBE_TIMEOUT_MS, 'R2T2 handshake timed out');
  }

  sendFrame(frame: Int16Array): void {
    if (this.state !== 'open' || !this.socket) throw new Error('R2T2 connection is not open');
    if (this.queuedBytes + frame.byteLength > MAX_QUEUED_BYTES) {
      throw new Error('R2T2 audio queue exceeded 2 MiB');
    }
    const copy = frame.slice();
    this.pendingFrames.push(copy);
    this.queuedBytes += copy.byteLength;
    this.flushPendingFrames();
  }

  async finish(): Promise<void> {
    if (this.state === 'closed') return;
    if (this.state !== 'open' || !this.socket) throw new Error('R2T2 connection is not open');
    this.state = 'finishing';
    await withTimeout(this.drainPendingFrames(), FINAL_TIMEOUT_MS, 'R2T2 audio queue did not drain');
    const socket = this.socket;
    if (!socket) {
      await this.completion.promise;
      return;
    }
    const silenceSamples = this.adapter.tailSilenceSamples();
    if (silenceSamples > 0) {
      socket.send(this.adapter.encodeAudioFrame(new Int16Array(silenceSamples), this.sequence));
      this.sequence += 1;
    }
    socket.send(this.adapter.eosMarker());
    try {
      await withTimeout(this.completion.promise, FINAL_TIMEOUT_MS, 'R2T2 final response timed out');
    } finally {
      this.closeSocket();
    }
  }

  close(): void {
    if (this.state === 'closed') return;
    this.state = 'closed';
    this.completion.resolve();
    this.closeSocket();
  }

  private handleMessage(data: RawData): void {
    const text = rawText(data);
    if (text === null) return;
    try {
      const events = this.adapter.readMessage(text, this.protocolState);
      const protocolFailure = events.find(event => event.kind === 'error');
      if (protocolFailure?.kind === 'error') {
        this.protocolReady.reject(new Error(protocolFailure.message));
      } else if (events.length > 0) {
        this.protocolReady.resolve();
      }
      for (const event of events) {
        this.onEvent(event);
        if (event.kind === 'error') {
          this.completion.reject(new Error(event.message));
        } else if (event.kind === 'final') {
          this.receivedFinal = true;
          this.completion.resolve();
        }
      }
    } catch (error) {
      const message = errorMessage(error);
      this.onEvent({ kind: 'error', code: 'INVALID_R2T2_MESSAGE', message });
      this.completion.reject(new Error(message));
    }
  }

  private handleClose(code: number, reason: string): void {
    const wasFinishing = this.state === 'finishing';
    const wasClosed = this.state === 'closed';
    this.state = 'closed';
    this.socket = null;
    this.clearAudioQueue();
    if (wasClosed || (wasFinishing && (this.receivedFinal || code === 1000))) {
      this.completion.resolve();
      return;
    }
    const message = `R2T2 connection closed (${code}${reason ? `: ${reason}` : ''})`;
    this.onEvent({ kind: 'error', code: 'R2T2_CLOSED', message });
    this.protocolReady.reject(new Error(message));
    this.completion.reject(new Error(message));
  }

  private flushPendingFrames(): void {
    this.clearFlushTimer();
    const socket = this.socket;
    if (!socket || (this.state !== 'open' && this.state !== 'finishing')) return;
    while (this.pendingFrames.length > 0 && socket.bufferedAmount <= MAX_BUFFERED_BYTES) {
      const frame = this.pendingFrames.shift();
      if (!frame) break;
      this.queuedBytes -= frame.byteLength;
      socket.send(this.adapter.encodeAudioFrame(frame, this.sequence));
      this.sequence += 1;
    }
    if (this.pendingFrames.length > 0) {
      this.flushTimer = setTimeout(() => {
        try {
          this.flushPendingFrames();
        } catch (error) {
          this.handleSendFailure(error);
        }
      }, QUEUE_POLL_MS);
    }
  }

  private async drainPendingFrames(): Promise<void> {
    while (this.pendingFrames.length > 0) {
      this.flushPendingFrames();
      if (this.pendingFrames.length > 0) {
        await new Promise(resolve => setTimeout(resolve, QUEUE_POLL_MS));
      }
    }
  }

  private handleSendFailure(error: unknown): void {
    const message = `R2T2 audio send failed: ${errorMessage(error)}`;
    this.onEvent({ kind: 'error', code: 'R2T2_SEND_FAILED', message });
    this.completion.reject(new Error(message));
    this.closeSocket();
  }

  private clearFlushTimer(): void {
    if (!this.flushTimer) return;
    clearTimeout(this.flushTimer);
    this.flushTimer = null;
  }

  private closeSocket(): void {
    this.clearAudioQueue();
    const socket = this.socket;
    this.socket = null;
    this.state = 'closed';
    if (!socket) return;
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close(1000);
    }
  }

  private clearAudioQueue(): void {
    this.clearFlushTimer();
    this.pendingFrames.length = 0;
    this.queuedBytes = 0;
  }
}

export async function testR2T2Connection(
  provider: SpeechProvider,
  credential: string | null,
): Promise<void> {
  const client = new R2T2Client(provider, credential, () => undefined);
  try {
    await client.connect();
    const protocolReady = client.waitForProtocolReady();
    for (let frameIndex = 0; frameIndex < 3; frameIndex += 1) {
      client.sendFrame(new Int16Array(R2T2_FRAME_SAMPLES));
      await new Promise(resolve => setTimeout(resolve, R2T2_FRAME_DURATION_MS));
    }
    await protocolReady;
    await client.finish();
  } finally {
    client.close();
  }
}
