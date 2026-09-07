/**
 * Live credential sessions: the only place in the app where a decrypted value
 * exists, and the only place that can put one on disk.
 *
 * Three independent cleanup layers protect a swapped file and a temp directory
 * (plan §21). `finish` covers a normal end, revoke and TTL expiry; the process
 * handlers installed at module load cover a signal or an uncaught exception;
 * `sweepOrphans` at app start covers a crash that reached neither. Every layer
 * runs the same synchronous filesystem work, in the same order, and none of it
 * depends on the database or the crypto service still being available.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getCrypto } from '../../../services/ssh/CryptoService';
import { classifyEnvValue, fakeValueFor } from '../../../shared/credentials/classify';
import {
  FORMAT_HANDLERS,
  isValidKeyName,
  storableValue,
} from '../../../shared/credentials/formats';
import { fingerprint } from '../../../shared/credentials/state';
import {
  DEFAULT_TTL_MS,
  MAX_TTL_MS,
  MIN_TTL_MS,
} from '../../../shared/credentials/types';
import type {
  AccessMode,
  AuditEvent,
  CredentialFile,
  CredentialGroup,
  CredentialUiSessionGrant,
  CredentialUiSessionRequest,
  EnvEntryEdit,
  FileKind,
  GroupKind,
  RevealedEnvEntry,
  RevealedFileContent,
  SessionGrant,
  SessionStatus,
} from '../../../shared/credentials/types';
import {
  auditDetail,
  CredError,
  getCredentialStore,
  type CredentialStore,
} from './CredentialStore';
import {
  claimRevealCapability,
  getMaterializer,
  type Materializer,
  type RevealCapability,
  type RevealedEntry,
} from './Materializer';

/** Claimed at module load, so no later module can claim it. */
const REVEAL: RevealCapability = claimRevealCapability();

/**
 * What each group kind needs beyond the raw key/value pairs. A table rather
 * than a chain of `if (kind === ...)` so adding a kind to `GroupKind` fails to
 * compile until its behaviour is stated here.
 */
interface KindAdapter {
  /** Extra environment names that carry the same value as `key`. */
  envAliases(key: string): string[];
  /** Extra environment variables that point at an ephemeral file. */
  fileEnv(basename: string, ephemeralPath: string): Record<string, string>;
}

const PASSTHROUGH: KindAdapter = {
  envAliases: () => [],
  fileEnv: () => ({}),
};

const KIND_ADAPTERS: Record<GroupKind, KindAdapter> = {
  generic: PASSTHROUGH,
  rails: PASSTHROUGH,
  kamal: PASSTHROUGH,
  ssh: PASSTHROUGH,
  terraform: {
    // Terraform reads `TF_VAR_<name>` for each declared variable, so a tfvars
    // key needs the prefix and no renaming.
    envAliases: key => [`TF_VAR_${key}`],
    fileEnv: () => ({}),
  },
  aws: {
    // The canonical AWS_* names already match the keys in ~/.aws/credentials.
    envAliases: () => [],
    fileEnv: (basename, ephemeralPath) => {
      const env: Record<string, string> = {};
      if (basename === 'credentials') env.AWS_SHARED_CREDENTIALS_FILE = ephemeralPath;
      return env;
    },
  },
};

/**
 * A dotenv value's quotes belong to the file, not to the variable: a shell
 * reading `KEY="v"` exports `v`. The stored value keeps them so a rewrite
 * cannot change the file's own quoting, so they come off here instead.
 */
function environmentValue(kind: FileKind, stored: string): string {
  if (kind !== 'env') return stored;
  const quote = stored[0];
  const quoted = (quote === '"' || quote === "'") && stored.length > 1 && stored.endsWith(quote);
  return quoted ? stored.slice(1, -1) : stored;
}

function readTextIfPossible(filePath: string | null): string | null {
  if (!filePath) return null;
  try {
    return fs.statSync(filePath).isFile() ? fs.readFileSync(filePath, 'utf8') : null;
  } catch {
    return null;
  }
}

/** An opaque file is one nameless value, so its whole body is that entry. */
function wholeFileText(revealed: RevealedEntry[]): string {
  return revealed[0]?.value ?? '';
}

function revealedEnvEntries(file: CredentialFile, revealed: RevealedEntry[]): RevealedEnvEntry[] {
  const content = readTextIfPossible(file.absolutePath);
  const onDisk = new Set(
    content === null ? [] : FORMAT_HANDLERS[file.format].parse(content).map(entry => entry.key),
  );

  return revealed.map(entry => ({
    keyName: entry.key,
    secretType: entry.secretType,
    value: entry.value,
    onDisk: onDisk.has(entry.key),
  }));
}

/** What the detail pane shows, per kind the user declared. */
const REVEALED_CONTENT: Record<
  FileKind,
  (file: CredentialFile, revealed: RevealedEntry[]) => RevealedFileContent
