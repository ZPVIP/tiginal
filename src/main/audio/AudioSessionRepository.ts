import type Database from 'better-sqlite3';

export type AudioSessionStatus =
  | 'connecting'
  | 'recording'
  | 'finalizing'
  | 'completed'
  | 'failed'
  | 'aborted';

export interface NewAudioSessionRecord {
  id: string;
  recordingPath: string;
  providerId: string;
  language: string;
  startedAt: Date;
}

export class AudioSessionRepository {
  constructor(private readonly db: Database.Database) {}

  insert(record: NewAudioSessionRecord): void {
    const timestamp = record.startedAt.getTime();
    this.db.prepare(`
      INSERT INTO audio_sessions (
        id, source_kind, recording_path, speech_provider_id, recognition_language,
        status, started_at_iso, timezone_offset_minutes, created_at, updated_at
      ) VALUES (?, 'microphone', ?, ?, ?, 'connecting', ?, ?, ?, ?)
    `).run(
      record.id,
      record.recordingPath,
      record.providerId,
      record.language,
      record.startedAt.toISOString(),
      record.startedAt.getTimezoneOffset(),
      timestamp,
      timestamp,
    );
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
