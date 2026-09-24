import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type {
  AudioSessionEvent,
  AudioSessionSnapshot,
  CreateAudioSessionInput,
  TranscriptEvent,
} from '../../shared/audio/types';
import { createAudioRecordingPath, defaultAudioDirectory } from './AudioFilename';
import { AudioSessionRepository } from './AudioSessionRepository';
import { PcmWavWriter } from './PcmWavWriter';
import { R2T2Client } from './R2T2Client';
import type { SpeechProviderStore } from './SpeechProviderStore';

type SessionState = 'recording' | 'finalizing';

interface ActiveSession {
  snapshot: AudioSessionSnapshot;
  writer: PcmWavWriter;
  client: R2T2Client;
  emit: (event: AudioSessionEvent) => void;
  state: SessionState;
  limitTimer: NodeJS.Timeout | null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class AudioService {
  private readonly sessions = new Map<string, ActiveSession>();

  constructor(
    private readonly providers: SpeechProviderStore,
    private readonly repository: AudioSessionRepository,
    private readonly audioDirectory = defaultAudioDirectory(),
  ) {}

  async createSession(
    input: CreateAudioSessionInput,
    emit: (event: AudioSessionEvent) => void,
  ): Promise<AudioSessionSnapshot> {
    const resolved = this.providers.require(input.providerId);
    if (!resolved.provider.enabled) throw new Error('Speech provider is disabled');

    const startedAt = new Date();
    const recordingPath = createAudioRecordingPath(this.audioDirectory, startedAt);
    const writer = new PcmWavWriter(recordingPath);
    const id = crypto.randomUUID();
    const language = input.language?.trim() || resolved.provider.defaultLanguage;
    const provider = input.bookedWords
      ? {
          ...resolved.provider,
          options: { ...resolved.provider.options, bookedWords: input.bookedWords },
        }
      : resolved.provider;
    const snapshot: AudioSessionSnapshot = {
      id,
      providerId: provider.id,
      recordingPath,
      startedAt: startedAt.getTime(),
      maxSessionSeconds: provider.maxSessionSeconds,
    };

    this.repository.insert({
      id,
      source: input.source ?? { kind: 'microphone' },
      recordingPath,
      providerId: provider.id,
      language,
      startedAt,
    });
    const client = new R2T2Client(provider, resolved.credential, event => {
      this.handleProviderEvent(id, event);
    });
    const session: ActiveSession = {
      snapshot,
      writer,
      client,
      emit,
      state: 'recording',
      limitTimer: null,
    };
    this.sessions.set(id, session);

    try {
      await client.connect(language);
      this.repository.updateStatus(id, 'recording', 0);
      if (provider.maxSessionSeconds !== null) {
        session.limitTimer = setTimeout(() => {
          void this.finishSession(id).catch(error => this.failSession(id, errorMessage(error)));
        }, provider.maxSessionSeconds * 1_000);
      }
      emit({ kind: 'session-created', session: snapshot });
      return snapshot;
    } catch (error) {
      await this.failSession(id, errorMessage(error));
      throw error;
    }
  }

  pushPcmFrame(sessionId: string, frame: Int16Array): void {
    const session = this.requireRecordingSession(sessionId);
    try {
      session.writer.write(frame);
      session.client.sendFrame(frame);
    } catch (error) {
      void this.failSession(sessionId, errorMessage(error));
      throw error;
    }
  }

  async finishSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || session.state === 'finalizing') return;
    session.state = 'finalizing';
    this.clearLimitTimer(session);
    this.repository.updateStatus(sessionId, 'finalizing', session.writer.durationMs());
    try {
      await session.client.finish();
      const durationMs = session.writer.durationMs();
      const recordingPath = session.writer.finalize();
      this.repository.updateStatus(sessionId, 'completed', durationMs);
      session.emit({ kind: 'completed', sessionId, recordingPath, durationMs });
      this.sessions.delete(sessionId);
    } catch (error) {
      await this.failSession(sessionId, errorMessage(error), session);
      throw error;
    }
  }

  async abortSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.state = 'finalizing';
    this.clearLimitTimer(session);
    session.client.close();
    const durationMs = session.writer.durationMs();
    session.writer.finalize();
    this.repository.updateStatus(sessionId, 'aborted', durationMs);
    this.sessions.delete(sessionId);
  }

  async disposeAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map(sessionId => this.abortSession(sessionId)));
  }

  deleteRecording(recordingPath: string): void {
    const root = path.resolve(this.audioDirectory);
    const target = path.resolve(recordingPath);
    if (!target.startsWith(`${root}${path.sep}`) || path.extname(target).toLowerCase() !== '.wav') {
      throw new Error('Recording path is outside the Tiginal audio directory');
    }
    if ([...this.sessions.values()].some(session => path.resolve(session.snapshot.recordingPath) === target)) {
      throw new Error('An active recording cannot be deleted');
    }
    if (fs.existsSync(target)) fs.unlinkSync(target);
  }

  private requireRecordingSession(sessionId: string): ActiveSession {
    const session = this.sessions.get(sessionId);
    if (!session || session.state !== 'recording') throw new Error('Audio session is not recording');
    return session;
  }

  private handleProviderEvent(sessionId: string, event: TranscriptEvent): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.emit({ kind: 'provider-event', sessionId, event });
    if (event.kind === 'committed' || event.kind === 'final') {
      this.repository.updateTranscript(sessionId, event.kind === 'committed' ? event.fullText : event.text);
    }
    if (event.kind === 'error' && session.state === 'recording') {
      void this.failSession(sessionId, event.message);
    }
  }

  private async failSession(
    sessionId: string,
    message: string,
    knownSession?: ActiveSession,
  ): Promise<void> {
    const session = knownSession ?? this.sessions.get(sessionId);
    if (!session) return;
    session.state = 'finalizing';
    this.clearLimitTimer(session);
    session.client.close();
    const durationMs = session.writer.durationMs();
    let recordingPath = session.snapshot.recordingPath;
    try {
      recordingPath = session.writer.finalize();
    } finally {
      this.repository.updateStatus(sessionId, 'failed', durationMs);
      session.emit({ kind: 'failed', sessionId, recordingPath, message });
      this.sessions.delete(sessionId);
    }
  }

  private clearLimitTimer(session: ActiveSession): void {
    if (!session.limitTimer) return;
    clearTimeout(session.limitTimer);
    session.limitTimer = null;
  }
}