> = {
  key: (_file, revealed) => ({ kind: 'key', text: wholeFileText(revealed) }),
  'ssh-key': (file, revealed) => ({
    kind: 'ssh-key',
    text: wholeFileText(revealed),
    publicKeyText: readTextIfPossible(file.publicKeyPath),
  }),
  env: (file, revealed) => ({ kind: 'env', entries: revealedEnvEntries(file, revealed) }),
};

const AUDIT_FOR_STATUS: Record<SessionStatus, AuditEvent> = {
  active: 'session.started',
  completed: 'session.ended',
  expired: 'session.expired',
  revoked: 'session.revoked',
};

const TMP_ROOT_NAME = 'tiginal-cred';
const MANIFEST_NAME = 'manifest.json';
const SWAP_DIR_NAME = 'swap';

/** One managed file put at its own path in real form, and how to undo that. */
interface SwapRecord {
  path: string;
  /** A copy of the pre-swap (masked) bytes, inside the session temp dir. */
  safePath: string;
  safeFingerprint: string;
  mode: number | null;
}

interface LiveSession {
  id: string;
  tmpDir: string;
  ephemeralFiles: string[];
  swapped: SwapRecord[];
  timer: NodeJS.Timeout | null;
  finished: boolean;
}

/** Metadata only: paths, ids and fingerprints, never a value. */
interface SessionManifest {
  sessionId: string;
  expiresAt: number;
  files: string[];
  swapped: SwapRecord[];
}

/** A window the UI opened during which a CLI request skips the dialog. */
interface Preauthorization {
  sessionId: string;
  groupIds: Set<string>;
  expiresAt: number;
  timer: NodeJS.Timeout;
}

export interface BeginRequest {
  groupId: string;
  ttlMs?: number;
  command: string[];
  accessMode: AccessMode;
  approvedBy: string;
  pid?: number | null;
}

export interface PreauthorizeRequest {
  groupId: string;
  ttlMs?: number;
  /** Descendants the user ticked. Defaults to the whole subtree. */
  groupIds?: string[];
}

const UI_ORIGINAL_FILES_APPROVER = 'ui-original-files';

function tmpRoot(): string {
  return path.join(os.tmpdir(), TMP_ROOT_NAME);
}

function clampTtl(requested: number | undefined): number {
  const ttl = requested ?? DEFAULT_TTL_MS;
  if (!Number.isFinite(ttl)) return DEFAULT_TTL_MS;
  return Math.min(Math.max(Math.trunc(ttl), MIN_TTL_MS), MAX_TTL_MS);
}

/** argv[0] and a count. The tail is never stored: a user may have typed a secret into it. */
function commandSummary(command: string[]): string {
  const head = command[0] ?? '';
  return command.length > 1 ? `${head} +${command.length - 1}` : head;
}

/** An environment-safe token for `TIGINAL_CRED_FILE_<TOKEN>`. */
function envToken(basename: string): string {
  const token = basename
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
  return token || 'FILE';
}

// Everything from here to `removeDir` also runs from `process.on('exit')`, so
// it is synchronous and swallows its own errors: a throw would abandon a real
// secret on disk.

function shredFile(filePath: string): void {
  try {
    const stats = fs.lstatSync(filePath);
    if (stats.isFile() && stats.size > 0) {
      fs.writeFileSync(filePath, Buffer.alloc(stats.size));
    }
  } catch {
    // Unlink is still worth attempting.
  }
  try {
    fs.unlinkSync(filePath);
  } catch {
    // Already gone.
  }
}

function shredTree(dir: string): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      shredTree(target);
    } else {
      // A symlink is unlinked, never written through: zeroing it would hit
      // whatever it points at.
      shredFile(target);
    }
  }
}

function removeDir(dir: string): boolean {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Put every swapped file back from its masked copy. Needs no database, no
 * decryption key and no in-memory state, which is what lets the startup sweep
 * recover a session whose process is long gone.
 */
function restoreSwapped(records: SwapRecord[]): { restored: number; failures: number; suspect: number } {
  let restored = 0;
  let failures = 0;
  let suspect = 0;

  for (const record of records) {
    if (!fs.existsSync(record.path)) {
      // The user deleted the file during the session. Nothing on disk to protect.
      restored++;
      continue;
    }
    let safe: string;
    try {
      safe = fs.readFileSync(record.safePath, 'utf8');
    } catch {
      failures++;
      continue;
    }
    // A corrupt copy is still written: removing the real value matters more
    // than the masked content being byte-perfect, and the count below keeps
    // the temp directory around so the user can recover from it.
    if (fingerprint(safe) !== record.safeFingerprint) suspect++;
    try {
      fs.writeFileSync(record.path, safe, { encoding: 'utf8', mode: record.mode ?? 0o600 });
      if (record.mode !== null) fs.chmodSync(record.path, record.mode);
      restored++;
    } catch {
      failures++;
    }
  }

  return { restored, failures, suspect };
}

function isSwapRecord(value: unknown): value is SwapRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.path === 'string' &&
    typeof record.safePath === 'string' &&
    typeof record.safeFingerprint === 'string' &&
    (typeof record.mode === 'number' || record.mode === null)
  );
}

