import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getDatabase } from '../../services/database/database';

/**
 * One place that knows where things live on each platform.
 *
 * Before this existed, five call sites resolved the workspace independently and
 * only three of them had a Windows branch -- so on Windows the Bash tool and
 * the MCP interpreters ran in ~/.config/tiginal/workspaces while Settings
 * created and displayed %APPDATA%\Tiginal\workspaces.
 */

export const IS_WINDOWS = process.platform === 'win32';
export const IS_MAC = process.platform === 'darwin';
export const IS_LINUX = !IS_WINDOWS && !IS_MAC;

/** Expand a leading `~` so stored settings can be home-relative. */
export function expandHome(p: string): string {
  if (!p) return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || (IS_WINDOWS && p.startsWith('~\\'))) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

/** Root for everything the app keeps outside its userData directory. */
export function configDir(): string {
  return IS_WINDOWS
    ? path.join(process.env.APPDATA || os.homedir(), 'Tiginal')
    : path.join(os.homedir(), '.config', 'tiginal');
}

export function defaultWorkspaceDir(): string {
  return path.join(configDir(), 'workspaces');
}

export function defaultSkillsDir(): string {
  return path.join(configDir(), 'skills');
}

/** The workspace the user configured, or the platform default. */
export function workspaceDir(): string {
  const stored = getDatabase().getSetting('workspacePath');
  return stored ? expandHome(stored) : defaultWorkspaceDir();
}

/** Where message attachments are kept. */
export function picturesDir(): string {
  return path.join(workspaceDir(), 'pictures');
}

/**
 * Compare two paths as the local filesystem would: Windows and macOS are
 * case-insensitive, so a plain string compare can miss a real match.
 */
export function samePath(a: string, b: string): boolean {
  return normalizeForCompare(a) === normalizeForCompare(b);
}

export function normalizeForCompare(p: string): string {
  const resolved = path.resolve(expandHome(p));
  return IS_WINDOWS || IS_MAC ? resolved.toLowerCase() : resolved;
}

/**
 * Resolve a path that may not exist yet, following symlinks as far as they go,
 * so containment checks cannot be fooled by a link in the middle.
 */
export function resolveExisting(target: string): string {
  const requested = path.resolve(expandHome(target));

  let probe = requested;
  while (!fs.existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) return requested;
    probe = parent;
  }

  try {
    return path.join(fs.realpathSync(probe), path.relative(probe, requested));
  } catch {
    return requested;
  }
}

/**
 * True when `child` is `parent` or sits under it. Symlinks are resolved first,
 * so a link cannot be used to step outside the parent; a path that does not
 * exist yet is compared lexically.
 */
export function isWithin(parent: string, child: string): boolean {
  // Both sides go through resolveExisting: realpathSync throws on a path that
  // does not exist yet, and falling back to the lexical path would compare
  // /var/... against a parent already resolved to /private/var/... on macOS.
  const root = normalizeForCompare(resolveExisting(parent));
  const target = normalizeForCompare(resolveExisting(child));
  return target === root || target.startsWith(root + path.sep);
}

