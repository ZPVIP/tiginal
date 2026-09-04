/**
 * Every read and write of a managed credential file goes through here.
 *
 * The safe content on disk is produced by splicing each managed entry's
 * `fake_value` over its value span, so variable names, ordering, comments,
 * quoting and non-secret values survive byte-identically. The real value only
 * ever exists as ciphertext in `credential_entries.value_encrypted` and, for
 * the lifetime of one call, in this process's memory.
 */

import * as fs from 'fs';
import * as path from 'path';
import { getCrypto } from '../../../services/ssh/CryptoService';
import { expandHome, isWithin } from '../../utils/paths';
import {
  detectFormat,
  opaqueKeyFromPath,
  rewriteValues,
  FORMAT_HANDLERS,
  type RewriteResult,
} from '../../../shared/credentials/formats';
import { classify, classifyEnvValue, fakeValueFor } from '../../../shared/credentials/classify';
import { fingerprint, deriveFileState } from '../../../shared/credentials/state';
import type {
  Classification,
  CredentialGroup,
  CredentialFile,
  CredentialFileLocation,
  CredentialSession,
  FileFormat,
  FileKind,
  FileState,
  GroupStatus,
  GroupStatusReport,
  GroupSummary,
  Injection,
  ParsedEntry,
  SecretType,
} from '../../../shared/credentials/types';
import { toCredentialTreePath } from '../../../shared/credentials/platform-paths';
import {
  auditDetail,
  CredError,
  getCredentialStore,
  safeMessage,
  type CredentialEntryRow,
  type CredentialStore,
} from './CredentialStore';

class RuntimeCapability {
  private constructor() {}
  static readonly singleton = new RuntimeCapability();
}

/**
 * Proof that the caller is the credential runtime. The class behind this type
 * is not exported and its constructor is private, so no other module can
 * produce a value of it: a renderer-facing channel that reaches for a
 * plaintext value fails to compile rather than needing a reviewer to notice
 * (invariant 2).
 */
export type RevealCapability = RuntimeCapability;

let capabilityClaimed = false;

/** Called once, from `CredentialRuntime`'s module init. A second call throws. */
export function claimRevealCapability(): RevealCapability {
  if (capabilityClaimed) {
    throw new Error('the credential reveal capability has already been claimed');
  }
  capabilityClaimed = true;
  return RuntimeCapability.singleton;
}

export interface ImportOptions {
  /** What the user declared the file to be. `format` follows from it. */
  kind: FileKind;
  /** Project root that the stored `relativePath` is computed against. */
  relativeTo?: string | null;
  injection?: Injection;
}

export interface ImportResult {
  fileId: string;
  imported: number;
  skipped: number;
}

export interface InspectedKey {
  key: string;
  secretType: SecretType;
  masked: true;
}

export interface InspectResult {
  state: FileState;
  keys: InspectedKey[];
}

export interface RevealedEntry {
  key: string;
  value: string;
  secretType: SecretType;
}

/** One file's outcome from a group-wide re-mask. `state` is null when it failed. */
export interface SafeFileOutcome {
  path: string;
  written: boolean;
  state: FileState | null;
  error: string | null;
}

/**
 * How a newly imported file is consumed by default. An ENV file has named
 * values a child process can take as environment; a key file is one blob that
 * a tool reads by path.
 */
const DEFAULT_INJECTION: Record<FileKind, Injection> = {
  env: 'env',
  key: 'file',
  'ssh-key': 'file',
};

/** A public key body, which is never the thing an `ssh-key` file manages. */
const PUBLIC_KEY_BODY = /^(ssh-rsa |ssh-ed25519 |ssh-dss |ecdsa-sha2-)/;

interface ImportCandidate {
  absolutePath: string;
  content: string;
  format: FileFormat;
  group: CredentialGroup;
}

/**
 * What each declared kind means for the file it was declared for. A table
 * rather than a chain of `if (kind === ...)`, so adding a kind to `FileKind`
 * fails to compile until its parser, its checks and its sibling are all named.
 */
interface KindRules {
  /** The parser this kind's files are read with. */
  formatFor(absolutePath: string): FileFormat;
  /** Refuse a file the declared kind cannot manage, before anything is stored. */
  verify(candidate: ImportCandidate): void;
  /** A sibling file shown alongside this one, never encrypted or masked. */
  publicKeyFor(absolutePath: string): string | null;
}

