/**
 * Developer Credential Manager domain and protocol types.
 *
 * Pure declarations. Nothing here may import `electron`, `fs`, or
 * `better-sqlite3`: the Electron main process, the `tiginal cred` CLI, and the
 * renderer all compile against this file, and the CLI is a plain Node process.
 */

export type FileFormat = 'dotenv' | 'tfvars' | 'opaque';
export type GroupScope = 'project' | 'system';
export type GroupKind = 'generic' | 'rails' | 'kamal' | 'terraform' | 'ssh' | 'aws';

/**
 * What the user said a managed file is when they added it.
 *
 * `key` is a whole-file secret whose name comes from its basename, the shape a
 * Kamal key file has. `env` is `key=value` lines where every value to the
 * right of the first `=` is managed and every comment is left alone. `ssh-key`
 * is a private key, and its sibling `.pub` travels with it for display without
 * ever being encrypted or masked.
 *
 * A path cannot be trusted to say which of the three a file is, so the add
 * action records it and `format` only decides which parser reads the file.
 */
export type FileKind = 'key' | 'env' | 'ssh-key';

/** How a group's real values reach a child process during a live session. */
export type Injection = 'env' | 'file' | 'both';

export type SecretType =
  | 'password'
  | 'token'
  | 'api_key'
  | 'private_key'
  | 'url_password'
  | 'certificate'
  | 'generic';

/** One name/value pair located in a file, with the exact span of its value. */
export interface ParsedEntry {
  key: string;
  /** Quotes and surrounding whitespace already stripped. */
  value: string;
  /** Index of the first character of `value` in the file content. */
  valueStart: number;
  /** Index one past the last character of `value`. */
  valueEnd: number;
}

/** Where a secret sits inside a value. Offsets are relative to the value. */
export interface SecretSpan {
  start: number;
  end: number;
}

export interface Classification {
  secretType: SecretType;
  /** Empty means the entry is not a secret and must never be rewritten. */
  spans: SecretSpan[];
}

/** What is on disk for one managed file right now. */
export type FileState =
  | { kind: 'safe' }
  /** Secrets are still masked; other lines changed since we last wrote. */
  | { kind: 'safe-edited' }
  | { kind: 'drifted'; changedKeys: string[]; missingKeys: string[] }
  | { kind: 'missing' }
  /** Imported but never materialized, so no safe fingerprint exists yet. */
  | { kind: 'unmanaged' };

export type GroupStatus = 'safe' | 'drifted' | 'live' | 'unmanaged' | 'missing';

export type SessionStatus = 'active' | 'completed' | 'expired' | 'revoked';
export type AccessMode = 'command' | 'shell';
export type CredentialUiSessionMode = 'original-files' | 'cli-authorization';

export interface CredentialUiSessionRequest {
  groupId: string;
  ttlMs?: number;
  /** Descendants selected in the authorization dialog. The root is always included. */
  groupIds: string[];
  mode: CredentialUiSessionMode;
}

/** Metadata only. Secret values never cross the IPC boundary into the renderer. */
export interface CredentialUiSessionGrant {
  sessionId: string;
  expiresAt: number;
  mode: CredentialUiSessionMode;
}

export type AuditEvent =
  | 'group.created'
  | 'group.deleted'
  | 'file.imported'
  | 'file.removed'
  | 'safe.materialized'
  | 'safe.restored'
  | 'drift.detected'
  | 'drift.imported'
  | 'file.revealed'
  | 'entry.saved'
  | 'entry.deleted'
  | 'session.requested'
  | 'session.denied'
  | 'session.started'
  | 'session.ended'
  | 'session.expired'
  | 'session.revoked'
  | 'orphan.cleaned';

export interface CredentialGroup {
  id: string;
  parentId: string | null;
  slug: string;
  name: string;
  scope: GroupScope;
  kind: GroupKind;
  rootPath: string | null;
  allowedCommands: string[];
  rank: number;
  createdAt: number;
  updatedAt: number;
}

export interface CredentialFile {
  id: string;
  groupId: string;
  kind: FileKind;
  absolutePath: string;
  relativePath: string;
  format: FileFormat;
  injection: Injection;
  safeFingerprint: string | null;
  fileMode: number | null;
  /** An `ssh-key` file's sibling public key. Displayed, never managed. */
  publicKeyPath: string | null;
  createdAt: number;
  updatedAt: number;
}

/** An entry as the renderer may see it. Carries no value, real or fake. */
export interface MaskedEntry {
  id: string;
  keyName: string;
  secretType: SecretType;
}

