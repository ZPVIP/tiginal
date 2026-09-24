import { protocol } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { defaultAudioDirectory } from './AudioFilename';

export const AUDIO_SCHEME = 'tigaudio';

export function validateRecordingPath(recordingPath: string): string | null {
  const root = path.resolve(defaultAudioDirectory());
  const target = path.resolve(recordingPath);
  if (!target.startsWith(`${root}${path.sep}`)) return null;
  if (path.extname(target).toLowerCase() !== '.wav') return null;
  return target;
}

export function toRecordingUrl(recordingPath: string): string {
  const validated = validateRecordingPath(recordingPath);
  if (!validated) throw new Error('Recording path is outside the Tiginal audio directory');
  return `${AUDIO_SCHEME}://recording/?p=${encodeURIComponent(validated)}`;
}

function recordingPathFromUrl(url: string): string | null {
  const candidate = new URL(url).searchParams.get('p');
  return candidate ? validateRecordingPath(candidate) : null;
}

function parseRange(value: string | null, size: number): { start: number; end: number } | null {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match) return null;

  const requestedStart = match[1] ? Number.parseInt(match[1], 10) : null;
  const requestedEnd = match[2] ? Number.parseInt(match[2], 10) : null;
  if (requestedStart === null && requestedEnd === null) return null;

  const isSuffixRange = requestedStart === null;
  const start = isSuffixRange ? Math.max(0, size - (requestedEnd ?? 0)) : requestedStart;
  const end = isSuffixRange ? size - 1 : Math.min(size - 1, requestedEnd ?? size - 1);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > end || start >= size) {
    return null;
  }
  return { start, end };
}

export function registerAudioScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: AUDIO_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
      },
    },
  ]);
}

export function setupAudioMediaProtocol(): void {
  protocol.handle(AUDIO_SCHEME, async request => {
    const recordingPath = recordingPathFromUrl(request.url);
    if (!recordingPath || !fs.existsSync(recordingPath)) {
      return new Response('Not found', { status: 404 });
    }

    const size = fs.statSync(recordingPath).size;
    const range = parseRange(request.headers.get('range'), size);
    if (!range) {
      return new Response(fs.readFileSync(recordingPath), {
        headers: {
          'Accept-Ranges': 'bytes',
          'Content-Length': String(size),
          'Content-Type': 'audio/wav',
        },
      });
    }

    const data = fs.readFileSync(recordingPath).subarray(range.start, range.end + 1);
    return new Response(data, {
      status: 206,
      headers: {
        'Accept-Ranges': 'bytes',
        'Content-Length': String(data.byteLength),
        'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
        'Content-Type': 'audio/wav',
      },
    });
  });
}
