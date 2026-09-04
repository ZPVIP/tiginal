/**
 * The local socket the `tiginal cred` CLI talks to.
 *
 * One `CredRequest` per connection, newline-delimited JSON in and out. This is
 * the only channel in the app that carries a plaintext value, and it carries
 * it exactly once: to the CLI process that will hand it to a child process.
 *
 * Two tables are keyed on the request discriminant, a validator table and a
 * handler table, so adding an operation to `CredRequest` fails to compile
 * until both have been filled in.
 */

import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { BrowserWindow, dialog } from 'electron';
import type { MessageBoxOptions } from 'electron';
import { getCrypto } from '../../../services/ssh/CryptoService';
import { IS_WINDOWS } from '../../utils/paths';
import { credentialSocketPathFor } from '../../../shared/credentials/local-endpoint';
import type {
  AccessMode,
  CredentialGroup,
  CredRequest,
  CredResponse,
  SessionGrant,
} from '../../../shared/credentials/types';
import {
  auditDetail,
  CredError,
  errorCode,
  getCredentialStore,
  safeMessage,
  type CredentialStore,
} from './CredentialStore';
import { getMaterializer, type Materializer } from './Materializer';
import { getCredentialRuntime, type CredentialRuntime } from './CredentialRuntime';

/** A request larger than this is not a `CredRequest`; drop the connection. */
const MAX_REQUEST_BYTES = 64 * 1024;
const CONNECTION_TIMEOUT_MS = 30_000;
const PROBE_TIMEOUT_MS = 1_000;
const NEWLINE = 0x0a;

export function credentialSocketPath(): string {
  const platform = IS_WINDOWS ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux';
  return credentialSocketPathFor({
    platform,
    homeDir: os.homedir(),
    appData: process.env.APPDATA,
    username: os.userInfo().username,
  });
}

type Validator = (record: Record<string, unknown>) => CredRequest;

function requireString(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new CredError('bad-request', `field "${field}" must be a non-empty string`);
  }
  return value;
}

function requireStringArray(record: Record<string, unknown>, field: string): string[] {
  const value = record[field];
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new CredError('bad-request', `field "${field}" must be an array of strings`);
  }
  return value as string[];
}

function optionalNumber(record: Record<string, unknown>, field: string): number | undefined {
  const value = record[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new CredError('bad-request', `field "${field}" must be a number`);
  }
  return value;
}

function requireAccessMode(record: Record<string, unknown>): AccessMode {
  const value = record.accessMode;
  if (value !== 'command' && value !== 'shell') {
    throw new CredError('bad-request', 'field "accessMode" must be "command" or "shell"');
  }
  return value;
}

function optionalExitCode(record: Record<string, unknown>): number | null {
  const value = record.exitCode;
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new CredError('bad-request', 'field "exitCode" must be a number or null');
  }
  return Math.trunc(value);
}

const REQUEST_SHAPES: Record<CredRequest['op'], Validator> = {
  ping: () => ({ op: 'ping' }),
  list: () => ({ op: 'list' }),
  status: record => ({ op: 'status', group: requireString(record, 'group') }),
  safe: record => ({ op: 'safe', group: requireString(record, 'group') }),
  'session.begin': record => ({
    op: 'session.begin',
    group: requireString(record, 'group'),
    ttlMs: optionalNumber(record, 'ttlMs'),
    command: requireStringArray(record, 'command'),
    accessMode: requireAccessMode(record),
    autoApprove: record.autoApprove === true,
    cwd: typeof record.cwd === 'string' ? record.cwd : undefined,
  }),
  'session.end': record => ({
    op: 'session.end',
    sessionId: requireString(record, 'sessionId'),
    exitCode: optionalExitCode(record),
  }),
  'session.revoke': record => ({
    op: 'session.revoke',
    sessionId: requireString(record, 'sessionId'),
  }),
};

