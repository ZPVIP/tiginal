import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatTimezoneToken(timezoneOffsetMinutes: number): string {
  if (!Number.isFinite(timezoneOffsetMinutes)) throw new Error('Timezone offset must be finite');
  const utcOffsetMinutes = -Math.trunc(timezoneOffsetMinutes);
  const direction = utcOffsetMinutes < 0 ? 'M' : 'P';
  const absoluteMinutes = Math.abs(utcOffsetMinutes);
  const hours = Math.floor(absoluteMinutes / 60);
  const minutes = absoluteMinutes % 60;
  return minutes === 0 ? `Z${direction}${hours}` : `Z${direction}${hours}H${pad(minutes)}`;
}

export function formatAudioFilename(
  startedAt: Date,
  _platform: NodeJS.Platform = process.platform,
): string {
  if (!Number.isFinite(startedAt.getTime())) throw new Error('Recording start time must be valid');
  const timestamp = [
    `${startedAt.getFullYear()}-${pad(startedAt.getMonth() + 1)}-${pad(startedAt.getDate())}`,
    `${pad(startedAt.getHours())}-${pad(startedAt.getMinutes())}-${pad(startedAt.getSeconds())}`,
  ].join('_');
  return `${timestamp}${formatTimezoneToken(startedAt.getTimezoneOffset())}.wav`;
}

export function defaultAudioDirectory(): string {
  return path.join(os.homedir(), '.cache', 'tiginal', 'audios');
}

export function createAudioRecordingPath(
  directory: string,
  startedAt: Date,
  platform: NodeJS.Platform = process.platform,
): string {
  fs.mkdirSync(directory, { recursive: true });
  const filename = formatAudioFilename(startedAt, platform);
  const extension = path.extname(filename);
  const stem = filename.slice(0, -extension.length);
  let candidate = path.join(directory, filename);
  let collision = 0;
  while (fs.existsSync(candidate) || fs.existsSync(`${candidate}.part`)) {
    collision += 1;
    candidate = path.join(directory, `${stem}_${pad(collision)}${extension}`);
  }
  return candidate;
}
