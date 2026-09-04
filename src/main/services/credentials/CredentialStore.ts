/**
 * SQLite access for the Developer Credential Manager (migration v27).
 *
 * Thin and synchronous. Rows are snake_case; every method converts to the
 * camelCase domain types from `src/shared/credentials/types.ts` at the
 * boundary, so nothing above this file sees a row shape.
 *
 * `PRAGMA foreign_keys` is off in this database, so `ON DELETE CASCADE` in the
 * schema does nothing. Every delete removes its children explicitly inside a
 * transaction.
 */

import { randomUUID } from 'crypto';
import { getDatabase } from '../../../services/database/database';
import {
  joinGroupPath,
  splitGroupPath,
  isValidSlug,
} from '../../../shared/credentials/group-path';
import type {
  AuditEvent,
  AuditRecord,
  CredentialFile,
  CredentialGroup,
  CredentialSession,
  CredErrorCode,
  FileFormat,
  GroupKind,
  GroupScope,
  Injection,
  SecretType,
  SessionStatus,
  AccessMode,
} from '../../../shared/credentials/types';

/**
 * The one error type the credential layer throws on purpose. Its message is
 * authored here and carries names and counts only, so the socket and the
 * ipcMain handlers can forward it verbatim; anything else they catch becomes
 * `'internal error'` (invariant 4).
 */
export class CredError extends Error {
  constructor(
    readonly code: CredErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CredError';
  }
}

/** Forward an authored message, or hide an unknown one. */
export function safeMessage(error: unknown): string {
  return error instanceof CredError ? error.message : 'internal error';
}

export function errorCode(error: unknown): CredErrorCode {
  return error instanceof CredError ? error.code : 'internal';
}

/**
 * Build an audit `detail` string. Every call site passes names, counts, and
 * outcomes; routing them through one formatter keeps that rule visible at the
 * call site instead of relying on each template literal being reviewed.
 */
export function auditDetail(fields: Record<string, string | number>): string {
  return Object.entries(fields)
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');
}

export interface CreateGroupInput {
  parentId: string | null;
  slug: string;
  name: string;
  scope: GroupScope;
  kind: GroupKind;
  rootPath: string | null;
  allowedCommands: string[];
  rank?: number;
}

export type UpdateGroupPatch = Partial<{
  parentId: string | null;
  slug: string;
  name: string;
  scope: GroupScope;
  kind: GroupKind;
  rootPath: string | null;
  allowedCommands: string[];
  rank: number;
}>;

export interface CreateFileInput {
  groupId: string;
  absolutePath: string;
  relativePath: string;
  format: FileFormat;
  injection: Injection;
  fileMode: number | null;
  swapDuringSession?: boolean;
}

export type UpdateFilePatch = Partial<{
  groupId: string;
  relativePath: string;
  format: FileFormat;
  injection: Injection;
  safeFingerprint: string | null;
  fileMode: number | null;
  swapDuringSession: boolean;
}>;

/** An entry row. `valueEncrypted` is ciphertext and never leaves this layer. */
export interface CredentialEntryRow {
  id: string;
  fileId: string;
  keyName: string;
  secretType: SecretType;
  valueEncrypted: string;
  fakeValue: string;
}

export interface UpsertEntryInput {
  fileId: string;
  keyName: string;
  secretType: SecretType;
  valueEncrypted: string;
  fakeValue: string;
}

export interface CreateSessionInput {
  groupId: string;
  accessMode: AccessMode;
  approvedBy: string | null;
  tmpDir: string | null;
  pid: number | null;
  commandSummary: string | null;
  expiresAt: number;
}

export interface AuditInput {
  event: AuditEvent;
  groupId?: string | null;
  sessionId?: string | null;
  detail?: string;
}

type SqlValue = string | number | null;

/** Patch key to column plus its row encoding. One table per SQL table. */
interface ColumnBinding {
  column: string;
  encode: (value: unknown) => SqlValue;
}

const GROUP_PATCH_COLUMNS: Record<keyof UpdateGroupPatch, ColumnBinding> = {
  parentId: { column: 'parent_id', encode: value => (value as string | null) ?? '' },
  slug: { column: 'slug', encode: value => value as string },
  name: { column: 'name', encode: value => value as string },
  scope: { column: 'scope', encode: value => value as string },
  kind: { column: 'kind', encode: value => value as string },
  rootPath: { column: 'root_path', encode: value => value as string | null },
  allowedCommands: {
    column: 'allowed_commands',
    encode: value => JSON.stringify(value as string[]),
  },
  rank: { column: 'rank', encode: value => value as number },
};

