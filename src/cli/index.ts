import * as net from 'node:net';
import * as os from 'node:os';
import { spawn, type ChildProcess } from 'node:child_process';
import { parseTtl } from '../shared/credentials/state';
import { credentialSocketPathFor } from '../shared/credentials/local-endpoint';
import type { AccessMode, CredRequest, SessionGrant } from '../shared/credentials/types';

const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const SOCKET_TIMEOUT_MS = 30_000;

class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode: number,
  ) {
    super(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function platform(): 'darwin' | 'linux' | 'win32' {
  if (process.platform === 'win32') return 'win32';
  return process.platform === 'darwin' ? 'darwin' : 'linux';
}

function socketPath(): string {
  return credentialSocketPathFor({
    platform: platform(),
    homeDir: os.homedir(),
    appData: process.env.APPDATA,
    username: os.userInfo().username,
  });
}

function sendRequest(request: CredRequest): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath());
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;

    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(new CliError(message, 1));
    };

    socket.setTimeout(SOCKET_TIMEOUT_MS, () => fail('Tiginal did not answer the credential request'));
    socket.on('error', () => fail('Tiginal is not running or its credential service is unavailable'));
    // Keep the connection open while the desktop app waits for approval.
    // The server closes it after writing the response.
    socket.on('connect', () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on('data', chunk => {
      if (settled) return;
      bytes += chunk.length;
      if (bytes > MAX_RESPONSE_BYTES) {
        fail('Tiginal returned an invalid credential response');
        return;
      }
      chunks.push(chunk);
    });
    socket.on('end', () => {
      if (settled) return;
      settled = true;

      let parsed: unknown;
      try {
        parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        reject(new CliError('Tiginal returned an invalid credential response', 1));
        return;
      }

      if (!isRecord(parsed) || typeof parsed.ok !== 'boolean') {
        reject(new CliError('Tiginal returned an invalid credential response', 1));
        return;
      }
      if (!parsed.ok) {
        const message = typeof parsed.error === 'string' ? parsed.error : 'Credential request failed';
        reject(new CliError(message, 1));
        return;
      }
      resolve(parsed.data);
    });
  });
}

function text(record: Record<string, unknown>, key: string, fallback = ''): string {
  return typeof record[key] === 'string' ? record[key] : fallback;
}

function number(record: Record<string, unknown>, key: string, fallback = 0): number {
  return typeof record[key] === 'number' ? record[key] : fallback;
}

function printList(data: unknown): void {
  if (!Array.isArray(data)) throw new CliError('Tiginal returned an invalid group list', 1);
  if (data.length === 0) {
    process.stdout.write('No credential groups.\n');
    return;
  }

  for (const item of data) {
    if (!isRecord(item)) throw new CliError('Tiginal returned an invalid group list', 1);
    const depth = Math.max(0, Math.trunc(number(item, 'depth')));
    const line = [
      `${'  '.repeat(depth)}${text(item, 'path', text(item, 'name', 'unknown'))}`,
      `[${text(item, 'status', 'unknown').toUpperCase()}]`,
      `${number(item, 'fileCount')} files`,
      `${number(item, 'secretCount')} secrets`,
    ].join(' ');
    process.stdout.write(`${line}\n`);
  }
}

function printStatus(data: unknown): void {
  if (!isRecord(data) || !isRecord(data.group) || !Array.isArray(data.files)) {
    throw new CliError('Tiginal returned an invalid group status', 1);
  }

  process.stdout.write(`${text(data.group, 'path', text(data.group, 'name'))} [${text(data.group, 'status').toUpperCase()}]\n`);
  for (const file of data.files) {
    if (!isRecord(file)) throw new CliError('Tiginal returned an invalid group status', 1);
    const state = isRecord(file.state) ? text(file.state, 'kind', 'unknown') : 'unknown';
    process.stdout.write(`  ${text(file, 'absolutePath', text(file, 'relativePath'))} [${state.toUpperCase()}]\n`);
    if (!Array.isArray(file.entries)) continue;
    for (const entry of file.entries) {
      if (!isRecord(entry)) continue;
      process.stdout.write(`    ${text(entry, 'keyName', 'SECRET')}=********\n`);
    }
  }
}

