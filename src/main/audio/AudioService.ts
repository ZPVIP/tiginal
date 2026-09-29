import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type {
  AudioSessionArtifacts,
  AudioSessionEvent,
  AudioSessionSnapshot,
  CreateAudioSessionInput,
  TranscriptEvent,
} from '../../shared/audio/types';
import { isR2T2Protocol } from '../../shared/audio/types';
import { R2T2_SAMPLE_RATE, shouldRolloverSpeechSession } from '../../shared/audio/r2t2';
import { createAudioRecordingPath, defaultAudioDirectory } from './AudioFilename';
import { AudioSessionRepository } from './AudioSessionRepository';
import { PcmWavWriter } from './PcmWavWriter';
import { SpeechStreamClient } from './SpeechStreamClient';
import type { SpeechProviderStore } from './SpeechProviderStore';
import type { TranslationService } from './TranslationService';
import type { StreamingTranslator } from './T3POWebSocketTranslator';
import { ChunkTimelineWriter, type ChunkTimelineEntry } from './ChunkTimelineWriter';
import {
  alignChunksWithSpeakers,
  buildDiarizedText,
  buildSrtContent,
  ensureChunkEntriesFromTranscript,
  runTiginalDiarize,
} from './AlignmentEngine';
import { suppressRepetitiveLoops } from '../../shared/audio/textUtils';

type SessionState = 'recording' | 'finalizing';

// Files stream faster than real time; keeping this much queued stays well under the client's 2 MiB limit.
const FILE_QUEUE_TARGET_BYTES = 512 * 1_024;

interface ActiveSession {
  snapshot: AudioSessionSnapshot;
  writer: PcmWavWriter | null;
  chunkWriter?: ChunkTimelineWriter | null;
  committedText: string;
  totalSamples: number;
  client: SpeechStreamClient;
  translator?: StreamingTranslator | null;
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

  private isAllowedAudioPath(target: string): boolean {
    const root = path.resolve(this.audioDirectory);
    if (target.startsWith(`${root}${path.sep}`)) {
      return true;
    }
    const ext = path.extname(target).toLowerCase();
    const supported = ['.wav', '.mp3', '.m4a', '.aac', '.flac', '.ogg', '.wma', '.mp4'];
    if (!supported.includes(ext)) {
      return false;
    }
    if (this.repository && typeof this.repository.hasRecording === 'function' && this.repository.hasRecording(target)) {
      return true;
    }
    if ([...this.sessions.values()].some(session => session.snapshot.recordingPath && path.resolve(session.snapshot.recordingPath) === target)) {
      return true;
    }
    return false;
  }

