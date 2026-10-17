import type Database from 'better-sqlite3';
import type { AudioSessionSource } from '../../shared/audio/types';

export type AudioSessionStatus =
  | 'connecting'
  | 'recording'
  | 'finalizing'
  | 'completed'
  | 'failed'
  | 'aborted';

export interface NewAudioSessionRecord {
  id: string;
  source: AudioSessionSource;
  recordingPath: string | null;
  providerId: string;
  language: string;
  startedAt: Date;
}

export class AudioSessionRepository {
  constructor(private readonly db: Database.Database) {}

  insert(record: NewAudioSessionRecord): void {
    const timestamp = record.startedAt.getTime();
    let speechProviderId: string | null = null;
    if (record.providerId && !record.providerId.startsWith('local-model:')) {
      try {
        const row = this.db.prepare('SELECT 1 FROM speech_providers WHERE id = ?').get(record.providerId);
        if (row) speechProviderId = record.providerId;
      } catch {
        speechProviderId = null;
      }
    }
    this.db.prepare(`
      INSERT INTO audio_sessions (
        id, source_kind, source_path, recording_path, speech_provider_id, recognition_language,
        status, started_at_iso, timezone_offset_minutes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'connecting', ?, ?, ?, ?)
    `).run(
      record.id,
      record.source.kind,
      record.source.kind === 'file' ? (record.source.path || record.source.name) : null,
      record.recordingPath,
      speechProviderId,
      record.language,
      record.startedAt.toISOString(),
      record.startedAt.getTimezoneOffset(),
      timestamp,
      timestamp,
    );
  }

  hasRecording(recordingPath: string): boolean {
    if (!recordingPath) return false;
    try {
      const row = this.db.prepare(
        'SELECT id FROM audio_sessions WHERE recording_path = ? LIMIT 1'
      ).get(recordingPath);
      return Boolean(row);
    } catch {
      return false;
    }
  }

  updateStatus(id: string, status: AudioSessionStatus, durationMs: number): void {
    this.db.prepare(`
      UPDATE audio_sessions
      SET status = ?, duration_ms = ?, updated_at = ?
      WHERE id = ?
    `).run(status, durationMs, Date.now(), id);
  }

  updateTranscript(id: string, transcript: string): void {
    this.db.prepare(`
      UPDATE audio_sessions
      SET transcript = ?, updated_at = ?
      WHERE id = ?
    `).run(transcript, Date.now(), id);
  }
}