/** Parse and validate at the boundary so no handler has to re-check a field. */
function parseRequest(raw: string): CredRequest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CredError('bad-request', 'request is not valid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new CredError('bad-request', 'request must be a JSON object');
  }

  const record = parsed as Record<string, unknown>;
  const op = record.op;
  if (typeof op !== 'string' || !Object.prototype.hasOwnProperty.call(REQUEST_SHAPES, op)) {
    throw new CredError('bad-request', 'unknown operation');
  }
  return REQUEST_SHAPES[op as CredRequest['op']](record);
}

/**
 * A live socket at the path means another instance owns it, so the path is
 * only unlinked after a connect probe fails.
 */
async function clearStaleSocket(sockPath: string): Promise<void> {
  if (IS_WINDOWS || !fs.existsSync(sockPath)) return;

  const owned = await new Promise<boolean>(resolve => {
    const probe = net.connect(sockPath);
    const settle = (value: boolean) => {
      probe.destroy();
      resolve(value);
    };
    probe.once('connect', () => settle(true));
    probe.once('error', () => settle(false));
    probe.setTimeout(PROBE_TIMEOUT_MS, () => settle(false));
  });

  if (owned) {
    throw new CredError('policy', 'another Tiginal instance owns the credential socket');
  }
  fs.unlinkSync(sockPath);
}

type SocketHandlers = {
  [K in CredRequest['op']]: (request: Extract<CredRequest, { op: K }>) => Promise<unknown>;
};

export class CredentialSocket {
  private server: net.Server | null = null;

  private readonly handlers: SocketHandlers = {
    ping: async () => ({ ready: true }),

    list: async () => this.materializer.summarizeTree(),

    status: async request => this.materializer.reportFor(this.requireGroup(request.group).id),

    safe: async request => ({
      files: this.materializer.materializeSubtree(this.requireGroup(request.group).id),
    }),

    'session.begin': request => this.beginSession(request),

    'session.end': async request => {
      this.runtime.end(request.sessionId, request.exitCode);
      return { ended: true };
    },

    'session.revoke': async request => {
      this.runtime.revoke(request.sessionId);
      return { revoked: true };
    },
  };

  constructor(
    private readonly store: CredentialStore = getCredentialStore(),
    private readonly materializer: Materializer = getMaterializer(),
    private readonly runtime: CredentialRuntime = getCredentialRuntime(),
  ) {}

