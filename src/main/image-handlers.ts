import { ipcMain, protocol, nativeImage } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import {
  parseImageAttachmentDataUrl,
  SupportedImageMimeType,
  validateImageAttachmentBytes,
} from '../shared/image-attachments';
import { isWithin, picturesDir, resolveExisting } from './utils/paths';

/**
 * Attached images live on disk under the workspace rather than inline in the
 * conversation, so a chat log stays small and the files remain browsable:
 *
 *   <workspace>/pictures/<YYYY-MM>/<timestamp>-<rand>.<ext>
 *
 * The renderer cannot point an <img> at a file path (the CSP forbids it, and a
 * file:// load from the dev server origin is blocked), so stored images are
 * served over a `tigimg:` scheme that only ever reads from the pictures root.
 */

export const IMAGE_SCHEME = 'tigimg';

/** Longest edge, in pixels, for the copy handed to a vision model. */
const MODEL_IMAGE_MAX_EDGE = 1024;
const MODEL_IMAGE_QUALITY = 80;

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
};

const EXT_BY_MIME: Record<SupportedImageMimeType, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
};

export function picturesRoot(): string {
  return picturesDir();
}

/** Month folder, so a long-running install stays navigable. */
function monthFolder(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** Reject anything that resolves outside the pictures root. */
function insidePictures(target: string): string | null {
  const resolved = resolveExisting(target);
  return isWithin(picturesRoot(), resolved) ? resolved : null;
}

/** Build the URL the renderer puts in an <img src>. */
export function toImageUrl(absolutePath: string): string {
  return `${IMAGE_SCHEME}://f/?p=${encodeURIComponent(absolutePath)}`;
}

/**
 * Persist a data: URL and return the absolute path it was written to.
 */
export function saveDataUrl(dataUrl: string): string {
  const validation = parseImageAttachmentDataUrl(dataUrl);
  if (!validation.ok) throw new Error(validation.message);

  const { attachment } = validation;
  const ext = EXT_BY_MIME[attachment.mimeType];
  const buffer = attachment.encoding === 'base64'
    ? Buffer.from(attachment.data, 'base64')
    : Buffer.from(decodeURIComponent(attachment.data), 'utf-8');
  const bytesValidation = validateImageAttachmentBytes(attachment.mimeType, buffer);
  if (!bytesValidation.ok) throw new Error(bytesValidation.message);

  const dir = path.join(picturesRoot(), monthFolder());
  fs.mkdirSync(dir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  const rand = Math.random().toString(36).slice(2, 8);
  const file = path.join(dir, `${stamp}-${rand}${ext}`);
  fs.writeFileSync(file, buffer);
  return file;
}

/**
 * A data URL for sending to a model: downscaled with nativeImage so a phone
 * photo does not blow past the context window. Returns null if unreadable.
 */
export function toModelDataUrl(absolutePath: string): string | null {
  if (!insidePictures(absolutePath) || !fs.existsSync(absolutePath)) return null;

  try {
    let image = nativeImage.createFromPath(absolutePath);
    if (image.isEmpty()) return null;

    const { width, height } = image.getSize();
    const longest = Math.max(width, height);
    if (longest > MODEL_IMAGE_MAX_EDGE) {
      image = width >= height
        ? image.resize({ width: MODEL_IMAGE_MAX_EDGE, quality: 'good' })
        : image.resize({ height: MODEL_IMAGE_MAX_EDGE, quality: 'good' });
    }
    return `data:image/jpeg;base64,${image.toJPEG(MODEL_IMAGE_QUALITY).toString('base64')}`;
  } catch {
    return null;
  }
}

/**
 * Delete attachment files, then prune any month folder left empty. Paths
 * outside the pictures root are ignored rather than followed.
 */
export function deleteImages(paths: string[]): number {
  let removed = 0;
  const touchedDirs = new Set<string>();

  for (const candidate of paths || []) {
    const file = insidePictures(candidate);
    if (!file) continue;
    try {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
        removed++;
      }
      touchedDirs.add(path.dirname(file));
    } catch (e) {
      console.error('[Images] Failed to delete', candidate, e);
    }
  }

  for (const dir of touchedDirs) {
    // Only the month folders, and only when nothing is left in them
    if (!insidePictures(dir) || path.resolve(dir) === path.resolve(picturesRoot())) continue;
    try {
      if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
    } catch {
      /* not empty, or gone already */
    }
  }

  return removed;
}

/** Must run before app ready so the scheme is treated as a normal origin. */
export function registerImageScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: IMAGE_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true },
    },
  ]);
}

export function setupImageHandlers(): void {
  protocol.handle(IMAGE_SCHEME, async (request) => {
    const requested = new URL(request.url).searchParams.get('p');
    if (!requested) return new Response('Bad request', { status: 400 });

    const file = insidePictures(requested);
    if (!file || !fs.existsSync(file)) return new Response('Not found', { status: 404 });

    const mime = MIME_BY_EXT[path.extname(file).toLowerCase()] || 'application/octet-stream';
    return new Response(fs.readFileSync(file), { headers: { 'Content-Type': mime } });
  });

  // Save one or more data URLs, answering with the paths to store on the message
  ipcMain.handle('images:save', async (_event, dataUrls: string[]): Promise<string[]> => {
    return (dataUrls || []).map(saveDataUrl);
  });

  ipcMain.handle('images:get-url', async (_event, absolutePath: string): Promise<string | null> => {
    return insidePictures(absolutePath) ? toImageUrl(absolutePath) : null;
  });

  ipcMain.handle('images:get-root', async (): Promise<string> => picturesRoot());
}
