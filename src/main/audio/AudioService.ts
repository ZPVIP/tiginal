import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type {
  AudioSessionArtifacts,
  AudioSessionEvent,
  AudioSessionSnapshot,
  CreateAudioSessionInput,
  FinishSessionResult,
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
import {
  runTiginalDiarizePipeline,
} from './AlignmentEngine';
import { suppressRepetitiveLoops } from '../../shared/audio/textUtils';

type SessionState = 'recording' | 'finalizing';

// Files stream faster than real time; keeping this much queued stays well under the client's 2 MiB limit.
const FILE_QUEUE_TARGET_BYTES = 512 * 1_024;

interface ActiveSession {
  snapshot: AudioSessionSnapshot;
  writer: PcmWavWriter | null;
  committedText: string;
  totalSamples: number;
  language: string;
  client: SpeechStreamClient | null;
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
    return fs.existsSync(target);
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
    const isWhisper = provider.protocol === 'whisper-local';
    const client = isWhisper
      ? null
      : new SpeechStreamClient(provider, resolved.credential, event => {
          this.handleProviderEvent(id, event);
        });
    const session: ActiveSession = {
      snapshot,
      writer,
      committedText: '',
      totalSamples: 0,
      language,
      client,
      translator,
      emit,
      state: 'recording',
      limitTimer: null,
    };
    this.sessions.set(id, session);

    try {
      if (client) {
        await client.connect(language);
      }
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
      if (session.client) {
        session.client.sendFrame(frame);
      }
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
    if (session.client) {
      await session.client.waitForQueueBelow(FILE_QUEUE_TARGET_BYTES);
    }
  }

  async finishSession(sessionId: string): Promise<FinishSessionResult | null> {
    const session = this.sessions.get(sessionId);
    if (!session || session.state === 'finalizing') return null;
    session.state = 'finalizing';
    const resolved = this.providers.require(session.snapshot.providerId);
    const isWhisper = resolved.provider.protocol === 'whisper-local';
    console.log(`[AudioService] Finishing session ${sessionId} (protocol=${resolved.provider.protocol}, isWhisper=${isWhisper})`);

    try {
      if (session.client) {
        console.log(`[AudioService] Waiting for speech stream client to finish decoding and close for session ${sessionId}...`);
        await session.client.finish();
        console.log(`[AudioService] Speech stream client finished. Committed text chars: ${session.committedText?.length || 0}`);
      }
      let translationResult: string | undefined;
      if (session.translator) {
        try {
          translationResult = await session.translator.flush();
        } catch (err) {
          console.error('[AudioService] Translation flush failed:', err);
        }
      }
      const durationMs = this.getSessionDurationMs(session);
      const recordingPath = session.writer ? session.writer.finalize() : session.snapshot.recordingPath;

      const artifacts: AudioSessionArtifacts = {};
      let transcriptText = suppressRepetitiveLoops(session.committedText || '');
      artifacts.transcript = transcriptText;

      if (recordingPath) {
        const stem = recordingPath.replace(/\.[^/.]+$/i, '');
        const txtPath = `${stem}.txt`;

        if (isWhisper) {
          try {
            const lang = session.language || 'auto';
            console.log(`[AudioService] Launching tiginal-diarize Whisper pipeline for ${recordingPath} (lang=${lang})`);
            const whisperRes = await runTiginalDiarizePipeline(recordingPath, {
              transcribe: true,
              language: lang,
              writeArtifacts: true,
              onProgress: (progress, phase) => {
                session.emit({ kind: 'progress', sessionId, progress, phase });
              },
            });
            if (whisperRes.transcript) {
              transcriptText = suppressRepetitiveLoops(whisperRes.transcript);
              session.committedText = transcriptText;
              this.repository.updateTranscript(sessionId, transcriptText);
              artifacts.transcript = transcriptText;
              console.log(`[AudioService] Whisper transcription complete: ${transcriptText.length} chars, segments: ${whisperRes.segments?.length || 0}`);
              session.emit({
                kind: 'provider-event',
                sessionId,
                event: {
                  kind: 'committed',
                  text: transcriptText,
                  fullText: transcriptText,
                },
              });
            } else {
              console.warn('[AudioService] Whisper finished but returned empty transcript');
            }
            if (whisperRes.diar_text) {
              artifacts.speakers = whisperRes.diar_text;
            }
            if (whisperRes.srt) {
              artifacts.srt = whisperRes.srt;
            }
          } catch (whisperErr) {
            console.error('[AudioService] Whisper transcription pipeline failed:', whisperErr);
            session.emit({
              kind: 'provider-event',
              sessionId,
              event: {
                kind: 'error',
                code: 'WHISPER_ERROR',
                message: `Local Whisper failed: ${errorMessage(whisperErr)}`,
              },
            });
          }
        } else {
          // 1. Always save .txt with repetition loops suppressed
          try {
            fs.writeFileSync(txtPath, transcriptText, 'utf-8');
            console.log(`[AudioService] Plain transcript saved to ${txtPath} (${transcriptText.length} chars)`);
          } catch (err) {
            console.error(`[AudioService] Failed to write plain transcript to ${txtPath}:`, err);
          }

          // 2. MMS-Align + Nemotron Diarization pipeline
          try {
            console.log(`[AudioService] Launching tiginal-diarize speaker diarization for ${recordingPath}`);
            const pipelineResult = await runTiginalDiarizePipeline(recordingPath, {
              transcriptPath: txtPath,
              writeArtifacts: true,
              onProgress: (progress, phase) => {
                session.emit({ kind: 'progress', sessionId, progress, phase });
              },
            });
            if (pipelineResult.diar_text) {
              artifacts.speakers = pipelineResult.diar_text;
            }
            if (pipelineResult.srt) {
              artifacts.srt = pipelineResult.srt;
            }
            console.log(`[AudioService] Speaker diarization completed: turns=${pipelineResult.turns?.length || 0}`);
          } catch (diarErr) {
            console.warn('[AudioService] Speaker diarization pipeline skipped or failed:', diarErr);
          }
        }
      }

      console.log(`[AudioService] Session ${sessionId} marked as completed in ${durationMs}ms`);
      this.repository.updateStatus(sessionId, 'completed', durationMs);
      const result: FinishSessionResult = {
        sessionId,
        recordingPath,
        durationMs,
        translation: translationResult,
        artifacts,
      };
      session.emit({
        kind: 'completed',
        ...result,
      });
      this.sessions.delete(sessionId);
      return result;
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
    session.client?.close();
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
    const root = path.resolve(this.audioDirectory);
    const isUnderAudioDir = target.startsWith(`${root}${path.sep}`);
    const isTrackedRecording = Boolean(this.repository && typeof this.repository.hasRecording === 'function' && this.repository.hasRecording(target));
    if (!isUnderAudioDir && !isTrackedRecording) {
      throw new Error('Recording path is outside the Tiginal audio directory');
    }
    if ([...this.sessions.values()].some(session => session.snapshot.recordingPath && path.resolve(session.snapshot.recordingPath) === target)) {
      throw new Error('An active recording cannot be deleted');
    }

    const stem = target.replace(/\.[^/.]+$/i, '');
    const candidateFiles = [
      target,
      `${stem}.txt`,
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
    const txtPath = `${stem}.txt`;

    let transcriptText = artifacts.transcript || '';
    if (!transcriptText && fs.existsSync(txtPath)) {
      transcriptText = fs.readFileSync(txtPath, 'utf-8');
      artifacts.transcript = transcriptText;
    }

    if (!transcriptText) {
      throw new Error('No transcript text found for this audio file. Please transcribe it first.');
    }

    const pipelineResult = await runTiginalDiarizePipeline(target, {
      transcriptPath: txtPath,
      writeArtifacts: true,
    });
    if (pipelineResult.diar_text) {
      artifacts.speakers = pipelineResult.diar_text;
    }
    if (pipelineResult.srt) {
      artifacts.srt = pipelineResult.srt;
    }
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
    } else if (event.kind === 'final') {
      session.committedText = event.text;
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
    session.client?.close();
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