const KIND_RULES: Record<FileKind, KindRules> = {
  env: {
    // The user said this file is `key=value`, so a name the detector does not
    // recognize is read as dotenv rather than as one opaque blob.
    formatFor: absolutePath => {
      const detected = detectFormat(absolutePath);
      return detected === 'opaque' ? 'dotenv' : detected;
    },
    verify: ({ content, format }) => {
      const named = FORMAT_HANDLERS[format].parse(content).filter(entry => entry.key !== '');
      if (named.length === 0) {
        throw new CredError('bad-request', 'no key=value pairs found in that file');
      }
    },
    publicKeyFor: () => null,
  },
  key: {
    formatFor: () => 'opaque',
    verify: () => undefined,
    publicKeyFor: () => null,
  },
  'ssh-key': {
    formatFor: () => 'opaque',
    verify: ({ absolutePath, content, group }) => {
      if (group.scope !== 'system') {
        throw new CredError('policy', 'an SSH private key belongs to a system-scope group');
      }
      if (path.basename(absolutePath).toLowerCase().endsWith('.pub')) {
        throw new CredError('bad-request', 'that is a public key file; select the private key instead');
      }
      if (PUBLIC_KEY_BODY.test(content)) {
        throw new CredError('bad-request', 'that file holds a public key; select the private key instead');
      }
    },
    publicKeyFor: absolutePath => {
      const sibling = `${absolutePath}.pub`;
      try {
        return fs.statSync(sibling).isFile() ? sibling : null;
      } catch {
        return null;
      }
    },
  },
};

/**
 * Which file state a group reports, most urgent first. A `safe-edited` file is
 * still fully masked, so it reads as SAFE to the user.
 */
const STATE_SEVERITY: Array<[FileState['kind'], GroupStatus]> = [
  ['drifted', 'drifted'],
  ['missing', 'missing'],
  ['unmanaged', 'unmanaged'],
  ['safe-edited', 'safe'],
  ['safe', 'safe'],
];

function groupStatusFrom(kinds: Set<FileState['kind']>): GroupStatus {
  for (const [kind, status] of STATE_SEVERITY) {
    if (kinds.has(kind)) return status;
  }
  return 'safe';
}

function readIfExists(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return null;
    if (code === 'EACCES' || code === 'EPERM') {
      throw new CredError('policy', 'no permission to read the managed file');
    }
    if (code === 'EISDIR') {
      throw new CredError('bad-request', 'the managed path is a directory');
    }
    throw error;
  }
}

/**
 * Write through a sibling temp file and rename, so a reader never observes a
 * half-written credential file. `writeFileSync`'s mode is subject to umask and
 * is ignored outright when the temp path already exists, hence the chmod.
 */
function atomicWrite(target: string, content: string, mode: number | null): void {
  const staging = target + '.tiginal-tmp';
  fs.writeFileSync(staging, content, { encoding: 'utf8', mode: mode ?? 0o600 });
  if (mode !== null) fs.chmodSync(staging, mode);
  try {
    fs.renameSync(staging, target);
  } catch (error) {
    try {
      fs.unlinkSync(staging);
    } catch {
      // The rename failure is the one worth reporting.
    }
    throw error;
  }
}

/**
 * Every value in a declared ENV file is managed whatever it looks like; every
 * other kind is one whole-file secret. Both paths refuse an already-masked
 * value, which is what stops a re-import encrypting `********`.
 */
function classificationFor(file: CredentialFile, key: string, value: string): Classification {
  return file.kind === 'env'
    ? classifyEnvValue(key, value)
    : classify(key, value, file.format);
}

/**
 * Drop every line that assigns `keyName`, its terminator included. Rebuilding
 * the file from its parsed entries would be shorter and would also discard
 * every comment in it, which is the thing the span rewrite exists to protect.
 */
function withoutKeyLines(content: string, format: FileFormat, keyName: string): string {
  const cuts = FORMAT_HANDLERS[format]
    .parse(content)
    .filter(entry => entry.key === keyName)
    .map(entry => {
      const newline = content.indexOf('\n', entry.valueEnd);
      return {
        start: content.lastIndexOf('\n', entry.valueStart - 1) + 1,
        end: newline === -1 ? content.length : newline + 1,
      };
    })
    .sort((a, b) => b.start - a.start);

  let next = content;
  for (const cut of cuts) next = next.slice(0, cut.start) + next.slice(cut.end);
  return next;
}