/** A manifest may have been written by an older build, so it is parsed, not trusted. */
function readManifest(manifestPath: string): SessionManifest | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return null;
    const record = parsed as Record<string, unknown>;
    return {
      sessionId: typeof record.sessionId === 'string' ? record.sessionId : '',
      expiresAt: typeof record.expiresAt === 'number' ? record.expiresAt : 0,
      files: Array.isArray(record.files)
        ? record.files.filter((item): item is string => typeof item === 'string')
        : [],
      swapped: Array.isArray(record.swapped) ? record.swapped.filter(isSwapRecord) : [],
    };
  } catch {
    return null;
  }
}

function writeManifest(session: LiveSession, expiresAt: number): void {
  const manifest: SessionManifest = {
    sessionId: session.id,
    expiresAt,
    files: session.ephemeralFiles,
    swapped: session.swapped,
  };
  const manifestPath = path.join(session.tmpDir, MANIFEST_NAME);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  });
  fs.chmodSync(manifestPath, 0o600);
}

/** Create and validate `<tmpdir>/tiginal-cred`, refusing anything not ours. */
function prepareTmpRoot(): string {
  const root = tmpRoot();
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });

  // lstat before chmod: chmod would follow a symlink planted at this path.
  const stats = fs.lstatSync(root);
  if (!stats.isDirectory()) {
    throw new CredError('policy', 'the credential temp root is not a directory');
  }
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  if (uid !== null && stats.uid !== uid) {
    throw new CredError('policy', 'the credential temp root is owned by another user');
  }

  fs.chmodSync(root, 0o700);
  return root;
}

function makePrivateDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
}

export class CredentialRuntime {
  private readonly live = new Map<string, LiveSession>();
  private readonly preauthorized = new Map<string, Preauthorization>();

  constructor(
    private readonly store: CredentialStore = getCredentialStore(),
    private readonly materializer: Materializer = getMaterializer(),
  ) {}

  async begin(req: BeginRequest): Promise<SessionGrant> {
    if (!getCrypto().isUnlocked()) {
      throw new CredError('locked', 'unlock Tiginal to start a credential session');
    }
    if (req.command.length === 0) {
      throw new CredError('bad-request', 'a command is required');
    }

    const scope = this.store.descendantsOf(req.groupId);
    if (scope.length === 0) throw new CredError('not-found', 'group does not exist');
    const root = scope[0];

    this.enforceCommandPolicy(root, req.command);

    const ttlMs = clampTtl(req.ttlMs);
    const expiresAt = Date.now() + ttlMs;

    // Validated before the row exists, so a hostile temp root cannot leave a
    // session behind with nothing to clean it up.
    const tmpRootDir = prepareTmpRoot();

    this.store.audit({
      event: 'session.requested',
      groupId: root.id,
      detail: auditDetail({
        command: req.command[0],
        args: req.command.length - 1,
        mode: req.accessMode,
        ttlMs,
        approvedBy: req.approvedBy,
      }),
    });

    const session = this.store.createSession({
      groupId: root.id,
      accessMode: req.accessMode,
      approvedBy: req.approvedBy,
      tmpDir: null,
      pid: req.pid ?? null,
      commandSummary: commandSummary(req.command),
      expiresAt,
    });

    const record: LiveSession = {
      id: session.id,
      tmpDir: path.join(tmpRootDir, session.id),
      ephemeralFiles: [],
      swapped: [],
      timer: null,
      finished: false,
    };

    try {
      makePrivateDir(record.tmpDir);
      this.store.setSessionTmpDir(session.id, record.tmpDir);
      this.live.set(session.id, record);

      const grant = this.provision(scope, record, expiresAt);
      writeManifest(record, expiresAt);

      record.timer = setTimeout(() => this.finish(session.id, 'expired', null), ttlMs);

      this.store.audit({
        event: 'session.started',
        groupId: root.id,
        sessionId: session.id,
        detail: auditDetail({
          envVars: Object.keys(grant.env).length,
          files: grant.files.length,
          ttlMs,
        }),
      });

      return grant;
    } catch (error) {
      // A half-provisioned session may already have real bytes on disk.
      this.finish(session.id, 'revoked', null);
      throw error;
    }
  }

  end(sessionId: string, exitCode: number | null): void {
    this.finish(sessionId, 'completed', exitCode);
  }

