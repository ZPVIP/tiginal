/**
 * ipcMain handlers for the Developer Credential Manager settings UI.
 *
 * Exactly one channel here carries plaintext: `credentials:reveal-file`, which
 * the credential detail pane calls for the file the user has open. It is
 * user-initiated, it needs the master key unlocked, and `CredentialRuntime`
 * records every reveal in the audit trail with a key count and no value. Every
 * other channel returns masked shapes only: names, counts, paths and states.
 *
 * This module holds no decrypting capability of its own. The plaintext work
 * lives on `CredentialRuntime`, which is the one holder of the reveal
 * capability that `Materializer`'s decrypting methods demand, so a channel
 * that reached for a value any other way would not compile.
 *
 * The renderer can also open a CLI approval window or start a main-process
 * session that temporarily restores values at their original file paths.
 * Neither of those returns plaintext over IPC.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ipcMain, dialog } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { IS_WINDOWS } from './utils/paths';
import { slugify } from '../shared/credentials/group-path';
import type {
  CredentialUiSessionMode,
  CredentialUiSessionRequest,
  EnvEntryEdit,
  FileKind,
  GroupKind,
  GroupScope,
} from '../shared/credentials/types';
import {
  auditDetail,
  CredError,
  errorCode,
  getCredentialStore,
  safeMessage,
} from './services/credentials/CredentialStore';
import { getMaterializer } from './services/credentials/Materializer';
import { getCredentialRuntime } from './services/credentials/CredentialRuntime';
import {
  credentialSocketPath,
  getCredentialSocket,
  startCredentialSocket,
} from './services/credentials/CredentialSocket';

/**
 * Membership tables rather than literal arrays: adding a member to one of
 * these unions in `shared/credentials/types.ts` fails to compile until the
 * validator below knows about it.
 */
const GROUP_SCOPES: Record<GroupScope, true> = { project: true, system: true };
const GROUP_KINDS: Record<GroupKind, true> = {
  generic: true,
  rails: true,
  kamal: true,
  terraform: true,
  ssh: true,
  aws: true,
};
const FILE_KINDS: Record<FileKind, true> = { key: true, env: true, 'ssh-key': true };
const UI_SESSION_MODES: Record<CredentialUiSessionMode, true> = {
  'original-files': true,
  'cli-authorization': true,
};

function isMember<T extends string>(table: Record<T, true>, value: unknown): value is T {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(table, value);
}

export interface CreateGroupRequest {
  parentId?: string | null;
  name: string;
  slug?: string;
  scope?: GroupScope;
  kind?: GroupKind;
  rootPath?: string | null;
  allowedCommands?: string[];
}

export interface UpdateGroupRequest {
  name?: string;
  slug?: string;
  scope?: GroupScope;
  kind?: GroupKind;
  rootPath?: string | null;
  allowedCommands?: string[];
  parentId?: string | null;
  rank?: number;
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new CredError('bad-request', `"${field}" is required`);
  }
  return value.trim();
}

function requireId(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new CredError('bad-request', `"${field}" is required`);
  }
  return value;
}

function optionalCommands(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new CredError('bad-request', '"allowedCommands" must be an array of strings');
  }
  return (value as string[]).map(item => item.trim()).filter(item => item.length > 0);
}

function parseCreateGroup(input: unknown): CreateGroupRequest {
  if (!input || typeof input !== 'object') {
    throw new CredError('bad-request', 'a group description is required');
  }
  const record = input as Record<string, unknown>;
  const name = requireText(record.name, 'name');

  if (record.scope !== undefined && !isMember(GROUP_SCOPES, record.scope)) {
    throw new CredError('bad-request', '"scope" is not a known group scope');
  }
  if (record.kind !== undefined && !isMember(GROUP_KINDS, record.kind)) {
    throw new CredError('bad-request', '"kind" is not a known group kind');
  }

  return {
    parentId: typeof record.parentId === 'string' && record.parentId ? record.parentId : null,
    name,
    slug: typeof record.slug === 'string' && record.slug ? record.slug : slugify(name),
    scope: record.scope,
    kind: record.kind,
    rootPath: typeof record.rootPath === 'string' && record.rootPath ? record.rootPath : null,
    allowedCommands: optionalCommands(record.allowedCommands),
  };
}

function parseUpdateGroup(input: unknown): UpdateGroupRequest {
  if (!input || typeof input !== 'object') {
    throw new CredError('bad-request', 'a patch is required');
  }
  const record = input as Record<string, unknown>;
  const patch: UpdateGroupRequest = {};

  if (record.name !== undefined) patch.name = requireText(record.name, 'name');
  if (record.slug !== undefined) patch.slug = requireText(record.slug, 'slug');
  if (record.parentId !== undefined) {
    patch.parentId = typeof record.parentId === 'string' && record.parentId ? record.parentId : null;
  }
  if (record.rootPath !== undefined) {
    patch.rootPath = typeof record.rootPath === 'string' && record.rootPath ? record.rootPath : null;
  }
  if (record.rank !== undefined) {
    if (typeof record.rank !== 'number' || !Number.isFinite(record.rank)) {
      throw new CredError('bad-request', '"rank" must be a number');
    }
    patch.rank = Math.trunc(record.rank);
  }
  if (record.scope !== undefined) {
    if (!isMember(GROUP_SCOPES, record.scope)) {
      throw new CredError('bad-request', '"scope" is not a known group scope');
    }
    patch.scope = record.scope;
  }
  if (record.kind !== undefined) {
    if (!isMember(GROUP_KINDS, record.kind)) {
      throw new CredError('bad-request', '"kind" is not a known group kind');
    }
    patch.kind = record.kind;
  }
  const commands = optionalCommands(record.allowedCommands);
  if (commands !== undefined) patch.allowedCommands = commands;

  return patch;
}