/** Last occurrence wins, matching the shell's own reading of a dotenv file. */
function indexByKey(parsed: ParsedEntry[]): Map<string, ParsedEntry> {
  const byKey = new Map<string, ParsedEntry>();
  for (const entry of parsed) byKey.set(entry.key, entry);
  return byKey;
}

export class Materializer {
  constructor(private readonly store: CredentialStore = getCredentialStore()) {}

  /** Resolve a user-supplied path to the canonical form stored in the DB. */
  static canonicalPath(input: string): string {
    return path.resolve(expandHome(input));
  }

  importFile(groupId: string, absolutePath: string, opts: ImportOptions): ImportResult {
    const crypto = getCrypto();
    if (!crypto.isUnlocked()) {
      throw new CredError('locked', 'unlock Tiginal before importing a credential file');
    }

    const group = this.store.getGroup(groupId);
    if (!group) throw new CredError('not-found', 'group does not exist');

    const target = Materializer.canonicalPath(absolutePath);
    if (this.store.getFileByPath(target)) {
      throw new CredError('bad-request', 'that file is already managed');
    }
    this.assertInsideProject(group, target);

    const content = readIfExists(target);
    if (content === null) throw new CredError('not-found', 'file does not exist');

    const stats = fs.statSync(target);
    if (!stats.isFile()) throw new CredError('bad-request', 'only a regular file can be managed');

    const rules = KIND_RULES[opts.kind];
    const format = rules.formatFor(target);
    rules.verify({ absolutePath: target, content, format, group });

    const file = this.store.createFile({
      groupId,
      kind: opts.kind,
      absolutePath: target,
      relativePath: this.relativePathFor(target, opts.relativeTo ?? this.projectRootFor(group)),
      format,
      injection: opts.injection ?? DEFAULT_INJECTION[opts.kind],
      fileMode: stats.mode & 0o777,
      publicKeyPath: rules.publicKeyFor(target),
    });

    const { imported, skipped } = this.captureEntries(file, content);

    this.store.audit({
      event: 'file.imported',
      groupId,
      detail: auditDetail({
        path: file.relativePath || path.basename(target),
        kind: opts.kind,
        format,
        imported,
        skipped,
      }),
    });

    // The real values are now in the database, so the file on disk must stop
    // holding them before this call returns.
    this.materializeSafe(file.id, { force: true });

    return { fileId: file.id, imported, skipped };
  }

  /**
   * Repair files imported before opaque content was classified as a whole-file
   * secret. This only adopts a file that has no encrypted entries yet.
   */
  importExistingOpaque(fileId: string): ImportResult {
    const crypto = getCrypto();
    if (!crypto.isUnlocked()) {
      throw new CredError('locked', 'unlock Tiginal before importing a credential file');
    }

    const file = this.requireFile(fileId);
    if (file.format !== 'opaque') {
      throw new CredError('bad-request', 'only an opaque file can be repaired this way');
    }
    if (this.store.listEntries(file.id).length > 0) {
      return { fileId: file.id, imported: 0, skipped: 1 };
    }

    const content = readIfExists(file.absolutePath);
    if (content === null) throw new CredError('not-found', 'file does not exist');

    const result = this.captureEntries(file, content);
    if (result.imported === 0) {
      throw new CredError('bad-request', 'the file is empty or already contains a placeholder');
    }

    this.store.audit({
      event: 'file.imported',
      groupId: file.groupId,
      detail: auditDetail({
        path: file.relativePath || path.basename(file.absolutePath),
        format: file.format,
        imported: result.imported,
        repaired: 'true',
      }),
    });
    this.materializeSafe(file.id, { force: true });
    return { fileId: file.id, ...result };
  }

  private captureEntries(
    file: CredentialFile,
    content: string,
  ): Pick<ImportResult, 'imported' | 'skipped'> {
    const crypto = getCrypto();
    let imported = 0;
    let skipped = 0;

    for (const parsed of FORMAT_HANDLERS[file.format].parse(content)) {
      const key = parsed.key || opaqueKeyFromPath(file.absolutePath);
      const classification = classificationFor(file, key, parsed.value);
      if (classification.spans.length === 0) {
        skipped++;
        continue;
      }
      this.store.upsertEntry({
        fileId: file.id,
        keyName: key,
        secretType: classification.secretType,
        valueEncrypted: crypto.encrypt(parsed.value),
        fakeValue: fakeValueFor(parsed.value, classification, file.format),
      });
      imported++;
    }

    return { imported, skipped };
  }