  revoke(sessionId: string): void {
    const preauth = this.preauthorized.get(sessionId);
    if (preauth) {
      clearTimeout(preauth.timer);
      this.preauthorized.delete(sessionId);
      this.closeRow(sessionId, 'revoked', null, auditDetail({ kind: 'preauthorization' }));
      return;
    }
    this.finish(sessionId, 'revoked', null);
  }

  /**
   * Open an approval window from the UI. Grants nothing: no temp directory, no
   * decryption, no plaintext. A later CLI `session.begin` for a group in the
   * window skips the confirmation dialog.
   */
  preauthorize(req: PreauthorizeRequest): { sessionId: string; expiresAt: number } {
    if (!getCrypto().isUnlocked()) {
      throw new CredError('locked', 'unlock Tiginal to authorize a credential session');
    }

    const scope = this.selectedScope(req.groupId, req.groupIds);
    const selected = scope.map(group => group.id);

    const ttlMs = clampTtl(req.ttlMs);
    const expiresAt = Date.now() + ttlMs;
    const session = this.store.createSession({
      groupId: scope[0].id,
      accessMode: 'command',
      approvedBy: 'ui',
      tmpDir: null,
      pid: null,
      commandSummary: null,
      expiresAt,
    });

    this.preauthorized.set(session.id, {
      sessionId: session.id,
      groupIds: new Set(selected),
      expiresAt,
      timer: setTimeout(() => {
        this.preauthorized.delete(session.id);
        this.closeRow(session.id, 'expired', null, auditDetail({ kind: 'preauthorization' }));
      }, ttlMs),
    });

    this.store.audit({
      event: 'session.requested',
      groupId: scope[0].id,
      sessionId: session.id,
      detail: auditDetail({ kind: 'preauthorization', groups: selected.length, ttlMs }),
    });

    return { sessionId: session.id, expiresAt };
  }

  /**
   * Start a UI-owned session that restores every selected managed file at its
   * original path. The renderer receives metadata only; decryption and all
   * filesystem writes stay in the main process.
   */
  startOriginalFileSession(req: CredentialUiSessionRequest): CredentialUiSessionGrant {
    if (req.mode !== 'original-files') {
      throw new CredError('bad-request', 'an original-file session requires original-files mode');
    }
    if (!getCrypto().isUnlocked()) {
      throw new CredError('locked', 'unlock Tiginal to start a credential session');
    }

    const scope = this.selectedScope(req.groupId, req.groupIds);
    const files = scope.flatMap(group => this.store.listFiles(group.id));
    if (files.length === 0) {
      throw new CredError('bad-request', 'the selected groups do not contain managed files');
    }

    this.assertOriginalFilesReady(files);
    // Validate the recovery root before any plaintext is reconstructed.
    const tmpRootDir = prepareTmpRoot();
    const realFiles = files.map(file => ({
      file,
      real: this.materializer.realContentFor(file.id, REVEAL),
    }));

    const ttlMs = clampTtl(req.ttlMs);
    const expiresAt = Date.now() + ttlMs;

    this.store.audit({
      event: 'session.requested',
      groupId: scope[0].id,
      detail: auditDetail({
        kind: 'original-files',
        groups: scope.length,
        files: files.length,
        ttlMs,
      }),
    });

    const session = this.store.createSession({
      groupId: scope[0].id,
      accessMode: 'command',
      approvedBy: UI_ORIGINAL_FILES_APPROVER,
      tmpDir: null,
      pid: null,
      commandSummary: null,
      expiresAt,
    });
    const record: LiveSession = {
      id: session.id,
      tmpDir: path.join(tmpRootDir, session.id),
      ephemeralFiles: [],
      swapped: [],
      timer: null,
      finished: false,
    };

    try {
      makePrivateDir(record.tmpDir);
      this.store.setSessionTmpDir(session.id, record.tmpDir);
      this.live.set(session.id, record);

      for (const { file, real } of realFiles) {
        this.swapIn(record, file.absolutePath, file.fileMode, real.content, expiresAt);
      }
      writeManifest(record, expiresAt);
      record.timer = setTimeout(() => this.finish(session.id, 'expired', null), ttlMs);

      this.store.audit({
        event: 'session.started',
        groupId: scope[0].id,
        sessionId: session.id,
        detail: auditDetail({
          kind: 'original-files',
          swapped: record.swapped.length,
          appended: realFiles.reduce((total, { real }) => total + real.appendedKeys.length, 0),
          ttlMs,
        }),
      });

      return { sessionId: session.id, expiresAt, mode: 'original-files' };
    } catch (error) {
      this.finish(session.id, 'revoked', null);
      throw error;
    }
  }