  async createSession(
    input: CreateAudioSessionInput,
    emit: (event: AudioSessionEvent) => void,
  ): Promise<AudioSessionSnapshot> {
    const resolved = this.providers.require(input.providerId);
    if (resolved.provider.protocol === 't3po') {
      throw new Error(`"${resolved.provider.name}" is a T3PO translation service; choose an R2T2 provider for speech recognition`);
    }

    const startedAt = new Date();
    const filePath = input.source.kind === 'file' ? input.source.path : undefined;
    const isExistingFile = Boolean(filePath) && fs.existsSync(filePath!);
    const recordingPath = isExistingFile ? path.resolve(filePath!) : createAudioRecordingPath(this.audioDirectory, startedAt);
    const writer = isExistingFile ? null : new PcmWavWriter(recordingPath);
    const id = crypto.randomUUID();
    const language = input.language?.trim() || resolved.provider.defaultLanguage;
    // Session terms add to the provider's booked words instead of replacing them.
    const provider = input.bookedWords?.length
      ? {
          ...resolved.provider,
          options: {
            ...resolved.provider.options,
            bookedWords: [...resolved.provider.options.bookedWords, ...input.bookedWords],
          },
        }
      : resolved.provider;
    const shouldRollover = shouldRolloverSpeechSession(provider);
    const snapshot: AudioSessionSnapshot = {
      id,
      providerId: provider.id,
      recordingPath,
      startedAt: startedAt.getTime(),
      maxSessionSeconds: shouldRollover ? null : provider.maxSessionSeconds,
      translation: input.translation,
    };

    let translator: StreamingTranslator | null = null;
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
      source: input.source,
      recordingPath,
      providerId: provider.id,
      language,
      startedAt,
    });
    const rawChunkSize = provider.options?.chunkSizeMs;
    const chunkSizeMs = (typeof rawChunkSize === 'number' && rawChunkSize > 0)
      ? rawChunkSize
      : (rawChunkSize === 0)
        ? null
        : 160;

    const chunkWriter = (recordingPath && chunkSizeMs && chunkSizeMs > 0)
      ? new ChunkTimelineWriter(`${recordingPath.replace(/\.[^/.]+$/i, '')}-chunk.txt`, chunkSizeMs)
      : null;
    const client = new SpeechStreamClient(provider, resolved.credential, event => {
      this.handleProviderEvent(id, event);
    });
    const session: ActiveSession = {
      snapshot,
      writer,
      chunkWriter,
      committedText: '',
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
      if (!shouldRollover && provider.maxSessionSeconds !== null) {
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
    // The wall-clock limit timer cannot bound a file that streams faster than real time.
    const limitSeconds = session.snapshot.maxSessionSeconds;
    if (limitSeconds !== null && session.totalSamples >= limitSeconds * R2T2_SAMPLE_RATE) {
      void this.finishSession(sessionId).catch(error => this.failSession(sessionId, errorMessage(error)));
    }
  }

  /** Waits until the speech server has taken most of the queued audio, letting a file stream at the server's pace. */
  async waitForAudioCapacity(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || session.state !== 'recording') return;
    await session.client.waitForQueueBelow(FILE_QUEUE_TARGET_BYTES);
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
      const recordingPath = session.writer ? session.writer.finalize() : session.snapshot.recordingPath;

      const artifacts: AudioSessionArtifacts = {};
      let transcriptText = suppressRepetitiveLoops(session.committedText || '');
      artifacts.transcript = transcriptText;

      if (recordingPath) {
        const stem = recordingPath.replace(/\.[^/.]+$/i, '');
        // 1. Always save .txt with repetition loops suppressed
        const txtPath = `${stem}.txt`;
        try {
          fs.writeFileSync(txtPath, transcriptText, 'utf-8');
        } catch (err) {
          console.error(`Failed to write plain transcript to ${txtPath}:`, err);
        }

        // 2. Automatically generate chunks, diarization, and srt
        const chunkPath = `${stem}-chunk.txt`;
        const rawChunkSize = session.chunkWriter?.chunkSizeMs ?? 160;
        let entries: ChunkTimelineEntry[] = [];

        if (session.chunkWriter) {
          if (session.chunkWriter.getEntries().length === 0 && transcriptText) {
            const synth = ensureChunkEntriesFromTranscript(
              transcriptText,
              Math.max(durationMs, 1000),
              rawChunkSize,
            );
            for (const entry of synth) {
              session.chunkWriter.recordDelta(entry.timestampMs, entry.text);
            }
          }
          session.chunkWriter.finalize();
          entries = [...session.chunkWriter.getEntries()];
          artifacts.chunks = session.chunkWriter.getTextContent();
        } else if (transcriptText.trim()) {
          entries = ensureChunkEntriesFromTranscript(
            transcriptText,
            Math.max(durationMs, 1000),
            rawChunkSize,
          );
          const writer = new ChunkTimelineWriter(chunkPath, rawChunkSize);
          for (const entry of entries) {
            writer.recordDelta(entry.timestampMs, entry.text);
          }
          writer.finalize();
          artifacts.chunks = writer.getTextContent();
        }

        if (entries.length > 0) {
          try {
            const turns = await runTiginalDiarize(recordingPath);
            const segments = alignChunksWithSpeakers(
              entries,
              turns,
              rawChunkSize,
            );
            const diarText = buildDiarizedText(segments);
            const srtText = buildSrtContent(segments);

            const diarPath = `${stem}-diar.txt`;
            const srtPath = `${stem}.srt`;
            fs.writeFileSync(diarPath, diarText, 'utf-8');
            fs.writeFileSync(srtPath, srtText, 'utf-8');

            artifacts.speakers = diarText;
            artifacts.srt = srtText;
          } catch (diarErr) {
            console.warn('Speaker diarization skipped or failed:', diarErr);
          }
        }
      }

      this.repository.updateStatus(sessionId, 'completed', durationMs);
      session.emit({
        kind: 'completed',
        sessionId,
        recordingPath,
        durationMs,
        translation: translationResult,
        artifacts,
      });
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
    const target = path.resolve(recordingPath);
    if (!this.isAllowedAudioPath(target)) {
      throw new Error('Recording path is outside the Tiginal audio directory');
    }
    if ([...this.sessions.values()].some(session => session.snapshot.recordingPath && path.resolve(session.snapshot.recordingPath) === target)) {
      throw new Error('An active recording cannot be deleted');
    }

    const stem = target.replace(/\.[^/.]+$/i, '');
    const candidateFiles = [
      target,
      `${stem}.txt`,
      `${stem}-chunk.txt`,
      `${stem}-diar.txt`,
      `${stem}.srt`,
    ];

    for (const file of candidateFiles) {
      if (fs.existsSync(file)) {
        try {
          fs.unlinkSync(file);
        } catch (err) {
          console.error(`Failed to delete recording file ${file}:`, err);
        }
      }
    }
  }

  getRecordingArtifacts(recordingPath: string): AudioSessionArtifacts {
    const target = path.resolve(recordingPath);
    if (!this.isAllowedAudioPath(target)) {
      return {};
    }
    const stem = target.replace(/\.[^/.]+$/i, '');
    const artifacts: AudioSessionArtifacts = {};

    const txtPath = `${stem}.txt`;
    if (fs.existsSync(txtPath)) {
      try {
        artifacts.transcript = fs.readFileSync(txtPath, 'utf-8');
      } catch { /* ignore */ }
    }

    const chunkPath = `${stem}-chunk.txt`;
    if (fs.existsSync(chunkPath)) {
      try {
        artifacts.chunks = fs.readFileSync(chunkPath, 'utf-8');
      } catch { /* ignore */ }
    }

    const diarPath = `${stem}-diar.txt`;
    if (fs.existsSync(diarPath)) {
      try {
        artifacts.speakers = fs.readFileSync(diarPath, 'utf-8');
      } catch { /* ignore */ }
    }

    const srtPath = `${stem}.srt`;
    if (fs.existsSync(srtPath)) {
      try {
        artifacts.srt = fs.readFileSync(srtPath, 'utf-8');
      } catch { /* ignore */ }
    }

    return artifacts;
  }

  async rediarizeRecording(recordingPath: string): Promise<AudioSessionArtifacts> {
    const target = path.resolve(recordingPath);
    if (!this.isAllowedAudioPath(target)) {
      throw new Error('Recording path is outside the Tiginal audio directory');
    }
    if (!fs.existsSync(target)) {
      throw new Error(`Audio file not found: ${target}`);
    }

    const stem = target.replace(/\.[^/.]+$/i, '');
    const artifacts: AudioSessionArtifacts = this.getRecordingArtifacts(recordingPath);

    // 1. Resolve or reconstruct chunk entries
    let entries: ChunkTimelineEntry[] = [];
    const chunkPath = `${stem}-chunk.txt`;
    if (fs.existsSync(chunkPath)) {
      const content = fs.readFileSync(chunkPath, 'utf-8');
      const rawEntries = content.split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => {
          const [timeStr, ...rest] = line.split('\t');
          return { timestampMs: Number.parseInt(timeStr, 10) || 0, text: rest.join('\t') };
        });
      // Suppress flood repetitions in chunk entries
      entries = [];
      for (const e of rawEntries) {
        const len = entries.length;
        if (len >= 2 && entries[len - 1].text === e.text && entries[len - 2].text === e.text) {
          continue;
        }
        entries.push(e);
      }
    }

    if (entries.length === 0) {
      const txtPath = `${stem}.txt`;
      let transcriptText = artifacts.transcript || '';
      if (!transcriptText && fs.existsSync(txtPath)) {
        transcriptText = fs.readFileSync(txtPath, 'utf-8');
      }
      if (transcriptText) {
        const stat = fs.statSync(target);
        const approxDurationMs = Math.round((Math.max(0, stat.size - 44) / 32000) * 1000) || 5000;
        entries = ensureChunkEntriesFromTranscript(transcriptText, approxDurationMs, 160);
        const writer = new ChunkTimelineWriter(chunkPath, 160);
        for (const entry of entries) {
          writer.recordDelta(entry.timestampMs, entry.text);
        }
        writer.finalize();
        artifacts.chunks = writer.getTextContent();
      }
    }

    if (entries.length === 0) {
      throw new Error('No transcript text or chunk timeline found for this audio file. Please transcribe it first.');
    }

    // 2. Run tiginal-diarize
    const turns = await runTiginalDiarize(target);
    const segments = alignChunksWithSpeakers(entries, turns, 160);
    const diarText = buildDiarizedText(segments);
    const srtText = buildSrtContent(segments);

    const diarPath = `${stem}-diar.txt`;
    const srtPath = `${stem}.srt`;
    fs.writeFileSync(diarPath, diarText, 'utf-8');
    fs.writeFileSync(srtPath, srtText, 'utf-8');

    artifacts.speakers = diarText;
    artifacts.srt = srtText;
    return artifacts;
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
      session.committedText = event.fullText;
      this.repository.updateTranscript(sessionId, event.fullText);
      session.translator?.pushCommittedText(event.text);
      if (session.chunkWriter) {
        const currentMs = Math.round((session.totalSamples / R2T2_SAMPLE_RATE) * 1000);
        session.chunkWriter.recordDelta(currentMs, event.text);
      }
    } else if (event.kind === 'final') {
      session.committedText = event.text;
      this.repository.updateTranscript(sessionId, event.text);
      if (session.chunkWriter && session.chunkWriter.getEntries().length === 0 && event.text) {
        const currentMs = Math.round((session.totalSamples / R2T2_SAMPLE_RATE) * 1000);
        session.chunkWriter.recordDelta(currentMs, event.text);
      }
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