const FILE_PATCH_COLUMNS: Record<keyof UpdateFilePatch, ColumnBinding> = {
  groupId: { column: 'group_id', encode: value => value as string },
  relativePath: { column: 'relative_path', encode: value => value as string },
  format: { column: 'format', encode: value => value as string },
  injection: { column: 'injection', encode: value => value as string },
  safeFingerprint: { column: 'safe_fingerprint', encode: value => value as string | null },
  fileMode: { column: 'file_mode', encode: value => value as number | null },
  swapDuringSession: {
    column: 'swap_during_session',
    encode: value => ((value as boolean) ? 1 : 0),
  },
};

/** A group chain deeper than this is a cycle, not a real tree. */
const MAX_GROUP_DEPTH = 16;

interface GroupRow {
  id: string;
  parent_id: string;
  slug: string;
  name: string;
  scope: string;
  kind: string;
  root_path: string | null;
  allowed_commands: string;
  rank: number;
  created_at: number;
  updated_at: number;
}

interface FileRow {
  id: string;
  group_id: string;
  absolute_path: string;
  relative_path: string;
  format: string;
  injection: string;
  safe_fingerprint: string | null;
  file_mode: number | null;
  swap_during_session: number;
  created_at: number;
  updated_at: number;
}

interface EntryRow {
  id: string;
  file_id: string;
  key_name: string;
  secret_type: string;
  value_encrypted: string;
  fake_value: string;
}

interface SessionRow {
  id: string;
  group_id: string;
  status: string;
  access_mode: string;
  approved_by: string | null;
  tmp_dir: string | null;
  pid: number | null;
  command_summary: string | null;
  exit_code: number | null;
  created_at: number;
  expires_at: number;
  ended_at: number | null;
}

interface AuditRow {
  id: number;
  at: number;
  group_id: string | null;
  session_id: string | null;
  event: string;
  detail: string;
}