  /**
   * One managed file's real content, for the credential detail pane the user
   * has open. This is the only method that hands plaintext to the renderer, so
   * it needs the master key and records the reveal with a key count and no
   * value. It does not refuse during a live session the way the editing paths
   * do: that session has already put these same values on disk, so reading
   * them here exposes nothing further, and refusing would blank the pane
   * exactly when the user is most likely looking at it.
   */
  revealFileForUi(fileId: string): RevealedFileContent {
    if (!getCrypto().isUnlocked()) {
      throw new CredError('locked', 'unlock Tiginal to see a credential value');
    }

    const file = this.requireFile(fileId);

    const revealed = this.materializer.revealForRuntime(fileId, REVEAL);
    this.store.audit({
      event: 'file.revealed',
      groupId: file.groupId,
      detail: auditDetail({
        path: file.relativePath || path.basename(file.absolutePath),
        kind: file.kind,
        keys: revealed.length,
      }),
    });

    return REVEALED_CONTENT[file.kind](file, revealed);
  }

  /** Restore one file to its original contents, then discard its managed copy. */
  removeManagedFile(fileId: string): void {
    if (!getCrypto().isUnlocked()) {
      throw new CredError('locked', 'unlock Tiginal to stop managing a credential file');
    }

    const file = this.requireFile(fileId);
    this.assertPathIdle(file.absolutePath);
    this.materializer.restoreOriginal(file.id, REVEAL);
    this.store.deleteFile(file.id);
    this.store.audit({
      event: 'file.removed',
      groupId: file.groupId,
      detail: auditDetail({
        path: file.relativePath || path.basename(file.absolutePath),
        restored: 'true',
      }),
    });
  }

  /** Restore every file in a group subtree, then delete its stored credentials and groups. */
  deleteCredentialGroup(groupId: string): void {
    const group = this.store.getGroup(groupId);
    if (!group) throw new CredError('not-found', 'group does not exist');

    const groupPath = this.store.groupPathOf(groupId);
    const subtree = this.store.descendantsOf(groupId);
    const files = subtree.flatMap(item => this.store.listFiles(item.id));

    for (const file of files) this.assertPathIdle(file.absolutePath);
    for (const file of files) this.materializer.realContentFor(file.id, REVEAL);
    for (const file of files) this.removeManagedFile(file.id);

    this.store.deleteGroup(groupId);
    this.store.audit({
      event: 'group.deleted',
      detail: auditDetail({
        path: groupPath,
        groups: subtree.length,
        files: files.length,
        restored: 'true',
      }),
    });
  }

  /**
   * Add or edit one key in a declared ENV file. The file is re-masked before
   * this returns, so a new key lands on disk as its mask and never as the
   * value the user just typed.
   *
   * The file's new content comes back so the caller can tell a completed save
   * from a refused one. A channel resolving void made both look alike in the
   * renderer, which closed the dialog over a value the user then had to retype.
   */
  saveEnvEntry(edit: EnvEntryEdit): RevealedFileContent {
    const crypto = getCrypto();
    if (!crypto.isUnlocked()) {
      throw new CredError('locked', 'unlock Tiginal to edit a credential value');
    }

    const file = this.requireEnvFile(edit.fileId);
    this.assertPathIdle(file.absolutePath);

    const keyName = edit.keyName.trim();
    if (!isValidKeyName(file.format, keyName)) {
      throw new CredError('bad-request', `"${keyName}" is not a key name this file's format accepts`);
    }

    // Stored in the form the file has to carry, not the form the user typed: a bare value ending in a space, or carrying ` #`, parses back short, and the next mask cycle would store the truncated secret over the real one. Classification then runs on the stored form so its span covers the quotes the file will hold.
    const stored = storableValue(file.format, edit.value);
    if (stored === null) {
      throw new CredError('bad-request', 'that value cannot be written to this file format');
    }

    const classification = classifyEnvValue(keyName, stored);
    if (classification.spans.length === 0) {
      throw new CredError('bad-request', 'a value is required, and it cannot be a mask');
    }

    const previous = edit.previousKeyName?.trim() || null;
    const renamed = previous !== null && previous !== keyName;

    this.store.upsertEntry({
      fileId: file.id,
      keyName,
      secretType: classification.secretType,
      valueEncrypted: crypto.encrypt(stored),
      fakeValue: fakeValueFor(stored, classification, file.format),
    });
    if (renamed) {
      this.store.deleteEntryByKey(file.id, previous);
      this.materializer.removeKeyLine(file.id, previous);
    }
    this.materializer.materializeSafe(file.id, { force: true });

    this.store.audit({
      event: 'entry.saved',
      groupId: file.groupId,
      detail: auditDetail({
        path: file.relativePath || path.basename(file.absolutePath),
        key: keyName,
        renamed: String(renamed),
      }),
    });

    return this.revealFileForUi(file.id);
  }

