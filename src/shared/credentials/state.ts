import { createHash } from 'node:crypto';
import { FORMAT_HANDLERS } from './formats';
import { MAX_TTL_MS, MIN_TTL_MS } from './types';
import type { FileFormat, FileState } from './types';

/**
 * Deciding what is on disk for a managed file, and how long a live session may
 * last.
 *
 * Drift is two separate questions, and conflating them was the trap: a comment
 * edited by hand is not the same event as a real secret typed back in. Only the
 * second one blocks a rewrite.
 */

export function fingerprint(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

export interface ManagedEntry {
  keyName: string;
  fakeValue: string;
}

export interface FileStateInput {
  /** null when the file is gone from disk. */
  content: string | null;
  /** null before the file has ever been materialized. */
  safeFingerprint: string | null;
  format: FileFormat;
  entries: ManagedEntry[];
}

export function deriveFileState(input: FileStateInput): FileState {
  const { content, safeFingerprint, format, entries } = input;

  if (content === null) return { kind: 'missing' };
  if (safeFingerprint === null) return { kind: 'unmanaged' };

  const parsed = FORMAT_HANDLERS[format].parse(content);
  const wholeFile = parsed.find(entry => entry.key === '');

  const changedKeys: string[] = [];
  const missingKeys: string[] = [];

  for (const entry of entries) {
    const found = wholeFile ?? parsed.find(candidate => candidate.key === entry.keyName);
    if (!found) {
      missingKeys.push(entry.keyName);
      continue;
    }
    if (found.value !== entry.fakeValue) changedKeys.push(entry.keyName);
  }

  if (changedKeys.length > 0 || missingKeys.length > 0) {
    return { kind: 'drifted', changedKeys, missingKeys };
  }

  return fingerprint(content) === safeFingerprint ? { kind: 'safe' } : { kind: 'safe-edited' };
}

const TTL_PATTERN = /^(\d+)(s|m|h)?$/;

/**
 * Parse a `--ttl` argument. A bare number is minutes, which is what a person
 * typing `--ttl 15` means. Returns raw milliseconds; clamping is separate so a
 * caller can tell "you asked for two hours" from "two hours is the limit".
 */
export function parseTtl(input: string): number | null {
  const match = TTL_PATTERN.exec(input.trim());
  if (!match) return null;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  switch (match[2]) {
    case 's':
      return amount * 1000;
    case 'h':
      return amount * 60 * 60 * 1000;
    default:
      return amount * 60 * 1000;
  }
}

export function clampTtl(ms: number): number {
  return Math.min(MAX_TTL_MS, Math.max(MIN_TTL_MS, ms));
}

export function remainingMs(expiresAt: number, now: number): number {
  return Math.max(0, expiresAt - now);
}

export function isExpired(expiresAt: number, now: number): boolean {
  return expiresAt <= now;
}