  materializeSafe(fileId: string, opts: { force?: boolean } = {}): { written: boolean; state: FileState } {
    const file = this.requireFile(fileId);
    const entries = this.store.listEntries(fileId);
    const pairs = entries.map(entry => ({ keyName: entry.keyName, fakeValue: entry.fakeValue }));

    const content = readIfExists(file.absolutePath);
    if (content === null) return { written: false, state: { kind: 'missing' } };

    const before = deriveFileState({
      content,
      safeFingerprint: file.safeFingerprint,
      format: file.format,
      entries: pairs,
    });
    if (before.kind === 'drifted' && !opts.force) {
      this.store.audit({
        event: 'drift.detected',
        groupId: file.groupId,
        detail: auditDetail({
          path: file.relativePath || path.basename(file.absolutePath),
          changed: before.changedKeys.length,
          missing: before.missingKeys.length,
        }),
      });
      throw new CredError('drift', 'credential drift detected; restore or import the changes first');
    }

    const values = new Map(entries.map(entry => [entry.keyName, entry.fakeValue]));
    const rewritten = rewriteValues(content, file.format, values, {
      appendMissing: file.kind === 'env',
    });
    const written = rewritten.content !== content;
    if (written) atomicWrite(file.absolutePath, rewritten.content, file.fileMode);

    const digest = fingerprint(rewritten.content);
    if (file.safeFingerprint !== digest) {
      this.store.updateFile(fileId, { safeFingerprint: digest });
    }

    this.store.audit({
      event: opts.force ? 'safe.restored' : 'safe.materialized',
      groupId: file.groupId,
      detail: auditDetail({
        path: file.relativePath || path.basename(file.absolutePath),
        keys: entries.length,
        written: String(written),
        appended: rewritten.appendedKeys.length,
        absentKeys: rewritten.missingKeys.length,
      }),
    });

    return {
      written,
      state: deriveFileState({
        content: rewritten.content,
        safeFingerprint: digest,
        format: file.format,
        entries: pairs,
      }),
    };
  }

  /**
   * Re-mask every managed file in a subtree. A drifted file refuses rather
   * than discarding the user's edit, and one refusal does not stop the rest.
   */
  materializeSubtree(groupId: string): SafeFileOutcome[] {
    const outcomes: SafeFileOutcome[] = [];

    for (const group of this.store.descendantsOf(groupId)) {
      for (const file of this.store.listFiles(group.id)) {
        const label = file.relativePath || path.basename(file.absolutePath);
        try {
          const result = this.materializeSafe(file.id);
          outcomes.push({ path: label, written: result.written, state: result.state, error: null });
        } catch (error) {
          outcomes.push({ path: label, written: false, state: null, error: safeMessage(error) });
        }
      }
    }
    return outcomes;
  }

  /** Masked throughout: no real value and no fake value leaves this method. */
  inspect(fileId: string): InspectResult {
    const file = this.requireFile(fileId);
    const entries = this.store.listEntries(fileId);
    const pairs = entries.map(entry => ({ keyName: entry.keyName, fakeValue: entry.fakeValue }));

    const content = readIfExists(file.absolutePath);
    const state = deriveFileState({
      content,
      safeFingerprint: file.safeFingerprint,
      format: file.format,
      entries: pairs,
    });

    // A comment or a non-secret value changed. The masks are all still in
    // place, so re-baseline quietly rather than nagging the user forever.
    if (state.kind === 'safe-edited' && content !== null) {
      this.store.updateFile(fileId, { safeFingerprint: fingerprint(content) });
    }

    return {
      state,
      keys: entries.map(entry => ({
        key: entry.keyName,
        secretType: entry.secretType,
        masked: true as const,
      })),
    };
  }

  /**
   * The whole tree as masked summaries, depth-first, which is the order the
   * settings UI and `tiginal cred list` both render.
   */
  summarizeTree(): GroupSummary[] {
    const groups = this.store.listGroups();
    const byParent = new Map<string, CredentialGroup[]>();
    for (const group of groups) {
      const key = group.parentId ?? '';
      const siblings = byParent.get(key);
      if (siblings) siblings.push(group);
      else byParent.set(key, [group]);
    }

    const summaries: GroupSummary[] = [];
    const walk = (parentKey: string, prefix: string[], depth: number): void => {
      for (const group of byParent.get(parentKey) ?? []) {
        const slugs = [...prefix, group.slug];
        summaries.push(this.summarize(group, slugs.join('/'), depth));
        walk(group.id, slugs, depth + 1);
      }
    };
    walk('', [], 0);
    return summaries;
  }