  /**
   * Stop managing one key and take its line out of the file. Leaving
   * `KEY=********` behind would hand the user a mask their tools would read as
   * the value.
   */
  deleteEnvEntry(fileId: string, keyName: string): RevealedFileContent {
    if (!getCrypto().isUnlocked()) {
      throw new CredError('locked', 'unlock Tiginal to delete a credential value');
    }

    const file = this.requireEnvFile(fileId);
    this.assertPathIdle(file.absolutePath);

    const managed = this.store.listEntries(fileId).some(entry => entry.keyName === keyName);
    if (!managed) throw new CredError('not-found', 'that key is not managed in this file');

    this.store.deleteEntryByKey(fileId, keyName);
    this.materializer.removeKeyLine(fileId, keyName);
    this.materializer.materializeSafe(fileId, { force: true });

    this.store.audit({
      event: 'entry.deleted',
      groupId: file.groupId,
      detail: auditDetail({
        path: file.relativePath || path.basename(file.absolutePath),
        key: keyName,
      }),
    });

    return this.revealFileForUi(fileId);
  }

  /** The TTL a request would actually get, so an approval dialog can state it. */
  effectiveTtl(requested: number | undefined): number {
    return clampTtl(requested);
  }

  /**
   * What a session on this subtree would expose, as names and paths only. The
   * approval dialog and the UI's live-mode dialog both need this, and neither
   * may decrypt anything to get it.
   */
  exposurePreview(groupId: string): { env: string[]; files: string[] } {
    const env = new Set<string>();
    const files: string[] = [];

    for (const group of this.store.descendantsOf(groupId)) {
      const adapter = KIND_ADAPTERS[group.kind];

      for (const file of this.store.listFiles(group.id)) {
        const basename = path.basename(file.absolutePath);

        if (file.injection === 'env' || file.injection === 'both') {
          for (const entry of this.store.listEntries(file.id)) {
            env.add(entry.keyName);
            for (const alias of adapter.envAliases(entry.keyName)) env.add(alias);
          }
        }
        if (file.injection === 'file' || file.injection === 'both') {
          files.push(basename);
          env.add(`TIGINAL_CRED_FILE_${envToken(basename)}`);
          for (const name of Object.keys(adapter.fileEnv(basename, ''))) env.add(name);
        }
      }
    }

    return { env: [...env].sort(), files };
  }

  isPreauthorized(groupId: string): boolean {
    const now = Date.now();
    for (const preauth of this.preauthorized.values()) {
      if (preauth.expiresAt > now && preauth.groupIds.has(groupId)) return true;
    }
    return false;
  }

  /**
   * Layer 3. Any `active` row predates this process, so it is expired; any
   * directory under the temp root belongs to a session that is gone, so its
   * swapped files are restored and its contents are shredded.
   */
  sweepOrphans(): void {
    let dirs = 0;
    let restored = 0;
    let failures = 0;

    let names: string[] = [];
    try {
      names = fs.readdirSync(tmpRoot());
    } catch {
      names = [];
    }

    for (const name of names) {
      if (this.live.has(name)) continue;

      const dir = path.join(tmpRoot(), name);
      const manifest = readManifest(path.join(dir, MANIFEST_NAME));
      if (manifest) {
        const outcome = restoreSwapped(manifest.swapped);
        restored += outcome.restored;
        failures += outcome.failures;
        // A directory whose masked copies could not be written back is the
        // only recovery path left, so it survives for the next sweep.
        if (outcome.failures > 0) continue;
      }

      shredTree(dir);
      if (removeDir(dir)) dirs++;
    }

    // Database last, and guarded: restoring a swapped file is the part that
    // protects a secret, and it must not be lost to an unreadable database.
    try {
      const sessions = this.store.expireStaleSessions(Number.MAX_SAFE_INTEGER);
      this.store.audit({
        event: 'orphan.cleaned',
        detail: auditDetail({ sessions, dirs, restored, failures }),
      });
    } catch {
      // Nothing actionable remains.
    }
  }

  /**
   * Synchronous throughout, so it survives being called from an `exit`
   * handler: filesystem work first, database work last and guarded.
   */
  disposeAll(): void {
    for (const sessionId of [...this.live.keys()]) {
      this.finish(sessionId, 'revoked', null);
    }
    for (const [sessionId, preauth] of [...this.preauthorized]) {
      clearTimeout(preauth.timer);
      this.preauthorized.delete(sessionId);
      this.closeRow(sessionId, 'revoked', null, auditDetail({ kind: 'preauthorization' }));
    }
  }

  // --- internals ---

  private selectedScope(groupId: string, requestedGroupIds?: string[]): CredentialGroup[] {
    const subtree = this.store.descendantsOf(groupId);
    if (subtree.length === 0) throw new CredError('not-found', 'group does not exist');

    const available = new Set(subtree.map(group => group.id));
    const selected = new Set(requestedGroupIds?.length ? requestedGroupIds : available);
    selected.add(subtree[0].id);
    for (const selectedId of selected) {
      if (!available.has(selectedId)) {
        throw new CredError('bad-request', 'a selected group is outside the chosen subtree');
      }
    }
    return subtree.filter(group => selected.has(group.id));
  }