export interface CredentialSession {
  id: string;
  groupId: string;
  status: SessionStatus;
  accessMode: AccessMode;
  approvedBy: string | null;
  tmpDir: string | null;
  pid: number | null;
  /** argv[0] plus an argument count. Never the argument values. */
  commandSummary: string | null;
  exitCode: number | null;
  createdAt: number;
  expiresAt: number;
  endedAt: number | null;
}

export interface AuditRecord {
  id: number;
  at: number;
  groupId: string | null;
  sessionId: string | null;
  event: AuditEvent;
  /** Metadata only: names, counts, outcomes. Never a secret value. */
  detail: string;
}

export const DEFAULT_TTL_MS = 15 * 60 * 1000;
export const MIN_TTL_MS = 60 * 1000;
export const MAX_TTL_MS = 60 * 60 * 1000;

export type CredErrorCode =
  | 'locked'
  | 'not-found'
  | 'denied'
  | 'policy'
  | 'expired'
  | 'drift'
  | 'bad-request'
  | 'internal';

export type CredRequest =
  | { op: 'ping' }
  | { op: 'list' }
  | { op: 'status'; group: string }
  | { op: 'safe'; group: string }
  | {
      op: 'session.begin';
      group: string;
      ttlMs?: number;
      command: string[];
      accessMode: AccessMode;
      autoApprove?: boolean;
      cwd?: string;
    }
  | { op: 'session.end'; sessionId: string; exitCode: number | null }
  | { op: 'session.revoke'; sessionId: string };

export type CredResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; code: CredErrorCode; error: string };

/** A `list` row. Masked throughout, so it is safe to print. */
export interface GroupSummary {
  id: string;
  /** Slash-joined slug chain, e.g. `acme-app/kamal`. */
  path: string;
  name: string;
  scope: GroupScope;
  kind: GroupKind;
  /** Null for a `system`-scope group, which is not rooted anywhere. */
  rootPath: string | null;
  depth: number;
  status: GroupStatus;
  fileCount: number;
  secretCount: number;
  liveExpiresAt: number | null;
}

/** A `status` row: one group plus the state of each of its files. */
export interface GroupStatusReport {
  group: GroupSummary;
  files: Array<{
    id: string;
    kind: FileKind;
    relativePath: string;
    absolutePath: string;
    format: FileFormat;
    publicKeyPath: string | null;
    state: FileState;
    entries: MaskedEntry[];
  }>;
  activeSession: CredentialSession | null;
}

/** A file leaf in the renderer's physical filesystem tree. */
export interface CredentialFileLocation {
  /** The managed file's id. A `public-key` row shares its private key's id. */
  id: string;
  groupId: string;
  groupPath: string;
  kind: FileKind;
  /** A `public-key` row is display-only: selecting it opens the private key. */
  role: 'managed' | 'public-key';
  absolutePath: string;
  /** Forward-slash path consumed by @pierre/trees. */
  treePath: string;
  state: FileState;
}

/** One managed key with its real value, for the credential detail pane only. */
export interface RevealedEnvEntry {
  keyName: string;
  secretType: SecretType;
  /** Exactly the bytes stored for this key, quotes included when it had them. */
  value: string;
  /** False when Tiginal holds the key but the file on disk no longer does. */
  onDisk: boolean;
}

/**
 * One managed file's real content, shaped by the kind the user declared.
 *
 * This is the one payload that carries plaintext into the renderer, and it is
 * built only when the user opens a file in the credential detail pane. Every
 * other renderer-facing shape in this file is masked.
 */
export type RevealedFileContent =
  | { kind: 'key'; text: string }
  | { kind: 'ssh-key'; text: string; publicKeyText: string | null }
  | { kind: 'env'; entries: RevealedEnvEntry[] };

/** An add or edit from the ENV table. `previousKeyName` is null when adding. */
export interface EnvEntryEdit {
  fileId: string;
  previousKeyName: string | null;
  keyName: string;
  value: string;
}

/**
 * A `session.begin` payload. This is the one shape in the system that carries
 * plaintext, and it crosses only the local socket to the CLI that will put the
 * values into a child process. The CLI must never print `env`'s values.
 */
export interface SessionGrant {
  sessionId: string;
  expiresAt: number;
  env: Record<string, string>;
  tmpDir: string;
  files: Array<{ path: string; label: string }>;
  /** Lines the CLI may print: names, paths, and counts only. */
  notes: string[];
}
