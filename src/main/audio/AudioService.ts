import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type {
  AudioSessionEvent,
  AudioSessionSnapshot,
  CreateAudioSessionInput,
  TranscriptEvent,
} from '../../shared/audio/types';
import { R2T2_SAMPLE_RATE } from '../../shared/audio/r2t2';
import { createAudioRecordingPath, defaultAudioDirectory } from './AudioFilename';
import { AudioSessionRepository } from './AudioSessionRepository';
import { PcmWavWriter } from './PcmWavWriter';
import { SpeechStreamClient } from './SpeechStreamClient';
import type { SpeechProviderStore } from './SpeechProviderStore';
import type { TranslationService } from './TranslationService';
import type { T3POStreamingTranslator } from './T3POStreamingTranslator';

type SessionState = 'recording' | 'finalizing';

interface ActiveSession {
  snapshot: AudioSessionSnapshot;
  writer: PcmWavWriter | null;
  totalSamples: number;
  client: SpeechStreamClient;
  translator?: T3POStreamingTranslator | null;
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
    private readonly translationService?: TranslationService,
  ) {}

  private getSessionDurationMs(session: ActiveSession): number {
    if (session.writer) {
      return session.writer.durationMs();
    }
    return Math.round((session.totalSamples / R2T2_SAMPLE_RATE) * 1000);
  }

  async createSession(
    input: CreateAudioSessionInput,
    emit: (event: AudioSessionEvent) => void,
  ): Promise<AudioSessionSnapshot> {
    const resolved = this.providers.require(input.providerId);
    if (!resolved.provider.enabled) throw new Error('Speech provider is disabled');

    const isMicrophone = input.source?.kind !== 'file';
    const startedAt = new Date();
    const recordingPath = isMicrophone
      ? createAudioRecordingPath(this.audioDirectory, startedAt)
      : null;
    const writer = recordingPath ? new PcmWavWriter(recordingPath) : null;
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
      translation: input.translation,
    };

    let translator: T3POStreamingTranslator | null = null;
    if (input.translation && this.translationService) {
      translator = this.translationService.createStreamingTranslator(
        input.translation,
        language,
        translationEvent => {
          emit({ kind: 'translation-event', sessionId: id, event: translationEvent });
        },
      );
    }

    this.repository.insert({
      id,
      source: input.source ?? { kind: 'microphone' },
      recordingPath,
      providerId: provider.id,
      language,
      startedAt,
    });
    const client = new SpeechStreamClient(provider, resolved.credential, event => {
      this.handleProviderEvent(id, event);
    });
    const session: ActiveSession = {
      snapshot,
      writer,
      totalSamples: 0,
      client,
      translator,
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
      session.writer?.write(frame);
      session.totalSamples += frame.length;
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
    this.repository.updateStatus(sessionId, 'finalizing', this.getSessionDurationMs(session));
    try {
      await session.client.finish();
      let translationResult: string | undefined;
      if (session.translator) {
        try {
          translationResult = await session.translator.flush();
        } catch (err) {
          console.error('Translation flush failed:', err);
        }
      }
      const durationMs = this.getSessionDurationMs(session);
      const recordingPath = session.writer ? session.writer.finalize() : null;
      this.repository.updateStatus(sessionId, 'completed', durationMs);
      session.emit({ kind: 'completed', sessionId, recordingPath, durationMs, translation: translationResult });
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
    session.translator?.abort();
    session.client.close();
    const durationMs = this.getSessionDurationMs(session);
    session.writer?.finalize();
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
    if ([...this.sessions.values()].some(session => session.snapshot.recordingPath && path.resolve(session.snapshot.recordingPath) === target)) {
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
    if (event.kind === 'committed') {
      this.repository.updateTranscript(sessionId, event.fullText);
      session.translator?.pushCommittedText(event.text);
    } else if (event.kind === 'final') {
      this.repository.updateTranscript(sessionId, event.text);
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
    session.translator?.abort();
    session.client.close();
    const durationMs = this.getSessionDurationMs(session);
    let recordingPath = session.snapshot.recordingPath;
    try {
      if (session.writer) {
        recordingPath = session.writer.finalize();
      }
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