function parseEnvEntryEdit(input: unknown): EnvEntryEdit {
  if (!input || typeof input !== 'object') {
    throw new CredError('bad-request', 'an entry description is required');
  }
  const record = input as Record<string, unknown>;
  if (typeof record.value !== 'string') {
    throw new CredError('bad-request', '"value" must be a string');
  }

  return {
    fileId: requireId(record.fileId, 'fileId'),
    previousKeyName:
      typeof record.previousKeyName === 'string' && record.previousKeyName
        ? record.previousKeyName
        : null,
    keyName: requireText(record.keyName, 'keyName'),
    value: record.value,
  };
}

function parseUiSessionRequest(input: unknown): CredentialUiSessionRequest {
  if (!input || typeof input !== 'object') {
    throw new CredError('bad-request', 'a session description is required');
  }
  const record = input as Record<string, unknown>;
  const groupId = requireId(record.groupId, 'groupId');
  if (!isMember(UI_SESSION_MODES, record.mode)) {
    throw new CredError('bad-request', '"mode" is not a known credential session mode');
  }
  if (record.ttlMs !== undefined && typeof record.ttlMs !== 'number') {
    throw new CredError('bad-request', '"ttlMs" must be a number');
  }
  if (!Array.isArray(record.groupIds) || record.groupIds.some(item => typeof item !== 'string')) {
    throw new CredError('bad-request', '"groupIds" must be an array of strings');
  }
  return {
    groupId,
    groupIds: record.groupIds,
    mode: record.mode,
    ...(typeof record.ttlMs === 'number' ? { ttlMs: record.ttlMs } : {}),
  };
}

/**
 * Every channel is wrapped. A message this layer authored reaches the
 * renderer; anything else becomes `internal error`, because an arbitrary
 * exception's text could quote a value (invariant 4). Nothing is logged here
 * for the same reason.
 */
function guard<A extends unknown[], R>(
  handler: (...args: A) => R | Promise<R>,
): (event: IpcMainInvokeEvent, ...args: A) => Promise<R> {
  return async (_event, ...args) => {
    try {
      return await handler(...args);
    } catch (error) {
      throw new Error(`${errorCode(error)}: ${safeMessage(error)}`);
    }
  };
}

/** Resolved by lookup on PATH, never by spawning the CLI. */
function isCliInstalled(): boolean {
  const names = IS_WINDOWS ? ['tiginal.cmd', 'tiginal.exe', 'tiginal'] : ['tiginal'];
  return (process.env.PATH ?? '')
    .split(path.delimiter)
    .filter(entry => entry.length > 0)
    .some(dir => names.some(name => fs.existsSync(path.join(dir, name))));
}

