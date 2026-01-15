import * as pty from 'node-pty';
import * as os from 'os';

export interface PtyOptions {
  cols?: number;
  rows?: number;
  cwd?: string;
  env?: Record<string, string>;
}

const ptyProcesses = new Map<number, pty.IPty>();
let nextPtyId = 1;

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
  // Don't use --login to avoid issues
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

  // Inject OSC 7 directory reporting for zsh/bash
  const osc7Precmd = 'precmd() { print -Pn "\\e]7;file://${HOST}${PWD}\\a" }';
  const osc7PromptCommand = 'printf "\\e]7;file://%s%s\\a" "$HOSTNAME" "$PWD"';

  try {
    const ptyProcess = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cols: options.cols || 80,
      rows: options.rows || 24,
      cwd: cwd,
      env: {
        ...process.env,
        // For zsh: ZDOTDIR trick won't work easily, so we'll inject via init
        // For bash: PROMPT_COMMAND
        PROMPT_COMMAND: osc7PromptCommand,
        ...options.env,
      } as Record<string, string>,
    });

    // For zsh, send the precmd function definition after spawn
    if (shell.includes('zsh')) {
      setTimeout(() => {
        ptyProcess.write(`${osc7Precmd}\n`);
        // Clear the screen and reprint prompt
        ptyProcess.write('clear\n');
      }, 100);
    }

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