function printSafeResult(data: unknown): void {
  if (!isRecord(data) || !Array.isArray(data.files)) {
    throw new CliError('Tiginal returned an invalid safe-mode result', 1);
  }
  for (const file of data.files) {
    if (!isRecord(file)) continue;
    const state = isRecord(file.state) ? text(file.state, 'kind', 'unknown') : 'error';
    const error = typeof file.error === 'string' ? `: ${file.error}` : '';
    process.stdout.write(`${text(file, 'path', 'unknown')} [${state.toUpperCase()}]${error}\n`);
  }
}

function stringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every(item => typeof item === 'string');
}

function parseGrant(data: unknown): SessionGrant {
  if (
    !isRecord(data)
    || typeof data.sessionId !== 'string'
    || typeof data.expiresAt !== 'number'
    || !stringRecord(data.env)
    || typeof data.tmpDir !== 'string'
    || !Array.isArray(data.files)
    || !Array.isArray(data.notes)
  ) {
    throw new CliError('Tiginal returned an invalid session grant', 1);
  }

  const files: Array<{ path: string; label: string }> = [];
  for (const file of data.files) {
    if (!isRecord(file) || typeof file.path !== 'string' || typeof file.label !== 'string') {
      throw new CliError('Tiginal returned an invalid session grant', 1);
    }
    files.push({ path: file.path, label: file.label });
  }
  if (data.notes.some(note => typeof note !== 'string')) {
    throw new CliError('Tiginal returned an invalid session grant', 1);
  }

  return {
    sessionId: data.sessionId,
    expiresAt: data.expiresAt,
    env: data.env,
    tmpDir: data.tmpDir,
    files,
    notes: data.notes,
  };
}

interface RunOptions {
  group: string;
  ttlMs?: number;
  autoApprove: boolean;
  verbose: boolean;
}

function parseRunOptions(args: string[]): { options: RunOptions; commandIndex: number } {
  const group = args[0];
  if (!group || group.startsWith('-')) throw new CliError('A credential group is required', 2);

  let ttlMs: number | undefined;
  let autoApprove = false;
  let verbose = false;
  let index = 1;
  while (index < args.length && args[index] !== '--') {
    const arg = args[index];
    if (arg === '--yes') {
      autoApprove = true;
      index += 1;
      continue;
    }
    if (arg === '--verbose' || arg === '-v') {
      verbose = true;
      index += 1;
      continue;
    }
    if (arg === '--ttl' || arg.startsWith('--ttl=')) {
      const value = arg === '--ttl' ? args[index + 1] : arg.slice('--ttl='.length);
      const parsed = value ? parseTtl(value) : null;
      if (parsed === null) throw new CliError('TTL must be a positive number followed by s, m, or h', 2);
      ttlMs = parsed;
      index += arg === '--ttl' ? 2 : 1;
      continue;
    }
    throw new CliError(`Unknown option: ${arg}`, 2);
  }

  return { options: { group, ttlMs, autoApprove, verbose }, commandIndex: index };
}

async function closeSession(sessionId: string, exitCode: number | null): Promise<void> {
  try {
    await sendRequest({ op: 'session.end', sessionId, exitCode });
  } catch {
    // The desktop runtime's TTL and startup sweep are the fallback cleanup layers.
  }
}

function waitForChild(child: ChildProcess): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    child.once('error', () => reject(new CliError('The command could not be started', 1)));
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
}