export function setupCredentialHandlers(): void {
  const store = getCredentialStore();
  const materializer = getMaterializer();
  const runtime = getCredentialRuntime();

  // Cleanup layer 3, before the UI can render a state that is not on disk: a
  // session that crashed may have left a managed file holding real values.
  runtime.sweepOrphans();

  startCredentialSocket().catch(() => {
    // A socket that cannot bind must not take the settings UI down with it.
    // `credentials:cli-status` is where the renderer learns about it.
  });

  ipcMain.handle('credentials:list-tree', guard(() => materializer.summarizeTree()));

  ipcMain.handle(
    'credentials:list-file-locations',
    guard(() => materializer.summarizeFileLocations()),
  );

  ipcMain.handle(
    'credentials:get-group',
    guard((id: unknown) => materializer.reportFor(requireId(id, 'id'))),
  );

  ipcMain.handle(
    'credentials:create-group',
    guard((input: unknown) => {
      const request = parseCreateGroup(input);
      const group = store.createGroup({
        parentId: request.parentId ?? null,
        slug: request.slug ?? slugify(request.name),
        name: request.name,
        scope: request.scope ?? 'project',
        kind: request.kind ?? 'generic',
        rootPath: request.rootPath ?? null,
        allowedCommands: request.allowedCommands ?? [],
      });
      store.audit({
        event: 'group.created',
        groupId: group.id,
        detail: auditDetail({ path: store.groupPathOf(group.id), kind: group.kind, scope: group.scope }),
      });
      return materializer.reportFor(group.id).group;
    }),
  );

  ipcMain.handle(
    'credentials:update-group',
    guard((id: unknown, patch: unknown) => {
      store.updateGroup(requireId(id, 'id'), parseUpdateGroup(patch));
    }),
  );

  ipcMain.handle(
    'credentials:delete-group',
    guard((id: unknown) => {
      runtime.deleteCredentialGroup(requireId(id, 'id'));
      return true;
    }),
  );

  ipcMain.handle(
    'credentials:choose-directory',
    guard(async () => {
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
        title: 'Select Project Directory',
        buttonLabel: 'Select',
      });
      return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
    }),
  );

  ipcMain.handle(
    'credentials:choose-files',
    guard(async () => {
      const result = await dialog.showOpenDialog({
        properties: ['openFile', 'multiSelections', 'showHiddenFiles'],
        title: 'Select Credential Files',
        buttonLabel: 'Add',
      });
      return result.canceled ? [] : result.filePaths;
    }),
  );

  ipcMain.handle(
    'credentials:import-files',
    guard((groupId: unknown, paths: unknown, kind: unknown) => {
      const id = requireId(groupId, 'groupId');
      if (!Array.isArray(paths)) {
        throw new CredError('bad-request', '"paths" must be an array of strings');
      }
      if (!isMember(FILE_KINDS, kind)) {
        throw new CredError('bad-request', '"kind" is not a known credential file kind');
      }

      let imported = 0;
      let skipped = 0;
      const errors: string[] = [];

      for (const candidate of paths) {
        if (typeof candidate !== 'string' || candidate.length === 0) {
          errors.push('a path was not a string');
          continue;
        }
        try {
          const result = materializer.importFile(id, candidate, { kind });
          imported += result.imported;
          skipped += result.skipped;
        } catch (error) {
          errors.push(`${path.basename(candidate)}: ${safeMessage(error)}`);
        }
      }

      return { imported, skipped, errors };
    }),
  );

  ipcMain.handle(
    'credentials:repair-unrecognized-opaque',
    guard((groupId: unknown) => {
      const id = requireId(groupId, 'groupId');
      let importedFiles = 0;
      let importedSecrets = 0;
      const errors: string[] = [];

      for (const file of store.listFiles(id)) {
        if (file.format !== 'opaque' || store.listEntries(file.id).length > 0) continue;
        try {
          const result = materializer.importExistingOpaque(file.id);
          if (result.imported > 0) importedFiles++;
          importedSecrets += result.imported;
        } catch (error) {
          errors.push(`${file.relativePath || path.basename(file.absolutePath)}: ${safeMessage(error)}`);
        }
      }

      return { importedFiles, importedSecrets, errors };
    }),
  );

  ipcMain.handle(
    'credentials:remove-file',
    guard((fileId: unknown) => {
      runtime.removeManagedFile(requireId(fileId, 'fileId'));
      return true;
    }),
  );

  ipcMain.handle(
    'credentials:reveal-file',
    guard((fileId: unknown) => runtime.revealFileForUi(requireId(fileId, 'fileId'))),
  );

  // Both write channels answer with the file's new content, so the renderer can tell a completed write from a refused one and repaint from the same call.
  ipcMain.handle(
    'credentials:save-entry',
    guard((edit: unknown) => runtime.saveEnvEntry(parseEnvEntryEdit(edit))),
  );

  ipcMain.handle(
    'credentials:delete-entry',
    guard((fileId: unknown, keyName: unknown) =>
      runtime.deleteEnvEntry(requireId(fileId, 'fileId'), requireText(keyName, 'keyName')),
    ),
  );

  ipcMain.handle(
    'credentials:materialize-safe',
    guard((groupId: unknown) => materializer.materializeSubtree(requireId(groupId, 'groupId'))),
  );

  ipcMain.handle(
    'credentials:restore-safe',
    guard(
      (fileId: unknown) =>
        materializer.materializeSafe(requireId(fileId, 'fileId'), { force: true }).state,
    ),
  );

  ipcMain.handle(
    'credentials:import-drift',
    guard((fileId: unknown) => materializer.importDrift(requireId(fileId, 'fileId'))),
  );

  ipcMain.handle(
    'credentials:begin-session',
    guard((input: unknown) => {
      const request = parseUiSessionRequest(input);
      if (request.mode === 'original-files') {
        return runtime.startOriginalFileSession(request);
      }
      const grant = runtime.preauthorize({
        groupId: request.groupId,
        ttlMs: request.ttlMs,
        groupIds: request.groupIds,
      });
      return { ...grant, mode: request.mode };
    }),
  );

  ipcMain.handle(
    'credentials:revoke-session',
    guard((sessionId: unknown) => {
      runtime.revoke(requireId(sessionId, 'sessionId'));
    }),
  );

  ipcMain.handle(
    'credentials:list-sessions',
    guard((groupId: unknown) =>
      store.listSessions(typeof groupId === 'string' && groupId ? groupId : null, 100),
    ),
  );

  ipcMain.handle(
    'credentials:list-audit',
    guard((limit: unknown) => store.listAudit(typeof limit === 'number' ? limit : 200)),
  );

  ipcMain.handle(
    'credentials:cli-status',
    guard(() => ({
      socketPath: credentialSocketPath(),
      installed: isCliInstalled(),
      listening: getCredentialSocket().isListening(),
    })),
  );
}
