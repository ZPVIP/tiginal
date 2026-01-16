import * as pty from 'node-pty';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { getShellConfigDir } from './config';

export interface PtyOptions {
  cols?: number;
  rows?: number;
  cwd?: string;
  env?: Record<string, string>;
}

const ptyProcesses = new Map<number, pty.IPty>();
let nextPtyId = 1;

// Cache for zsh config directory
let zshConfigDir: string | null = null;

/**
 * Create and return the zsh configuration directory with custom zshrc
 */
function ensureZshConfig(): string {
  if (zshConfigDir) return zshConfigDir;

  const shellDir = getShellConfigDir();
  console.log(`[PTY] Using shell config directory: ${shellDir}`);

  // Create .zshrc that sources user's config and adds OSC 7
  const zshrc = `
# Source user's original zshrc
if [[ -f "$HOME/.zshrc" ]]; then
  source "$HOME/.zshrc"
fi

# Tiginal: OSC 7 directory tracking for tab titles
precmd() {
  print -Pn "\\e]7;file://\${HOST}\${PWD}\\a"
}
`;

  fs.writeFileSync(path.join(shellDir, '.zshrc'), zshrc);
  zshConfigDir = shellDir;
  return shellDir;
}

/**
 * Get the default shell for the current platform
 */
function getShell(): string {
  switch (process.platform) {
    case 'win32':
      return process.env.COMSPEC || 'cmd.exe';
    case 'darwin':
      return process.env.SHELL || '/bin/zsh';
    default:
      return process.env.SHELL || '/bin/bash';
  }
}

/**
 * Get shell arguments based on platform
 */
function getShellArgs(): string[] {
  return [];
}

/**
 * Create a new PTY process
 */
export function createPty(options: PtyOptions = {}): number {
  const shell = getShell();
  const args = getShellArgs();
  const cwd = options.cwd || os.homedir();

  console.log(`[PTY] Creating shell: ${shell} in ${cwd}`);

  // For bash: PROMPT_COMMAND for OSC 7 directory tracking
  const bashPromptCmd = 'printf "\\e]7;file://%s%s\\a" "$HOSTNAME" "$PWD"';

  // Build environment
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    PROMPT_COMMAND: bashPromptCmd,
    ...options.env,
  };

  // For zsh: use ZDOTDIR to load custom zshrc silently
  if (shell.includes('zsh')) {
    env.ZDOTDIR = ensureZshConfig();
  }

  try {
    const ptyProcess = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cols: options.cols || 80,
      rows: options.rows || 24,
      cwd: cwd,
      env: env,
    });

    const id = nextPtyId++;
    ptyProcesses.set(id, ptyProcess);

    console.log(`[PTY] Created PTY with id: ${id}`);
    return id;
  } catch (error) {
    console.error('[PTY] Failed to create PTY:', error);
    throw error;
  }
}

/**
 * Get PTY process by ID
 */
export function getPty(id: number): pty.IPty | undefined {
  return ptyProcesses.get(id);
}

/**
 * Write data to PTY
 */
export function writeToPty(id: number, data: string): void {
  const ptyProcess = ptyProcesses.get(id);
  if (ptyProcess) {
    ptyProcess.write(data);
  }
}

/**
 * Resize PTY
 */
export function resizePty(id: number, cols: number, rows: number): void {
  const ptyProcess = ptyProcesses.get(id);
  if (ptyProcess) {
    ptyProcess.resize(cols, rows);
  }
}

/**
 * Kill PTY process
 */
export function killPty(id: number): void {
  const ptyProcess = ptyProcesses.get(id);
  if (ptyProcess) {
    ptyProcess.kill();
    ptyProcesses.delete(id);
  }
}

/**
 * Get all active PTY IDs
 */
export function getAllPtyIds(): number[] {
  return Array.from(ptyProcesses.keys());
}
