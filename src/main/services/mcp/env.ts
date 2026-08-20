import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

/**
 * A GUI-launched Electron app inherits launchd's minimal PATH, not the shell's,
 * so `npx`/`uvx` installed by homebrew, mise, nvm or pipx are invisible to
 * child processes. Prepend the usual install locations before spawning.
 */
function extraPathEntries(): string[] {
  const home = os.homedir();
  const candidates = process.platform === 'win32'
    ? [
        path.join(home, 'AppData', 'Roaming', 'npm'),
        path.join(home, '.local', 'bin'),
      ]
    : [
        '/opt/homebrew/bin',
        '/opt/homebrew/sbin',
        '/usr/local/bin',
        '/usr/local/sbin',
        '/usr/bin',
        '/bin',
        '/usr/sbin',
        '/sbin',
        path.join(home, '.local', 'bin'),
        path.join(home, '.local', 'share', 'mise', 'shims'),
        path.join(home, '.cargo', 'bin'),
        path.join(home, '.bun', 'bin'),
        path.join(home, '.deno', 'bin'),
        path.join(home, 'go', 'bin'),
      ];

  return candidates.filter(p => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  });
}

/** Build the environment for a spawned MCP server. */
export function buildSpawnEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
  const sep = process.platform === 'win32' ? ';' : ':';
  const current = (process.env.PATH || '').split(sep).filter(Boolean);
  const merged: string[] = [];

  for (const entry of [...current, ...extraPathEntries()]) {
    if (!merged.includes(entry)) merged.push(entry);
  }

  return {
    ...process.env,
    PATH: merged.join(sep),
    ...(extra || {}),
  };
}

/** Expand a leading `~/` so configs can use home-relative paths. */
export function expandHome(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}