  /** Physical file locations for the renderer's read-only Trees view. */
  summarizeFileLocations(): CredentialFileLocation[] {
    const platform = process.platform === 'win32'
      ? 'win32'
      : process.platform === 'darwin'
        ? 'darwin'
        : 'linux';

    return this.store.listGroups().flatMap(group => {
      const groupPath = this.store.groupPathOf(group.id);
      return this.store.listFiles(group.id).flatMap(file => {
        const state = this.inspect(file.id).state;
        const managed: CredentialFileLocation = {
          id: file.id,
          groupId: group.id,
          groupPath,
          kind: file.kind,
          role: 'managed',
          absolutePath: file.absolutePath,
          treePath: toCredentialTreePath(file.absolutePath, platform),
          state,
        };
        if (!file.publicKeyPath) return [managed];

        // The public key is display-only, so it borrows its private key's
        // state rather than claiming one of its own.
        return [
          managed,
          {
            ...managed,
            role: 'public-key' as const,
            absolutePath: file.publicKeyPath,
            treePath: toCredentialTreePath(file.publicKeyPath, platform),
          },
        ];
      });
    });
  }

  /** One group's detail: masked entry names and each file's state. */
  reportFor(groupId: string): GroupStatusReport {
    const group = this.store.getGroup(groupId);
    if (!group) throw new CredError('not-found', 'group does not exist');

    return {
      group: this.summarize(group, this.store.groupPathOf(groupId), this.depthOf(group)),
      files: this.store.listFiles(groupId).map(file => ({
        id: file.id,
        kind: file.kind,
        relativePath: file.relativePath,
        absolutePath: file.absolutePath,
        format: file.format,
        publicKeyPath: file.publicKeyPath,
        state: this.inspect(file.id).state,
        entries: this.store.listEntries(file.id).map(entry => ({
          id: entry.id,
          keyName: entry.keyName,
          secretType: entry.secretType,
        })),
      })),
      activeSession: this.liveSessionFor(group),
    };
  }

  /** Adopt the on-disk values as the new real ones, then re-mask the file. */
  importDrift(fileId: string): { updated: number } {
    const crypto = getCrypto();
    if (!crypto.isUnlocked()) {
      throw new CredError('locked', 'unlock Tiginal before importing changes');
    }

    const file = this.requireFile(fileId);
    const content = readIfExists(file.absolutePath);
    if (content === null) throw new CredError('not-found', 'file does not exist');

    const parsedEntries = FORMAT_HANDLERS[file.format].parse(content).map(parsed => (
      parsed.key
        ? parsed
        : { ...parsed, key: opaqueKeyFromPath(file.absolutePath) }
    ));
    const byKey = indexByKey(parsedEntries);
    let updated = 0;

    for (const entry of this.store.listEntries(fileId)) {
      const parsed = byKey.get(entry.keyName);
      if (!parsed) continue;

      // An unchanged mask classifies as not-a-secret, which is what stops this
      // path from encrypting `********` over a real value.
      const classification = classificationFor(file, entry.keyName, parsed.value);
      if (classification.spans.length === 0) continue;

      this.store.upsertEntry({
        fileId,
        keyName: entry.keyName,
        secretType: classification.secretType,
        valueEncrypted: crypto.encrypt(parsed.value),
        fakeValue: fakeValueFor(parsed.value, classification, file.format),
      });
      updated++;
    }

    this.store.audit({
      event: 'drift.imported',
      groupId: file.groupId,
      detail: auditDetail({
        path: file.relativePath || path.basename(file.absolutePath),
        updated,
      }),
    });

    this.materializeSafe(fileId, { force: true });
    return { updated };
  }

  /**
   * The only decrypting method in the credential layer. Reachable solely from
   * `CredentialRuntime`, which holds the capability.
   */
  revealForRuntime(fileId: string, capability: RevealCapability): RevealedEntry[] {
    this.assertCapability(capability);
    const crypto = getCrypto();
    if (!crypto.isUnlocked()) {
      throw new CredError('locked', 'the master key is locked');
    }

    this.requireFile(fileId);
    return this.store.listEntries(fileId).map((entry: CredentialEntryRow) => ({
      key: entry.keyName,
      value: crypto.decrypt(entry.valueEncrypted),
      secretType: entry.secretType,
    }));
  }