function toGroup(row: GroupRow): CredentialGroup {
  let allowedCommands: string[] = [];
  try {
    const parsed: unknown = JSON.parse(row.allowed_commands);
    if (Array.isArray(parsed)) {
      allowedCommands = parsed.filter((item): item is string => typeof item === 'string');
    }
  } catch {
    // A hand-edited row must not take the whole tree down; no policy is the
    // safe reading only because an empty list still denies nothing that the
    // approval dialog would have allowed.
    allowedCommands = [];
  }

  return {
    id: row.id,
    parentId: row.parent_id === '' ? null : row.parent_id,
    slug: row.slug,
    name: row.name,
    scope: row.scope as GroupScope,
    kind: row.kind as GroupKind,
    rootPath: row.root_path,
    allowedCommands,
    rank: row.rank,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toFile(row: FileRow): CredentialFile {
  return {
    id: row.id,
    groupId: row.group_id,
    absolutePath: row.absolute_path,
    relativePath: row.relative_path,
    format: row.format as FileFormat,
    injection: row.injection as Injection,
    safeFingerprint: row.safe_fingerprint,
    fileMode: row.file_mode,
    swapDuringSession: row.swap_during_session === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toEntry(row: EntryRow): CredentialEntryRow {
  return {
    id: row.id,
    fileId: row.file_id,
    keyName: row.key_name,
    secretType: row.secret_type as SecretType,
    valueEncrypted: row.value_encrypted,
    fakeValue: row.fake_value,
  };
}

function toSession(row: SessionRow): CredentialSession {
  return {
    id: row.id,
    groupId: row.group_id,
    status: row.status as SessionStatus,
    accessMode: row.access_mode as AccessMode,
    approvedBy: row.approved_by,
    tmpDir: row.tmp_dir,
    pid: row.pid,
    commandSummary: row.command_summary,
    exitCode: row.exit_code,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    endedAt: row.ended_at,
  };
}

function toAudit(row: AuditRow): AuditRecord {
  return {
    id: row.id,
    at: row.at,
    groupId: row.group_id,
    sessionId: row.session_id,
    event: row.event as AuditEvent,
    detail: row.detail,
  };
}

export class CredentialStore {
  private get db() {
    return getDatabase().getDb();
  }

  // --- groups ---

  listGroups(): CredentialGroup[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM credential_groups ORDER BY parent_id, rank, name COLLATE NOCASE`,
      )
      .all() as GroupRow[];
    return rows.map(toGroup);
  }

  getGroup(id: string): CredentialGroup | null {
    const row = this.db
      .prepare('SELECT * FROM credential_groups WHERE id = ?')
      .get(id) as GroupRow | undefined;
    return row ? toGroup(row) : null;
  }

  /** Resolve a CLI-style path such as `acme-app/kamal`. */
  getGroupByPath(groupPath: string): CredentialGroup | null {
    const slugs = splitGroupPath(groupPath);
    if (slugs.length === 0) return null;

    const select = this.db.prepare(
      'SELECT * FROM credential_groups WHERE parent_id = ? AND slug = ?',
    );

    let parentId = '';
    let found: CredentialGroup | null = null;
    for (const slug of slugs) {
      const row = select.get(parentId, slug) as GroupRow | undefined;
      if (!row) return null;
      found = toGroup(row);
      parentId = row.id;
    }
    return found;
  }

  createGroup(input: CreateGroupInput): CredentialGroup {
    if (!isValidSlug(input.slug)) {
      throw new CredError('bad-request', 'group slug must be kebab-case with no separators');
    }
    if (input.parentId && !this.getGroup(input.parentId)) {
      throw new CredError('not-found', 'parent group does not exist');
    }

    const id = randomUUID();
    const now = Date.now();
    const parentId = input.parentId ?? '';
    const rank = input.rank ?? this.nextRank(parentId);

    this.db
      .prepare(
        `INSERT INTO credential_groups
           (id, parent_id, slug, name, scope, kind, root_path, allowed_commands, rank, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        parentId,
        input.slug,
        input.name,
        input.scope,
        input.kind,
        input.rootPath,
        JSON.stringify(input.allowedCommands),
        rank,
        now,
        now,
      );

    const created = this.getGroup(id);
    if (!created) throw new CredError('internal', 'group insert did not persist');
    return created;
  }

  updateGroup(id: string, patch: UpdateGroupPatch): void {
    if (patch.slug !== undefined && !isValidSlug(patch.slug)) {
      throw new CredError('bad-request', 'group slug must be kebab-case with no separators');
    }
    if (patch.parentId !== undefined && patch.parentId !== null) {
      if (patch.parentId === id) {
        throw new CredError('bad-request', 'a group cannot be its own parent');
      }
      for (const descendant of this.descendantsOf(id)) {
        if (descendant.id === patch.parentId) {
          throw new CredError('bad-request', 'a group cannot be moved under its own descendant');
        }
      }
    }
    this.applyPatch('credential_groups', GROUP_PATCH_COLUMNS, id, patch);
  }

  deleteGroup(id: string): void {
    const targets = this.descendantsOf(id).map(group => group.id);
    if (targets.length === 0) return;

    const deleteEntries = this.db.prepare(
      'DELETE FROM credential_entries WHERE file_id IN (SELECT id FROM credential_files WHERE group_id = ?)',
    );
    const deleteFiles = this.db.prepare('DELETE FROM credential_files WHERE group_id = ?');
    const deleteGroup = this.db.prepare('DELETE FROM credential_groups WHERE id = ?');

    this.db.transaction(() => {
      for (const groupId of targets.slice().reverse()) {
        deleteEntries.run(groupId);
        deleteFiles.run(groupId);
        deleteGroup.run(groupId);
      }
    })();
  }

  /** Slash-joined slug chain from the root down to `id`. */
  groupPathOf(id: string): string {
    const slugs: string[] = [];
    let cursor = this.getGroup(id);
    let depth = 0;

    while (cursor) {
      if (++depth > MAX_GROUP_DEPTH) {
        throw new CredError('internal', 'group hierarchy exceeds the maximum depth');
      }
      slugs.unshift(cursor.slug);
      cursor = cursor.parentId ? this.getGroup(cursor.parentId) : null;
    }

    return joinGroupPath(slugs);
  }

  childrenOf(id: string | null): CredentialGroup[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM credential_groups WHERE parent_id = ? ORDER BY rank, name COLLATE NOCASE',
      )
      .all(id ?? '') as GroupRow[];
    return rows.map(toGroup);
  }

  /** `id` first, then every descendant breadth-first. Empty when `id` is gone. */
  descendantsOf(id: string): CredentialGroup[] {
    const root = this.getGroup(id);
    if (!root) return [];

    const collected: CredentialGroup[] = [root];
    const seen = new Set<string>([root.id]);
    for (let cursor = 0; cursor < collected.length; cursor++) {
      if (cursor >= MAX_GROUP_DEPTH * MAX_GROUP_DEPTH) {
        throw new CredError('internal', 'group hierarchy exceeds the maximum size');
      }
      for (const child of this.childrenOf(collected[cursor].id)) {
        if (seen.has(child.id)) continue;
        seen.add(child.id);
        collected.push(child);
      }
    }
    return collected;
  }

  /** The chain from `id` up to its root, `id` first. */
  ancestryOf(id: string): CredentialGroup[] {
    const chain: CredentialGroup[] = [];
    let cursor = this.getGroup(id);
    let depth = 0;

    while (cursor) {
      if (++depth > MAX_GROUP_DEPTH) {
        throw new CredError('internal', 'group hierarchy exceeds the maximum depth');
      }
      chain.push(cursor);
      cursor = cursor.parentId ? this.getGroup(cursor.parentId) : null;
    }
    return chain;
  }

  // --- files ---

  listFiles(groupId: string): CredentialFile[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM credential_files WHERE group_id = ? ORDER BY relative_path, absolute_path',
      )
      .all(groupId) as FileRow[];
    return rows.map(toFile);
  }

  getFile(id: string): CredentialFile | null {
    const row = this.db
      .prepare('SELECT * FROM credential_files WHERE id = ?')
      .get(id) as FileRow | undefined;
    return row ? toFile(row) : null;
  }

  getFileByPath(absolutePath: string): CredentialFile | null {
    const row = this.db
      .prepare('SELECT * FROM credential_files WHERE absolute_path = ?')
      .get(absolutePath) as FileRow | undefined;
    return row ? toFile(row) : null;
  }

  createFile(input: CreateFileInput): CredentialFile {
    if (!this.getGroup(input.groupId)) {
      throw new CredError('not-found', 'group does not exist');
    }

    const id = randomUUID();
    const now = Date.now();

    this.db
      .prepare(
        `INSERT INTO credential_files
           (id, group_id, absolute_path, relative_path, format, injection,
            safe_fingerprint, file_mode, swap_during_session, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.groupId,
        input.absolutePath,
        input.relativePath,
        input.format,
        input.injection,
        input.fileMode,
        input.swapDuringSession ? 1 : 0,
        now,
        now,
      );

    const created = this.getFile(id);
    if (!created) throw new CredError('internal', 'file insert did not persist');
    return created;
  }

  updateFile(id: string, patch: UpdateFilePatch): void {
    this.applyPatch('credential_files', FILE_PATCH_COLUMNS, id, patch);
  }

  deleteFile(id: string): void {
    const deleteEntries = this.db.prepare('DELETE FROM credential_entries WHERE file_id = ?');
    const deleteFile = this.db.prepare('DELETE FROM credential_files WHERE id = ?');
    this.db.transaction(() => {
      deleteEntries.run(id);
      deleteFile.run(id);
    })();
  }

  // --- entries ---

  listEntries(fileId: string): CredentialEntryRow[] {
    const rows = this.db
      .prepare('SELECT * FROM credential_entries WHERE file_id = ? ORDER BY key_name')
      .all(fileId) as EntryRow[];
    return rows.map(toEntry);
  }

  upsertEntry(input: UpsertEntryInput): string {
    const now = Date.now();
    const existing = this.db
      .prepare('SELECT id FROM credential_entries WHERE file_id = ? AND key_name = ?')
      .get(input.fileId, input.keyName) as { id: string } | undefined;

    if (existing) {
      this.db
        .prepare(
          `UPDATE credential_entries
             SET secret_type = ?, value_encrypted = ?, fake_value = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(input.secretType, input.valueEncrypted, input.fakeValue, now, existing.id);
      return existing.id;
    }

    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO credential_entries
           (id, file_id, key_name, secret_type, value_encrypted, fake_value, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.fileId,
        input.keyName,
        input.secretType,
        input.valueEncrypted,
        input.fakeValue,
        now,
        now,
      );
    return id;
  }

  deleteEntry(id: string): void {
    this.db.prepare('DELETE FROM credential_entries WHERE id = ?').run(id);
  }

  // --- sessions ---

  createSession(input: CreateSessionInput): CredentialSession {
    const id = randomUUID();
    const now = Date.now();

    this.db
      .prepare(
        `INSERT INTO credential_sessions
           (id, group_id, status, access_mode, approved_by, tmp_dir, pid,
            command_summary, exit_code, created_at, expires_at, ended_at)
         VALUES (?, ?, 'active', ?, ?, ?, ?, ?, NULL, ?, ?, NULL)`,
      )
      .run(
        id,
        input.groupId,
        input.accessMode,
        input.approvedBy,
        input.tmpDir,
        input.pid,
        input.commandSummary,
        now,
        input.expiresAt,
      );

    const created = this.getSession(id);
    if (!created) throw new CredError('internal', 'session insert did not persist');
    return created;
  }

  getSession(id: string): CredentialSession | null {
    const row = this.db
      .prepare('SELECT * FROM credential_sessions WHERE id = ?')
      .get(id) as SessionRow | undefined;
    return row ? toSession(row) : null;
  }

  /**
   * A session's temp directory is named after its own id, so it cannot be
   * known until the row exists.
   */
  setSessionTmpDir(id: string, tmpDir: string): void {
    this.db.prepare('UPDATE credential_sessions SET tmp_dir = ? WHERE id = ?').run(tmpDir, id);
  }

  activeSessionFor(groupId: string): CredentialSession | null {
    const row = this.db
      .prepare(
        `SELECT * FROM credential_sessions
         WHERE group_id = ? AND status = 'active' AND expires_at > ?
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(groupId, Date.now()) as SessionRow | undefined;
    return row ? toSession(row) : null;
  }

  endSession(id: string, status: SessionStatus, exitCode: number | null): void {
    this.db
      .prepare(
        `UPDATE credential_sessions
           SET status = ?, exit_code = ?, ended_at = ?
         WHERE id = ? AND status = 'active'`,
      )
      .run(status, exitCode, Date.now(), id);
  }

  /**
   * Mark active sessions expired. Pass `Number.MAX_SAFE_INTEGER` from the
   * startup sweep: no row that predates this process is owned by it, so an
   * `active` row surviving a crash is expired regardless of its `expires_at`.
   */
  expireStaleSessions(asOf: number): number {
    const result = this.db
      .prepare(
        `UPDATE credential_sessions
           SET status = 'expired', ended_at = ?
         WHERE status = 'active' AND expires_at <= ?`,
      )
      .run(Date.now(), asOf);
    return result.changes;
  }

  listSessions(groupId: string | null, limit: number): CredentialSession[] {
    const capped = Math.max(1, Math.min(limit, 500));
    const rows = groupId
      ? (this.db
          .prepare(
            'SELECT * FROM credential_sessions WHERE group_id = ? ORDER BY created_at DESC LIMIT ?',
          )
          .all(groupId, capped) as SessionRow[])
      : (this.db
          .prepare('SELECT * FROM credential_sessions ORDER BY created_at DESC LIMIT ?')
          .all(capped) as SessionRow[]);
    return rows.map(toSession);
  }

  /** Every `active` row, whatever its expiry. Used by the startup sweep. */
  listActiveSessions(): CredentialSession[] {
    const rows = this.db
      .prepare(`SELECT * FROM credential_sessions WHERE status = 'active'`)
      .all() as SessionRow[];
    return rows.map(toSession);
  }

  // --- audit ---

  audit(input: AuditInput): void {
    this.db
      .prepare(
        'INSERT INTO credential_audit (at, group_id, session_id, event, detail) VALUES (?, ?, ?, ?, ?)',
      )
      .run(
        Date.now(),
        input.groupId ?? null,
        input.sessionId ?? null,
        input.event,
        input.detail ?? '',
      );
  }

  listAudit(limit: number): AuditRecord[] {
    const capped = Math.max(1, Math.min(limit, 1000));
    const rows = this.db
      .prepare('SELECT * FROM credential_audit ORDER BY at DESC, id DESC LIMIT ?')
      .all(capped) as AuditRow[];
    return rows.map(toAudit);
  }

  // --- internals ---

  private nextRank(parentId: string): number {
    const row = this.db
      .prepare('SELECT MAX(rank) AS top FROM credential_groups WHERE parent_id = ?')
      .get(parentId) as { top: number | null } | undefined;
    return (row?.top ?? -1) + 1;
  }

  private applyPatch(
    table: string,
    bindings: Record<string, ColumnBinding>,
    id: string,
    patch: Record<string, unknown>,
  ): void {
    const assignments: string[] = [];
    const values: SqlValue[] = [];

    for (const [key, binding] of Object.entries(bindings)) {
      if (!(key in patch)) continue;
      assignments.push(`${binding.column} = ?`);
      values.push(binding.encode(patch[key]));
    }
    if (assignments.length === 0) return;

    assignments.push('updated_at = ?');
    values.push(Date.now(), id);

    this.db.prepare(`UPDATE ${table} SET ${assignments.join(', ')} WHERE id = ?`).run(...values);
  }
}

let storeInstance: CredentialStore | null = null;

export function getCredentialStore(): CredentialStore {
  if (!storeInstance) {
    storeInstance = new CredentialStore();
  }
  return storeInstance;
}
