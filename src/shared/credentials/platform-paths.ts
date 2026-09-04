import * as path from 'node:path';

export type CredentialPlatform = 'darwin' | 'linux' | 'win32';

/**
 * Trees uses forward slashes as structural separators. This converts a native
 * absolute path into a display path without changing the path stored in the
 * credential database.
 */
export function toCredentialTreePath(
  absolutePath: string,
  platform: CredentialPlatform,
): string {
  if (platform === 'win32') {
    const normalized = path.win32.normalize(absolutePath);
    if (normalized.startsWith('\\\\')) {
      const segments = normalized.slice(2).split('\\').filter(Boolean);
      return ['Network', ...segments].join('/');
    }

    const parsed = path.win32.parse(normalized);
    const volume = parsed.root.replace(/[\\/]+$/, '') || 'Windows';
    const segments = normalized.slice(parsed.root.length).split('\\').filter(Boolean);
    return [volume, ...segments].join('/');
  }

  const normalized = path.posix.normalize(absolutePath);
  const segments = normalized.split('/').filter(Boolean);
  return ['Filesystem', ...segments].join('/');
}