  async start(): Promise<void> {
    if (this.server) return;

    const sockPath = credentialSocketPath();
    await clearStaleSocket(sockPath);
    if (!IS_WINDOWS) fs.mkdirSync(path.dirname(sockPath), { recursive: true });

    const server = net.createServer(socket => this.onConnection(socket));
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      server.once('error', onError);
      server.listen(sockPath, () => {
        server.removeListener('error', onError);
        resolve();
      });
    });

    if (!IS_WINDOWS) fs.chmodSync(sockPath, 0o600);
    // A socket-level error after listen must not take the app down with it.
    server.on('error', () => undefined);
    this.server = server;
  }

  isListening(): boolean {
    return this.server !== null && this.server.listening;
  }

  /** Synchronous: this runs from the app's `will-quit` handler. */
  stop(): void {
    const server = this.server;
    this.server = null;
    if (!server) return;

    try {
      server.close();
    } catch {
      // Closing a server that is already down needs no report.
    }
    if (IS_WINDOWS) return;
    try {
      fs.unlinkSync(credentialSocketPath());
    } catch {
      // Already unlinked.
    }
  }

  // --- internals ---

  private onConnection(socket: net.Socket): void {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let handled = false;

    const dispatch = () => {
      if (handled) return;
      handled = true;
      const joined = Buffer.concat(chunks);
      const newline = joined.indexOf(NEWLINE);
      const line = newline === -1 ? joined : joined.subarray(0, newline);
      void this.respond(socket, line.toString('utf8'));
    };

    socket.setTimeout(CONNECTION_TIMEOUT_MS, () => socket.destroy());
    // A CLI that hung up mid-request is not an app-level failure.
    socket.on('error', () => undefined);

    socket.on('data', chunk => {
      if (handled) return;
      bytes += chunk.length;
      if (bytes > MAX_REQUEST_BYTES) {
        handled = true;
        socket.destroy();
        return;
      }
      chunks.push(chunk);
      if (chunk.includes(NEWLINE)) dispatch();
    });

    // A client that closes its write side without a newline still gets served.
    socket.on('end', dispatch);
  }

  private async respond(socket: net.Socket, line: string): Promise<void> {
    let response: CredResponse;
    try {
      const request = parseRequest(line);
      const handler = this.handlers[request.op] as (r: CredRequest) => Promise<unknown>;
      response = { ok: true, data: await handler(request) };
    } catch (error) {
      // Only a message this layer authored is forwarded. An arbitrary
      // exception's text could quote a value (invariant 4).
      response = { ok: false, code: errorCode(error), error: safeMessage(error) };
    }

    try {
      socket.end(JSON.stringify(response) + '\n');
    } catch {
      socket.destroy();
    }
  }

  private async beginSession(
    request: Extract<CredRequest, { op: 'session.begin' }>,
  ): Promise<SessionGrant> {
    const group = this.requireGroup(request.group);

    // Invariant 6: a locked master key denies the request outright, rather
    // than raising a dialog the user cannot usefully act on.
    if (!getCrypto().isUnlocked()) {
      this.store.audit({
        event: 'session.denied',
        groupId: group.id,
        detail: auditDetail({ reason: 'locked', command: request.command[0] ?? '' }),
      });
      throw new CredError('locked', 'unlock Tiginal to start a credential session');
    }

    const approvedBy = await this.approve(request, group, this.runtime.effectiveTtl(request.ttlMs));

    return this.runtime.begin({
      groupId: group.id,
      ttlMs: request.ttlMs,
      command: request.command,
      accessMode: request.accessMode,
      approvedBy,
    });
  }

  private requireGroup(groupPath: string): CredentialGroup {
    const group = this.store.getGroupByPath(groupPath);
    if (!group) throw new CredError('not-found', 'no group has that path');
    return group;
  }

  /**
   * Plan §16: a CLI request does not silently obtain production credentials.
   * `--yes` and a window the user already opened in the UI are the two ways
   * past the dialog.
   */
  private async approve(
    request: Extract<CredRequest, { op: 'session.begin' }>,
    group: CredentialGroup,
    ttlMs: number,
  ): Promise<string> {
    if (request.autoApprove) return 'cli-flag';
    if (this.runtime.isPreauthorized(group.id)) return 'ui';

    const exposure = this.runtime.exposurePreview(group.id);
    const detail = [
      `Command: ${request.command[0]}`,
      `Arguments: ${request.command.length - 1}`,
      `Duration: ${Math.round(ttlMs / 60_000)} minute(s)`,
      `Environment: ${exposure.env.join(', ') || 'none'}`,
      `Files: ${exposure.files.join(', ') || 'none'}`,
    ].join('\n');

    const options: MessageBoxOptions = {
      type: 'warning',
      title: 'Credential session request',
      message: `Grant real credentials for ${this.store.groupPathOf(group.id)}?`,
      detail,
      buttons: ['Deny', 'Allow'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    };

    const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
    const result = window
      ? await dialog.showMessageBox(window, options)
      : await dialog.showMessageBox(options);

    if (result.response !== 1) {
      this.store.audit({
        event: 'session.denied',
        groupId: group.id,
        detail: auditDetail({ reason: 'user-denied', command: request.command[0] }),
      });
      throw new CredError('denied', 'the credential request was denied');
    }
    return 'ui';
  }
}

let socketInstance: CredentialSocket | null = null;

export function getCredentialSocket(): CredentialSocket {
  if (!socketInstance) {
    socketInstance = new CredentialSocket();
  }
  return socketInstance;
}

export async function startCredentialSocket(): Promise<void> {
  await getCredentialSocket().start();
}

export function stopCredentialSocket(): void {
  socketInstance?.stop();
}
