import { protocol, type CustomScheme } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { defaultAudioDirectory } from './AudioFilename';

export const AUDIO_SCHEME = 'tigaudio';

const SUPPORTED_AUDIO_EXTENSIONS = new Set([
  '.wav', '.mp3', '.m4a', '.aac', '.flac', '.ogg', '.wma', '.mp4'
]);

function getAudioMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.mp3': return 'audio/mpeg';
    case '.m4a':
    case '.mp4': return 'audio/mp4';
    case '.flac': return 'audio/flac';
    case '.ogg': return 'audio/ogg';
    case '.aac': return 'audio/aac';
    case '.wav':
    default:
      return 'audio/wav';
  }
}

export function validateRecordingPath(recordingPath: string): string | null {
  if (!recordingPath || typeof recordingPath !== 'string') return null;
  const root = path.resolve(defaultAudioDirectory());
  const target = path.resolve(recordingPath);
  const ext = path.extname(target).toLowerCase();
  if (!SUPPORTED_AUDIO_EXTENSIONS.has(ext)) return null;
  if (!target.startsWith(`${root}${path.sep}`) && !fs.existsSync(target)) return null;
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

export const AUDIO_SCHEME_PRIVILEGES: CustomScheme = {
  scheme: AUDIO_SCHEME,
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    // The renderer page has a file:// origin, so fetching a recording is a cross-origin request.
    corsEnabled: true,
    stream: true,
  },
};

export function setupAudioMediaProtocol(): void {
  protocol.handle(AUDIO_SCHEME, async request => {
    const recordingPath = recordingPathFromUrl(request.url);
    if (!recordingPath || !fs.existsSync(recordingPath)) {
      return new Response('Not found', { status: 404, headers: { 'Access-Control-Allow-Origin': '*' } });
    }

    const size = fs.statSync(recordingPath).size;
    const range = parseRange(request.headers.get('range'), size);
    const mimeType = getAudioMimeType(recordingPath);
    if (!range) {
      return new Response(fs.readFileSync(recordingPath), {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Accept-Ranges': 'bytes',
          'Content-Length': String(size),
          'Content-Type': mimeType,
        },
      });
    }

    const data = fs.readFileSync(recordingPath).subarray(range.start, range.end + 1);
    return new Response(data, {
      status: 206,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Accept-Ranges': 'bytes',
        'Content-Length': String(data.byteLength),
        'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
        'Content-Type': mimeType,
      },
    });
  });
}