  /**
   * The managed file's content with real values spliced back in, for an
   * ephemeral copy inside a session temp directory. Never written to the
   * managed path except through `CredentialRuntime`'s original-file session.
   */
  realContentFor(fileId: string, capability: RevealCapability): RewriteResult {
    this.assertCapability(capability);

    const file = this.requireFile(fileId);
    const content = readIfExists(file.absolutePath);
    if (content === null) throw new CredError('not-found', 'file does not exist');

    const values = new Map(
      this.revealForRuntime(fileId, capability).map(entry => [entry.key, entry.value]),
    );
    return rewriteValues(content, file.format, values, { appendMissing: file.kind === 'env' });
  }

  /**
   * Take `keyName`'s line out of the file. The caller re-masks afterwards,
   * which is what restores the fingerprint the state check compares against.
   */
  removeKeyLine(fileId: string, keyName: string): void {
    const file = this.requireFile(fileId);
    const content = readIfExists(file.absolutePath);
    if (content === null) return;

    const next = withoutKeyLines(content, file.format, keyName);
    if (next !== content) atomicWrite(file.absolutePath, next, file.fileMode);
  }

  private summarize(group: CredentialGroup, groupPath: string, depth: number): GroupSummary {
    const files = this.store.listFiles(group.id);
    const kinds = new Set<FileState['kind']>();
    let secretCount = 0;

    for (const file of files) {
      kinds.add(this.inspect(file.id).state.kind);
      secretCount += this.store.listEntries(file.id).length;
    }

    const session = this.liveSessionFor(group);
    return {
      id: group.id,
      path: groupPath,
      name: group.name,
      scope: group.scope,
      kind: group.kind,
      rootPath: group.rootPath,
      depth,
      status: session ? 'live' : groupStatusFrom(kinds),
      fileCount: files.length,
      secretCount,
      liveExpiresAt: session ? session.expiresAt : null,
    };
  }

  /** A session on an ancestor covers this group, so the chain is what counts. */
  private liveSessionFor(group: CredentialGroup): CredentialSession | null {
    for (const ancestor of this.store.ancestryOf(group.id)) {
      const session = this.store.activeSessionFor(ancestor.id);
      if (session) return session;
    }
    return null;
  }

  private depthOf(group: CredentialGroup): number {
    return this.store.ancestryOf(group.id).length - 1;
  }

  private assertCapability(capability: RevealCapability): void {
    // The type already makes this unreachable from TypeScript. The check keeps
    // it unreachable from a plain-JS consumer of the compiled output too.
    if (capability !== RuntimeCapability.singleton) {
      throw new CredError('denied', 'plaintext access requires the runtime capability');
    }
  }

  /**
   * A project group manages files inside its own root and nowhere else, so a
   * mistyped path cannot quietly enrol something from another project or from
   * the user's home directory. A system group is rooted nowhere and accepts
   * any path.
   *
   * The root is taken from the nearest group in the chain that has one, so a
   * child group inherits its project's root instead of refusing every file for
   * want of a root of its own.
   */
  private assertInsideProject(group: CredentialGroup, target: string): void {
    if (group.scope !== 'project') return;

    const root = this.projectRootFor(group);
    if (!root) {
      throw new CredError('policy', 'set this project\'s root directory before adding a file to it');
    }
    if (!isWithin(root, target)) {
      throw new CredError('policy', 'that file is outside the project root; a project only manages files inside its own root');
    }
  }

  private projectRootFor(group: CredentialGroup): string | null {
    for (const ancestor of this.store.ancestryOf(group.id)) {
      if (ancestor.rootPath) return Materializer.canonicalPath(ancestor.rootPath);
    }
    return null;
  }

  private requireFile(fileId: string) {
    const file = this.store.getFile(fileId);
    if (!file) throw new CredError('not-found', 'managed file does not exist');
    return file;
  }

  private relativePathFor(target: string, root: string | null | undefined): string {
    if (root) {
      const resolvedRoot = Materializer.canonicalPath(root);
      if (isWithin(resolvedRoot, target)) return path.relative(resolvedRoot, target);
    }
    return path.basename(target);
  }
}

let materializerInstance: Materializer | null = null;

export function getMaterializer(): Materializer {
  if (!materializerInstance) {
    materializerInstance = new Materializer();
  }
  return materializerInstance;
}