  private requireFile(fileId: string): CredentialFile {
    const file = this.store.getFile(fileId);
    if (!file) throw new CredError('not-found', 'managed file does not exist');
    return file;
  }

  private requireEnvFile(fileId: string): CredentialFile {
    const file = this.requireFile(fileId);
    if (file.kind !== 'env') {
      throw new CredError('bad-request', 'only a file added as ENV has editable entries');
    }
    return file;
  }

  /**
   * A path a live session has swapped holds real bytes right now, so writing
   * over it would lose the masked copy the teardown puts back.
   */
  private assertPathIdle(absolutePath: string): void {
    for (const session of this.live.values()) {
      if (session.swapped.some(record => record.path === absolutePath)) {
        throw new CredError('policy', 'a live session is using that file; end the session first');
      }
    }
  }

  private assertOriginalFilesReady(files: CredentialFile[]): void {
    const paths = new Set<string>();
    let filesWithoutSecrets = 0;
    const unavailable: string[] = [];

    for (const file of files) {
      if (paths.has(file.absolutePath)) {
        throw new CredError('policy', `the same file is managed more than once: ${file.absolutePath}`);
      }
      paths.add(file.absolutePath);

      if (this.store.listEntries(file.id).length === 0) filesWithoutSecrets++;
      const state = this.materializer.inspect(file.id).state;
      if (state.kind !== 'safe' && state.kind !== 'safe-edited') {
        unavailable.push(file.relativePath || path.basename(file.absolutePath));
      }
    }

    if (filesWithoutSecrets > 0) {
      throw new CredError(
        'bad-request',
        `${filesWithoutSecrets} managed file(s) have no stored secret; protect unrecognized files first`,
      );
    }
    if (unavailable.length > 0) {
      throw new CredError(
        'drift',
        `restore or import changes before starting the session: ${unavailable.join(', ')}`,
      );
    }

    for (const session of this.live.values()) {
      const occupied = session.swapped.find(record => paths.has(record.path));
      if (occupied) {
        throw new CredError('policy', `a live session is already using ${occupied.path}`);
      }
    }
  }

  /**
   * The one teardown route. A normal end, a revoke and a TTL expiry all land
   * here, and a second call for the same session is a no-op.
   */
  private finish(sessionId: string, status: SessionStatus, exitCode: number | null): void {
    const session = this.live.get(sessionId);
    if (!session || session.finished) {
      this.closeRow(sessionId, status, exitCode, auditDetail({ exitCode: exitCode ?? 'none' }));
      return;
    }

    session.finished = true;
    this.live.delete(sessionId);
    if (session.timer) {
      clearTimeout(session.timer);
      session.timer = null;
    }

    const outcome = restoreSwapped(session.swapped);
    for (const filePath of session.ephemeralFiles) shredFile(filePath);
    if (outcome.failures === 0 && outcome.suspect === 0) {
      shredTree(session.tmpDir);
      removeDir(session.tmpDir);
    }

    this.closeRow(
      sessionId,
      status,
      exitCode,
      auditDetail({
        exitCode: exitCode ?? 'none',
        files: session.ephemeralFiles.length,
        swapped: session.swapped.length,
        restoreFailures: outcome.failures,
        suspectRestores: outcome.suspect,
      }),
    );
  }

  /**
   * Database work is last and guarded in every teardown route: an `exit`
   * handler can run after the database is closed, and by then the secrets are
   * already gone from disk. The startup sweep reconciles the row.
   */
  private closeRow(
    sessionId: string,
    status: SessionStatus,
    exitCode: number | null,
    detail: string,
  ): void {
    try {
      const existing = this.store.getSession(sessionId);
      if (!existing || existing.status !== 'active') return;
      this.store.endSession(sessionId, status, exitCode);
      this.store.audit({
        event: AUDIT_FOR_STATUS[status],
        groupId: existing.groupId,
        sessionId,
        detail,
      });
    } catch {
      // Nothing actionable remains.
    }
  }

  private enforceCommandPolicy(group: CredentialGroup, command: string[]): void {
    const allowed = this.store.ancestryOf(group.id).flatMap(entry => entry.allowedCommands);
    if (allowed.length === 0) return;

    // Prefix matching on a whole word, so an `allowed: kamal` policy does not
    // also permit `kamalicious`.
    const joined = command.join(' ');
    const permitted = allowed.some(
      prefix => joined === prefix || joined.startsWith(prefix + ' '),
    );
    if (!permitted) {
      throw new CredError('policy', 'that command is not allowed for this group');
    }
  }

