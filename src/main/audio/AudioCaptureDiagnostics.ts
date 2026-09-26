import * as fs from 'fs';
import * as path from 'path';
import {
  SYSTEM_AUDIO_DISPLAY_MEDIA_OPTIONS,
  type AudioCaptureDiagnostic,
  type AudioCaptureTrackDiagnostic,
  type MacMediaAccessStatus,
} from '../../shared/audio/types';

export interface AudioCaptureRuntimeDiagnostic {
  platform: NodeJS.Platform;
  isPackaged: boolean;
  electronVersion: string;
  screenPermission: MacMediaAccessStatus;
  disabledFeatures: string[];
}

export function getAudioCaptureLogPath(userDataPath: string): string {
  return path.join(userDataPath, 'logs', 'audio-capture.jsonl');
}

function requiredString(value: unknown, name: string, maxLength = 500): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value;
}

function optionalFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function parseTrack(value: unknown): AudioCaptureTrackDiagnostic {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Audio capture track diagnostic must be an object');
  }
  const kind = Reflect.get(value, 'kind');
  const readyState = Reflect.get(value, 'readyState');
  const enabled = Reflect.get(value, 'enabled');
  const muted = Reflect.get(value, 'muted');
  if (kind !== 'audio' && kind !== 'video') throw new Error('Audio capture track kind is invalid');
  if (readyState !== 'live' && readyState !== 'ended') throw new Error('Audio capture track state is invalid');
  if (typeof enabled !== 'boolean' || typeof muted !== 'boolean') {
    throw new Error('Audio capture track flags are invalid');
  }
  const sampleRate = optionalFiniteNumber(Reflect.get(value, 'sampleRate'));
  const channelCount = optionalFiniteNumber(Reflect.get(value, 'channelCount'));
  const displaySurface = Reflect.get(value, 'displaySurface');
  return {
    kind,
    readyState,
    enabled,
    muted,
    ...(sampleRate === undefined ? {} : { sampleRate }),
    ...(channelCount === undefined ? {} : { channelCount }),
    ...(typeof displaySurface === 'string' ? { displaySurface: displaySurface.slice(0, 100) } : {}),
  };
}

export function parseAudioCaptureDiagnostic(value: unknown): AudioCaptureDiagnostic {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Audio capture diagnostic must be an object');
  }
  const event = Reflect.get(value, 'event');
  const captureId = requiredString(Reflect.get(value, 'captureId'), 'Capture ID', 100);
  if (event === 'capture-requested') {
    const source = Reflect.get(value, 'source');
    if (source !== 'system' && source !== 'mixed') throw new Error('Audio capture source is invalid');
    return { event, captureId, source };
  }
  if (event === 'stream-state') {
    const phase = Reflect.get(value, 'phase');
    const validPhase = phase === 'returned'
      || phase === 'settled'
      || phase === 'track-muted'
      || phase === 'track-unmuted'
      || phase === 'track-ended';
    if (!validPhase) throw new Error('Audio capture phase is invalid');
    const tracks = Reflect.get(value, 'tracks');
    if (!Array.isArray(tracks) || tracks.length > 16) throw new Error('Audio capture tracks are invalid');
    return { event, captureId, phase, tracks: tracks.map(parseTrack) };
  }
  if (event === 'capture-failed') {
    return {
      event,
      captureId,
      name: requiredString(Reflect.get(value, 'name'), 'Error name', 100),
      message: requiredString(Reflect.get(value, 'message'), 'Error message'),
    };
  }
  throw new Error('Audio capture diagnostic event is invalid');
}

export function appendAudioCaptureDiagnostic(
  userDataPath: string,
  runtime: AudioCaptureRuntimeDiagnostic,
  value: unknown,
): void {
  const diagnostic = parseAudioCaptureDiagnostic(value);
  const logPath = getAudioCaptureLogPath(userDataPath);
  fs.mkdirSync(path.dirname(logPath), { recursive: true, mode: 0o700 });
  const record = {
    timestamp: new Date().toISOString(),
    runtime,
    ...(diagnostic.event === 'capture-requested'
      ? { displayMediaOptions: SYSTEM_AUDIO_DISPLAY_MEDIA_OPTIONS }
      : {}),
    diagnostic,
  };
  const line = `${JSON.stringify(record)}\n`;
  fs.appendFileSync(logPath, line, { encoding: 'utf8', mode: 0o600 });
  console.log(`[AudioCapture] ${line.trimEnd()}`);
}