async function runCommand(options: RunOptions, command: string[], accessMode: AccessMode): Promise<number> {
  const grant = parseGrant(await sendRequest({
    op: 'session.begin',
    group: options.group,
    ttlMs: options.ttlMs,
    command,
    accessMode,
    autoApprove: options.autoApprove,
    cwd: process.cwd(),
  }));

  if (options.verbose) {
    for (const note of grant.notes) process.stderr.write(`tiginal: ${note}\n`);
  }

  const child = spawn(command[0], command.slice(1), {
    cwd: process.cwd(),
    env: { ...process.env, ...grant.env, TIGINAL_CRED_SESSION: grant.sessionId },
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  let handlingSignal = false;
  type ManagedSignal = 'SIGHUP' | 'SIGINT' | 'SIGTERM';
  const signals: ManagedSignal[] = process.platform === 'win32'
    ? ['SIGINT', 'SIGTERM']
    : ['SIGHUP', 'SIGINT', 'SIGTERM'];
  for (const signal of signals) {
    const handler = () => {
      if (handlingSignal) return;
      handlingSignal = true;
      child.kill(signal);
      void closeSession(grant.sessionId, null).finally(() => {
        process.kill(process.pid, signal);
      });
    };
    process.once(signal, handler);
  }

  const result = await waitForChild(child);
  await closeSession(grant.sessionId, result.code);
  if (result.code !== null) return result.code;
  return result.signal ? 128 + (os.constants.signals[result.signal] ?? 0) : 1;
}

function usage(): string {
  return [
    'Tiginal credential CLI',
    '',
    'Run commands with credentials managed by the Tiginal desktop app.',
    'Tiginal must be running and unlocked before you use credential commands.',
    '',
    'Usage:',
    '  tiginal cred <command> [options]',
    '',
    'Commands:',
    '  list                         List credential groups and their current state.',
    '  status <group>               Show managed files and masked credential names.',
    '  safe <group>                 Write safe placeholders to the group\'s managed files.',
    '  run <group> [options] -- <command> [args...]',
    '                               Run one command with credentials injected.',
    '  shell <group> [options]      Start an interactive shell with credentials injected.',
    '',
    'Options for run and shell:',
    '  --ttl <duration>             Set the session lifetime, such as 30s, 15m, or 1h.',
    '  --yes                        Skip desktop approval when the active policy permits it.',
    '  -v, --verbose                Print session expiry and injected variable names.',
    '  -h, --help                   Show this help.',
    '',
    'Examples:',
    '  tiginal cred list',
    '  tiginal cred status ioaire-cloud',
    '  tiginal cred run ioaire-cloud -- sh -c \'printf "%s\\n" "$AWS_ACCESS_KEY_ID"\'',
    '  tiginal cred run ioaire-cloud -v -- bundle exec rails console',
    '  tiginal cred shell ioaire-cloud --ttl 30m',
    '',
    'Shell variable expansion:',
    '  Your current shell expands $VARIABLE before Tiginal starts the child command.',
    '  Use sh -c as shown above, or start tiginal cred shell <group> for several commands.',
  ].join('\n');
}

export async function runCli(argv: string[]): Promise<number> {
  try {
    const helpRequested = argv[0] === '--help'
      || argv[0] === '-h'
      || (argv[0] === 'cred' && (argv[1] === '--help' || argv[1] === '-h'))
      || (argv[0] === 'cred' && (argv[2] === '--help' || argv[2] === '-h'));
    if (helpRequested) {
      process.stdout.write(`${usage()}\n`);
      return 0;
    }
    if (argv[0] !== 'cred') throw new CliError(usage(), 2);
    const command = argv[1];

    if (command === 'list') {
      printList(await sendRequest({ op: 'list' }));
      return 0;
    }
    if (command === 'status') {
      if (!argv[2]) throw new CliError(usage(), 2);
      printStatus(await sendRequest({ op: 'status', group: argv[2] }));
      return 0;
    }
    if (command === 'safe') {
      if (!argv[2]) throw new CliError(usage(), 2);
      printSafeResult(await sendRequest({ op: 'safe', group: argv[2] }));
      return 0;
    }
    if (command === 'run') {
      const parsed = parseRunOptions(argv.slice(2));
      if (argv[parsed.commandIndex + 2] !== '--') throw new CliError(usage(), 2);
      const childCommand = argv.slice(parsed.commandIndex + 3);
      if (childCommand.length === 0) throw new CliError(usage(), 2);
      return await runCommand(parsed.options, childCommand, 'command');
    }
    if (command === 'shell') {
      const parsed = parseRunOptions(argv.slice(2));
      if (parsed.commandIndex !== argv.length - 2) throw new CliError(usage(), 2);
      const shell = process.platform === 'win32'
        ? process.env.COMSPEC || 'cmd.exe'
        : process.env.SHELL || '/bin/sh';
      const shellCommand = process.platform === 'win32' ? [shell] : [shell, '-i'];
      return await runCommand(parsed.options, shellCommand, 'shell');
    }

    throw new CliError(usage(), 2);
  } catch (error) {
    if (error instanceof CliError) {
      process.stderr.write(`${error.message}\n`);
      return error.exitCode;
    }
    process.stderr.write('Credential command failed.\n');
    return 1;
  }
}