  /** Build the grant. The only method that holds plaintext. */
  private provision(
    scope: CredentialGroup[],
    session: LiveSession,
    expiresAt: number,
  ): SessionGrant {
    const env: Record<string, string> = {};
    const files: Array<{ path: string; label: string }> = [];
    const notes: string[] = [];
    let absentKeys = 0;
    let appendedKeys = 0;
    let ordinal = 0;

    for (const group of scope) {
      const adapter = KIND_ADAPTERS[group.kind];

      for (const file of this.store.listFiles(group.id)) {
        const wantsFile = file.injection === 'file' || file.injection === 'both';
        const real = wantsFile ? this.materializer.realContentFor(file.id, REVEAL) : null;
        if (real) {
          absentKeys += real.missingKeys.length;
          appendedKeys += real.appendedKeys.length;
        }

        if (file.injection === 'env' || file.injection === 'both') {
          for (const entry of this.materializer.revealForRuntime(file.id, REVEAL)) {
            const value = environmentValue(file.kind, entry.value);
            env[entry.key] = value;
            for (const alias of adapter.envAliases(entry.key)) {
              env[alias] = value;
            }
          }
        }

        if (wantsFile && real) {
          const basename = path.basename(file.absolutePath);
          // One subdirectory per file: two managed files can share a basename
          // (two projects' `.env`), and a tool that insists on an exact
          // filename still finds it.
          const holder = path.join(session.tmpDir, String(ordinal));
          makePrivateDir(holder);

          const ephemeral = path.join(holder, basename);
          fs.writeFileSync(ephemeral, real.content, { encoding: 'utf8', mode: 0o600 });
          fs.chmodSync(ephemeral, 0o600);

          session.ephemeralFiles.push(ephemeral);
          files.push({ path: ephemeral, label: file.relativePath || basename });

          // Predictable for the common one-file case; only a basename clash
          // between two groups falls back to the ordinal.
          const preferred = `TIGINAL_CRED_FILE_${envToken(basename)}`;
          env[preferred in env ? `${preferred}_${ordinal}` : preferred] = ephemeral;

          Object.assign(env, adapter.fileEnv(basename, ephemeral));
          ordinal++;
        }
      }
    }

    notes.unshift(
      `session expires at ${new Date(expiresAt).toISOString()}`,
      `env: ${Object.keys(env).length} variable(s): ${Object.keys(env).sort().join(', ') || 'none'}`,
    );
    for (const file of files) notes.push(`file: ${file.path}`);
    if (appendedKeys > 0) {
      notes.push(`${appendedKeys} managed key(s) were missing from their file and were written back`);
    }
    if (absentKeys > 0) {
      notes.push(`${absentKeys} managed key(s) are no longer present in their file`);
    }

    return { sessionId: session.id, expiresAt, env, tmpDir: session.tmpDir, files, notes };
  }

  /**
   * The only path that writes a real value to a managed file's own path. The
   * masked copy and the manifest entry are both durable before the real bytes
   * land, so a crash in between is recoverable by the startup sweep.
   */
  private swapIn(
    session: LiveSession,
    absolutePath: string,
    mode: number | null,
    realContent: string,
    expiresAt: number,
  ): void {
    const safeDir = path.join(session.tmpDir, SWAP_DIR_NAME);
    makePrivateDir(safeDir);

    const current = fs.readFileSync(absolutePath, 'utf8');
    const safePath = path.join(safeDir, `${session.swapped.length}.safe`);
    fs.writeFileSync(safePath, current, { encoding: 'utf8', mode: 0o600 });
    fs.chmodSync(safePath, 0o600);

    session.swapped.push({
      path: absolutePath,
      safePath,
      safeFingerprint: fingerprint(current),
      mode,
    });
    writeManifest(session, expiresAt);

    // Written straight over the path rather than through a sibling temp file:
    // the manifest must name every path that can hold real bytes, and a
    // sibling would be a second one the sweep knows nothing about.
    fs.writeFileSync(absolutePath, realContent, { encoding: 'utf8', mode: mode ?? 0o600 });
    if (mode !== null) fs.chmodSync(absolutePath, mode);
  }
}

let runtimeInstance: CredentialRuntime | null = null;

export function getCredentialRuntime(): CredentialRuntime {
  if (!runtimeInstance) {
    runtimeInstance = new CredentialRuntime();
    installProcessCleanup(runtimeInstance);
  }
  return runtimeInstance;
}

let cleanupInstalled = false;

/**
 * Layer 2. Each handler cleans up and then restores the default behaviour by
 * re-raising, so installing these does not change how the app terminates.
 */
function installProcessCleanup(runtime: CredentialRuntime): void {
  if (cleanupInstalled) return;
  cleanupInstalled = true;

  const nodeProcess: NodeJS.Process = process;

  nodeProcess.on('exit', () => {
    runtime.disposeAll();
  });

  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    const onSignal = () => {
      runtime.disposeAll();
      nodeProcess.kill(nodeProcess.pid, signal);
    };
    nodeProcess.once(signal, onSignal);
  }

  const onUncaught = (error: Error) => {
    runtime.disposeAll();
    throw error;
  };
  nodeProcess.once('uncaughtException', onUncaught);
}
