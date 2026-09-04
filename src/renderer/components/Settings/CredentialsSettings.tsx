import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { clsx } from 'clsx';
import {
  KeyRound, FolderTree, History, ChevronLeft, ChevronRight,
  Plus, FilePlus, Search, Zap, Trash2, ShieldCheck, AlertTriangle,
} from 'lucide-react';
import { SettingsPageHeader } from './SettingsPageHeader';
import { CredentialLocationTree } from './CredentialLocationTree';
import { Modal } from '../ui/Modal';
import { Toggle } from '../ui/Toggle';
import type {
  AuditRecord, CredentialFileLocation, CredentialSession, CredentialUiSessionGrant,
  CredentialUiSessionMode, CredentialUiSessionRequest, FileFormat, FileState, GroupKind, GroupScope,
  GroupStatus, GroupStatusReport, GroupSummary, Injection, SecretType,
} from '../../../shared/credentials/types';

type ManagedFile = GroupStatusReport['files'][number];
type CredentialDivider = 'tree-details' | 'details-activity';

type ResizeState =
  | { kind: 'idle' }
  | { kind: 'dragging'; divider: CredentialDivider; pointerId: number };

interface ColumnRatios {
  tree: number;
  details: number;
  activity: number;
}

interface ScanResult {
  absolutePath: string;
  relativePath: string;
  format: FileFormat;
  suggestedKind: GroupKind;
}

interface InspectResult {
  state: FileState;
  keys: Array<{ key: string; secretType: SecretType; masked: true }>;
}

interface ActivateDraft {
  rootId: string;
  selected: Set<string>;
  ttlMinutes: number;
  mode: CredentialUiSessionMode;
}

interface LiveSession {
  sessionId: string;
  groupPath: string;
  expiresAt: number;
  mode: CredentialUiSessionMode;
}

interface DriftDraft {
  fileId: string;
  armed: boolean;
}

interface GroupDraft {
  parentId: string | null;
  name: string;
  kind: GroupKind;
  scope: GroupScope;
  rootPath: string | null;
}

interface ScanDraft {
  groupId: string;
  rootPath: string;
  results: ScanResult[];
  selected: Set<string>;
}

const PAGE_SIZE = 10;
const CREDENTIALS_LAYOUT_KEY = 'credentials-layout-config-v1';
const DIVIDER_WIDTH = 1;
const COLUMN_MINIMUMS = { tree: 220, details: 320, activity: 280 };
const MIN_WORKSPACE_WIDTH = COLUMN_MINIMUMS.tree
  + COLUMN_MINIMUMS.details
  + COLUMN_MINIMUMS.activity
  + DIVIDER_WIDTH * 2;
const DEFAULT_COLUMN_RATIOS: ColumnRatios = { tree: 0.25, details: 0.45, activity: 0.3 };

const TTL_CHOICES = [5, 15, 30, 60];

const GROUP_KINDS: GroupKind[] = ['generic', 'rails', 'kamal', 'terraform', 'ssh', 'aws'];
const GROUP_SCOPES: GroupScope[] = ['project', 'system'];
const INJECTIONS: Injection[] = ['env', 'file', 'both'];

const NEUTRAL_PILL = 'bg-surface-light border-border text-text-muted';
const MUTED_PILL = 'bg-surface-light border-border text-text-muted/70';
const AMBER_PILL = 'bg-amber-500/10 border-amber-500/30 text-amber-400';
const GREEN_PILL = 'bg-green-500/10 border-green-500/30 text-green-400';
const RED_PILL = 'bg-red-500/10 border-red-500/30 text-red-400';

const GROUP_PILLS: Record<GroupStatus, { label: string; className: string }> = {
  safe: { label: 'SAFE', className: NEUTRAL_PILL },
  drifted: { label: 'DRIFTED', className: AMBER_PILL },
  live: { label: 'LIVE', className: GREEN_PILL },
  unmanaged: { label: 'UNMANAGED', className: MUTED_PILL },
  missing: { label: 'MISSING', className: RED_PILL },
};

const FILE_PILLS: Record<FileState['kind'], { label: string; className: string }> = {
  safe: { label: 'SAFE', className: NEUTRAL_PILL },
  'safe-edited': { label: 'SAFE (EDITED)', className: NEUTRAL_PILL },
  drifted: { label: 'DRIFTED', className: AMBER_PILL },
  missing: { label: 'MISSING', className: RED_PILL },
  unmanaged: { label: 'UNMANAGED', className: MUTED_PILL },
};

const PILL = 'text-[10px] px-1.5 py-0.5 rounded border shrink-0';
const BTN_PRIMARY = 'flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm rounded-lg hover:opacity-90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
const BTN_SUBTLE = 'flex items-center gap-1.5 px-3 py-1.5 bg-surface border border-border text-text-main text-xs rounded-lg hover:border-primary hover:bg-surface-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
const BTN_MODAL = 'px-4 py-2 text-sm bg-background hover:bg-surface-light border border-border rounded-lg transition-colors';
const BTN_MODAL_PRIMARY = 'px-4 py-2 text-sm bg-primary hover:opacity-90 text-primary-foreground rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
const FIELD = 'bg-background text-text-main text-sm rounded-lg py-2 px-3 border border-border focus:border-primary outline-none';
const EMPTY = 'text-center py-8 text-text-muted text-sm';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeColumnRatios(ratios: ColumnRatios): ColumnRatios {
  const total = ratios.tree + ratios.details + ratios.activity;
  return {
    tree: ratios.tree / total,
    details: ratios.details / total,
    activity: ratios.activity / total,
  };
}

function readColumnRatios(): ColumnRatios {
  try {
    const serialized = window.localStorage.getItem(CREDENTIALS_LAYOUT_KEY);
    if (!serialized) return DEFAULT_COLUMN_RATIOS;
    const value: unknown = JSON.parse(serialized);
    if (!isRecord(value)) return DEFAULT_COLUMN_RATIOS;
    const { tree, details, activity } = value;
    if (
      typeof tree !== 'number' || !Number.isFinite(tree) || tree <= 0
      || typeof details !== 'number' || !Number.isFinite(details) || details <= 0
      || typeof activity !== 'number' || !Number.isFinite(activity) || activity <= 0
    ) {
      return DEFAULT_COLUMN_RATIOS;
    }
    return normalizeColumnRatios({ tree, details, activity });
  } catch {
    return DEFAULT_COLUMN_RATIOS;
  }
}

function fitColumnRatios(preferred: ColumnRatios, usableWidth: number): ColumnRatios {
  const minimumTotal = COLUMN_MINIMUMS.tree + COLUMN_MINIMUMS.details + COLUMN_MINIMUMS.activity;
  const width = Math.max(usableWidth, minimumTotal);
  const preferredPixels = {
    tree: preferred.tree * width,
    details: preferred.details * width,
    activity: preferred.activity * width,
  };
  const desiredExtra = {
    tree: Math.max(0, preferredPixels.tree - COLUMN_MINIMUMS.tree),
    details: Math.max(0, preferredPixels.details - COLUMN_MINIMUMS.details),
    activity: Math.max(0, preferredPixels.activity - COLUMN_MINIMUMS.activity),
  };
  const extraTotal = desiredExtra.tree + desiredExtra.details + desiredExtra.activity;
  const availableExtra = width - minimumTotal;

  if (extraTotal === 0) {
    return normalizeColumnRatios(COLUMN_MINIMUMS);
  }

  return normalizeColumnRatios({
    tree: COLUMN_MINIMUMS.tree + availableExtra * desiredExtra.tree / extraTotal,
    details: COLUMN_MINIMUMS.details + availableExtra * desiredExtra.details / extraTotal,
    activity: COLUMN_MINIMUMS.activity + availableExtra * desiredExtra.activity / extraTotal,
  });
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/** Electron prefixes IPC rejections with "Error invoking remote method '...':" */
function cleanError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return message
    .replace(/^Error invoking remote method '[^']*':\s*(Error:\s*)?/, '')
    || 'Something went wrong';
}

function nativeBasename(filePath: string): string {
  const trimmed = filePath.replace(/[\\/]+$/, '');
  return trimmed.split(/[\\/]/).filter(Boolean).at(-1) ?? trimmed;
}

function descendantsOf(groups: GroupSummary[], group: GroupSummary) {
  const start = groups.findIndex((g) => g.id === group.id);
  if (start < 0) return [];
  const out: GroupSummary[] = [];
  for (let i = start + 1; i < groups.length && groups[i].depth > group.depth; i++) {
    out.push(groups[i]);
  }
  return out;
}

function countdown(msLeft: number) {
  const seconds = Math.max(0, Math.ceil(msLeft / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function minutesLeft(msLeft: number) {
  return Math.max(1, Math.ceil(msLeft / 60_000));
}

export function CredentialsSettings() {
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [locations, setLocations] = useState<CredentialFileLocation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [detail, setDetail] = useState<GroupStatusReport | null>(null);
  const [sessions, setSessions] = useState<CredentialSession[]>([]);
  const [audit, setAudit] = useState<AuditRecord[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [live, setLive] = useState<LiveSession | null>(null);
  const [activate, setActivate] = useState<ActivateDraft | null>(null);
  const [drift, setDrift] = useState<DriftDraft | null>(null);
  const [groupDraft, setGroupDraft] = useState<GroupDraft | null>(null);
  const [scan, setScan] = useState<ScanDraft | null>(null);
  const [cli, setCli] = useState<{ socketPath: string; installed: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);
  const [sessionPage, setSessionPage] = useState(0);
  const [auditPage, setAuditPage] = useState(0);
  const [preferredRatios, setPreferredRatios] = useState<ColumnRatios>(readColumnRatios);
  const [workspaceWidth, setWorkspaceWidth] = useState(MIN_WORKSPACE_WIDTH);
  const [resizeState, setResizeState] = useState<ResizeState>({ kind: 'idle' });
  const workspaceRef = useRef<HTMLDivElement>(null);
  const treePaneRef = useRef<HTMLElement>(null);
  const detailsPaneRef = useRef<HTMLElement>(null);
  const activityPaneRef = useRef<HTMLElement>(null);

  const invoke = window.electron?.invoke || (async () => null);

  const call = async <T,>(channel: string, ...args: unknown[]): Promise<T | null> => {
    setBusy(true);
    try {
      return (await invoke(channel, ...args)) as T | null;
    } catch (e) {
      setBanner({ kind: 'error', text: cleanError(e) });
      return null;
    } finally {
      setBusy(false);
    }
  };

  const loadSessions = async (list: GroupSummary[]) => {
    const [rows, records, cliStatus] = await Promise.all([
      call<CredentialSession[]>('credentials:list-sessions'),
      call<AuditRecord[]>('credentials:list-audit', 200),
      call<{ socketPath: string; installed: boolean }>('credentials:cli-status'),
    ]);
    const ordered = [...(rows || [])].sort((a, b) => b.createdAt - a.createdAt);
    setSessions(ordered);
    setAudit([...(records || [])].sort((a, b) => b.at - a.at));
    if (cliStatus) setCli(cliStatus);

    const active = ordered.find((s) => s.status === 'active' && s.expiresAt > Date.now());
    if (!active) return;
    const path = list.find((g) => g.id === active.groupId)?.path || active.groupId;
    setLive((prev) => prev ?? {
      sessionId: active.id,
      groupPath: path,
      expiresAt: active.expiresAt,
      mode: active.approvedBy === 'ui-original-files' ? 'original-files' : 'cli-authorization',
    });
  };

  const load = async () => {
    const [listResult, locationResult] = await Promise.all([
      call<GroupSummary[]>('credentials:list-tree'),
      call<CredentialFileLocation[]>('credentials:list-file-locations'),
    ]);
    const list = listResult || [];
    setGroups(list);
    setLocations(locationResult || []);
    const groupId = selectedId ?? list[0]?.id ?? null;
    if (groupId) {
      setSelectedId(groupId);
      const report = await call<GroupStatusReport>('credentials:get-group', groupId);
      if (report) setDetail(report);
    }
    await loadSessions(list);
  };

  const refresh = async (groupId: string | null) => {
    const [list, fileLocations] = await Promise.all([
      call<GroupSummary[]>('credentials:list-tree'),
      call<CredentialFileLocation[]>('credentials:list-file-locations'),
    ]);
    setGroups(list || []);
    setLocations(fileLocations || []);
    if (!groupId) return;
    const report = await call<GroupStatusReport>('credentials:get-group', groupId);
    if (report) setDetail(report);
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    window.localStorage.setItem(CREDENTIALS_LAYOUT_KEY, JSON.stringify(preferredRatios));
  }, [preferredRatios]);

  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    const updateWidth = () => setWorkspaceWidth(workspace.getBoundingClientRect().width);
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(workspace);
    return () => observer.disconnect();
  }, []);

  const fittedRatios = useMemo(
    () => fitColumnRatios(
      preferredRatios,
      workspaceWidth - DIVIDER_WIDTH * 2,
    ),
    [preferredRatios, workspaceWidth],
  );

  const startResizing = useCallback((
    divider: CredentialDivider,
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setResizeState({ kind: 'dragging', divider, pointerId: event.pointerId });
  }, []);

  useEffect(() => {
    if (resizeState.kind !== 'dragging') return;

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerId !== resizeState.pointerId) return;
      const workspace = workspaceRef.current;
      const treePane = treePaneRef.current;
      const detailsPane = detailsPaneRef.current;
      const activityPane = activityPaneRef.current;
      if (!workspace || !treePane || !detailsPane || !activityPane) return;

      const workspaceRect = workspace.getBoundingClientRect();
      const usableWidth = workspaceRect.width - DIVIDER_WIDTH * 2;
      const cursorX = event.clientX - workspaceRect.left;
      const treeWidth = treePane.getBoundingClientRect().width;
      const activityWidth = activityPane.getBoundingClientRect().width;

      if (resizeState.divider === 'tree-details') {
        const nextTreeWidth = clamp(
          cursorX,
          COLUMN_MINIMUMS.tree,
          usableWidth - activityWidth - COLUMN_MINIMUMS.details,
        );
        setPreferredRatios(normalizeColumnRatios({
          tree: nextTreeWidth,
          details: usableWidth - nextTreeWidth - activityWidth,
          activity: activityWidth,
        }));
        return;
      }

      const nextDetailsWidth = clamp(
        cursorX - treeWidth - DIVIDER_WIDTH,
        COLUMN_MINIMUMS.details,
        usableWidth - treeWidth - COLUMN_MINIMUMS.activity,
      );
      setPreferredRatios(normalizeColumnRatios({
        tree: treeWidth,
        details: nextDetailsWidth,
        activity: usableWidth - treeWidth - nextDetailsWidth,
      }));
    };

    const stopResizing = (event: PointerEvent) => {
      if (event.pointerId === resizeState.pointerId) setResizeState({ kind: 'idle' });
    };
    const cancelResizing = () => setResizeState({ kind: 'idle' });

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResizing);
    window.addEventListener('pointercancel', stopResizing);
    window.addEventListener('blur', cancelResizing);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopResizing);
      window.removeEventListener('pointercancel', stopResizing);
      window.removeEventListener('blur', cancelResizing);
    };
  }, [resizeState]);

  const clockNeeded = live !== null || groups.some((g) => g.liveExpiresAt !== null);
  useEffect(() => {
    if (!clockNeeded) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [clockNeeded]);

  useEffect(() => {
    if (!live) return;
    const timer = window.setTimeout(() => {
      setLive(null);
      void load();
    }, Math.max(0, live.expiresAt - Date.now()) + 500);
    return () => window.clearTimeout(timer);
  }, [live?.expiresAt, live?.sessionId]);

  const originalFileSessionActive = live?.mode === 'original-files' && live.expiresAt > now;

  const pathById = useMemo(() => new Map(groups.map((g) => [g.id, g.path])), [groups]);

  const selectedFile = useMemo<ManagedFile | null>(() => {
    if (!detail) return null;
    return detail.files.find((file) => file.id === selectedFileId) ?? detail.files[0] ?? null;
  }, [detail, selectedFileId]);

  const unrecognizedOpaqueCount = useMemo(
    () => detail?.files.filter(file => file.format === 'opaque' && file.entries.length === 0).length ?? 0,
    [detail],
  );

  useEffect(() => {
    if (!detail) return;
    const nextSelectedFileId = selectedFile?.id ?? null;
    if (selectedFileId !== nextSelectedFileId) setSelectedFileId(nextSelectedFileId);
  }, [detail, selectedFile, selectedFileId]);

  const selectGroup = async (id: string, fileId: string | null = null) => {
    setSelectedId(id);
    setSelectedFileId(fileId);
    setDetail(null);
    const report = await call<GroupStatusReport>('credentials:get-group', id);
    if (report) setDetail(report);
  };

  const openGroupDraft = async (parentId: string | null) => {
    if (parentId !== null) {
      setGroupDraft({ parentId, name: '', kind: 'generic', scope: 'project', rootPath: null });
      return;
    }
    const rootPath = await call<string>('credentials:choose-directory');
    if (!rootPath) return;
    setGroupDraft({
      parentId: null,
      name: nativeBasename(rootPath),
      kind: 'generic',
      scope: 'project',
      rootPath,
    });
  };

  const createGroup = async (draft: GroupDraft) => {
    const created = await call<GroupSummary>('credentials:create-group', {
      parentId: draft.parentId,
      name: draft.name.trim(),
      kind: draft.kind,
      scope: draft.scope,
      rootPath: draft.rootPath,
    });
    setGroupDraft(null);
    if (created) {
      setSelectedId(created.id);
      setSelectedFileId(null);
      setBanner({ kind: 'info', text: `Created ${created.name || draft.name.trim()}` });
    }
    await refresh(created?.id ?? selectedId);
  };

  const removeGroup = async (group: GroupSummary) => {
    if (!confirm(`Delete the credential group "${group.name}"? Its files stay on disk in whatever form they are in now.`)) return;
    await call('credentials:delete-group', group.id);
    const nextSelected = selectedId === group.id ? null : selectedId;
    if (nextSelected === null) {
      setSelectedId(null);
      setSelectedFileId(null);
      setDetail(null);
    }
    await refresh(nextSelected);
  };

  const addFiles = async (groupId: string) => {
    const paths = await call<string[]>('credentials:choose-files');
    if (!paths || paths.length === 0) return;
    const result = await call<{ imported: number; skipped: number; errors: string[] }>(
      'credentials:import-files', groupId, paths,
    );
    if (result) {
      const errors = result.errors || [];
      setBanner({
        kind: errors.length ? 'error' : 'info',
        text: `Imported ${result.imported ?? 0}, skipped ${result.skipped ?? 0}${errors.length ? `. ${errors.join('; ')}` : ''}`,
      });
    }
    await refresh(groupId);
  };

  const repairUnrecognizedOpaque = async (groupId: string) => {
    if (!confirm(
      `Protect ${unrecognizedOpaqueCount} previously unrecognized file(s)? `
      + 'Tiginal will encrypt their current contents and replace each file with FAKE_SECRET.',
    )) return;

    const result = await call<{ importedFiles: number; importedSecrets: number; errors: string[] }>(
      'credentials:repair-unrecognized-opaque',
      groupId,
    );
    if (result) {
      setBanner({
        kind: result.errors.length > 0 ? 'error' : 'info',
        text: `Protected ${result.importedFiles} file(s) with ${result.importedSecrets} stored secret(s)`
          + (result.errors.length > 0 ? `. ${result.errors.join('; ')}` : ''),
      });
    }
    await refresh(groupId);
  };

  const openScan = async (group: GroupSummary) => {
    const rootPath = await call<string>('credentials:choose-directory');
    if (!rootPath) return;
    const results = (await call<ScanResult[]>('credentials:scan-project', rootPath)) || [];
    setScan({
      groupId: group.id,
      rootPath,
      results,
      selected: new Set(results.map((r) => r.absolutePath)),
    });
  };

  const toggleScanFile = (absolutePath: string) => {
    setScan((prev) => {
      if (!prev) return prev;
      const selected = new Set(prev.selected);
      if (selected.has(absolutePath)) selected.delete(absolutePath);
      else selected.add(absolutePath);
      return { ...prev, selected };
    });
  };

  const importScan = async (draft: ScanDraft) => {
    setScan(null);
    const result = await call<{ imported: number; skipped: number; errors: string[] }>(
      'credentials:import-files', draft.groupId, [...draft.selected],
    );
    if (result) {
      const errors = result.errors || [];
      setBanner({
        kind: errors.length ? 'error' : 'info',
        text: `Imported ${result.imported ?? 0}, skipped ${result.skipped ?? 0}${errors.length ? `. ${errors.join('; ')}` : ''}`,
      });
    }
    await refresh(draft.groupId);
  };

  const materializeSafe = async (groupId: string) => {
    const result = await call<unknown>('credentials:materialize-safe', groupId);
    if (result) {
      setBanner({
        kind: 'info',
        text: Array.isArray(result)
          ? `Safe values written for ${result.length} file(s)`
          : 'Safe values written',
      });
    }
    await refresh(groupId);
  };

  const setInjection = async (file: ManagedFile, injection: Injection) => {
    await call('credentials:set-file-injection', file.id, injection, file.swapDuringSession);
    await refresh(selectedId);
  };

  const setSwap = async (file: ManagedFile, nextValue: boolean) => {
    await call('credentials:set-file-injection', file.id, file.injection, nextValue);
    await refresh(selectedId);
  };

  const inspectFile = async (file: ManagedFile) => {
    const result = await call<InspectResult>('credentials:inspect-file', file.id);
    if (!result) return;
    setDetail((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        files: prev.files.map((f) => f.id !== file.id ? f : {
          ...f,
          state: result.state || f.state,
          entries: result.keys
            ? result.keys.map((k) => ({ id: `${f.id}:${k.key}`, keyName: k.key, secretType: k.secretType }))
            : f.entries,
        }),
      };
    });
  };

  const removeFile = async (file: ManagedFile) => {
    if (!confirm(`Stop managing "${file.relativePath}"? The file is left on disk in its safe form, with placeholders where the secrets were.`)) return;
    await call('credentials:remove-file', file.id, true);
    if (selectedFileId === file.id) setSelectedFileId(null);
    await refresh(selectedId);
  };

  const restoreSafe = async (file: ManagedFile) => {
    const state = await call<FileState>('credentials:restore-safe', file.id);
    setDrift(null);
    if (state) setBanner({ kind: 'info', text: `${file.relativePath} is back in its safe form` });
    await refresh(selectedId);
  };

  const importDrift = async (file: ManagedFile) => {
    const result = await call<{ updated: number }>('credentials:import-drift', file.id);
    setDrift(null);
    if (result) {
      setBanner({ kind: 'info', text: `${result.updated ?? 0} key(s) taken from ${file.relativePath} and stored` });
    }
    await refresh(selectedId);
  };

  const openActivate = (group: GroupSummary) => {
    setActivate({
      rootId: group.id,
      selected: new Set(descendantsOf(groups, group).map((g) => g.id)),
      ttlMinutes: 15,
      mode: 'original-files',
    });
  };

  const toggleActivateGroup = (id: string) => {
    setActivate((prev) => {
      if (!prev) return prev;
      const selected = new Set(prev.selected);
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
      return { ...prev, selected };
    });
  };

  const beginSession = async (draft: ActivateDraft) => {
    const ttlMs = draft.ttlMinutes * 60_000;
    const root = groups.find((g) => g.id === draft.rootId);
    const request: CredentialUiSessionRequest = {
      groupId: draft.rootId,
      ttlMs,
      groupIds: [draft.rootId, ...draft.selected],
      mode: draft.mode,
    };
    const grant = await call<CredentialUiSessionGrant>('credentials:begin-session', request);
    setActivate(null);
    if (grant && grant.sessionId) {
      setLive({
        sessionId: grant.sessionId,
        groupPath: root?.path || draft.rootId,
        expiresAt: grant.expiresAt ?? Date.now() + ttlMs,
        mode: grant.mode,
      });
    }
    await refresh(selectedId);
  };

  const revokeSession = async (session: LiveSession) => {
    await call('credentials:revoke-session', session.sessionId);
    setLive(null);
    await load();
  };

  const paginate = <T,>(items: T[], page: number) => items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = (total: number) => Math.ceil(total / PAGE_SIZE);

  const pagedSessions = paginate(sessions, sessionPage);
  const pagedAudit = paginate(audit, auditPage);

  const activateRoot = activate ? groups.find((g) => g.id === activate.rootId) ?? null : null;
  const activateDescendants = activateRoot ? descendantsOf(groups, activateRoot) : [];
  const driftFile = drift && detail ? detail.files.find((f) => f.id === drift.fileId) ?? null : null;
  const driftState = driftFile && driftFile.state.kind === 'drifted' ? driftFile.state : null;

  const groupPill = (group: GroupSummary) => {
    if (group.liveExpiresAt !== null && group.liveExpiresAt > now) {
      return (
        <span className={clsx(PILL, GREEN_PILL)}>LIVE {minutesLeft(group.liveExpiresAt - now)}m</span>
      );
    }
    const pill = GROUP_PILLS[group.status === 'live' ? 'safe' : group.status] ?? GROUP_PILLS.safe;
    return <span className={clsx(PILL, pill.className)}>{pill.label}</span>;
  };

  const filePill = (state: FileState) => {
    const pill = FILE_PILLS[state.kind] ?? FILE_PILLS.unmanaged;
    return <span className={clsx(PILL, pill.className)}>{pill.label}</span>;
  };

  const pager = (total: number, page: number, setPage: (next: number) => void) => (
    totalPages(total) > 1 ? (
      <div className="flex items-center justify-center gap-2 mt-2">
        <button
          onClick={() => setPage(Math.max(0, page - 1))}
          disabled={page === 0}
          className="p-1 rounded hover:bg-surface-light disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="text-xs text-text-muted">{page + 1} / {totalPages(total)}</span>
        <button
          onClick={() => setPage(Math.min(totalPages(total) - 1, page + 1))}
          disabled={page >= totalPages(total) - 1}
          className="p-1 rounded hover:bg-surface-light disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ChevronRight size={16} />
        </button>
      </div>
    ) : null
  );

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-background">
      <div className="shrink-0 space-y-3 border-b border-border px-5 py-4">
        <SettingsPageHeader icon={<KeyRound size={24} />} title="Credentials" />

        {live && live.expiresAt > now && (
          <div className="flex items-center gap-3 rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-2.5">
            <Zap size={14} className="shrink-0 text-green-400" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-text-main">
                {live.mode === 'original-files' ? 'Real values active for ' : 'CLI session authorized for '}
                <span className="font-mono">{live.groupPath}</span>
              </div>
              <p className="text-[11px] text-text-muted">
                {live.mode === 'original-files' ? (
                  <>Passwords are present at their original file paths. Revoke or let the timer expire to restore FAKE_SECRET.</>
                ) : (
                  <>Run <span className="font-mono">tiginal cred run {live.groupPath} -- &lt;command&gt;</span> to use this authorization.</>
                )}
              </p>
            </div>
            <span className="shrink-0 font-mono text-sm text-green-400">{countdown(live.expiresAt - now)}</span>
            <button
              onClick={() => revokeSession(live)}
              disabled={busy}
              className="shrink-0 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-text-main transition-colors hover:border-red-500/50 hover:text-red-400 disabled:opacity-50"
            >
              Revoke
            </button>
          </div>
        )}

        {banner && (
          <div
            className={clsx(
              'flex items-start justify-between gap-3 rounded-lg border px-4 py-2 text-xs',
              banner.kind === 'info'
                ? 'border-primary/30 bg-primary/10 text-text-main'
                : 'border-red-500/30 bg-red-500/10 text-red-400',
            )}
          >
            <span className="min-w-0 break-words">{banner.text}</span>
            <button onClick={() => setBanner(null)} className="shrink-0 text-text-muted hover:text-text-main">
              Dismiss
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        <div
          ref={workspaceRef}
          className="grid h-full min-h-0 w-full"
          style={{
            minWidth: MIN_WORKSPACE_WIDTH,
            gridTemplateColumns: `minmax(${COLUMN_MINIMUMS.tree}px, ${fittedRatios.tree}fr) ${DIVIDER_WIDTH}px minmax(${COLUMN_MINIMUMS.details}px, ${fittedRatios.details}fr) ${DIVIDER_WIDTH}px minmax(${COLUMN_MINIMUMS.activity}px, ${fittedRatios.activity}fr)`,
          }}
        >
          <aside ref={treePaneRef} className="flex min-h-0 min-w-0 flex-col gap-3 overflow-hidden bg-surface p-3">
            <div className="flex shrink-0 items-center justify-between gap-2">
              <div className="min-w-0">
                <h3 className="flex items-center gap-2 text-sm font-medium text-text-main">
                  <FolderTree size={15} className="shrink-0 text-primary" />
                  Credential files
                </h3>
                <p className="text-[11px] text-text-muted">Physical locations on this computer</p>
              </div>
              <button
                onClick={() => openGroupDraft(null)}
                disabled={busy}
                title="Add project"
                className="rounded-lg bg-primary p-2 text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                <Plus size={14} />
              </button>
            </div>

            {groups.length > 0 && (
              <select
                aria-label="Credential group"
                value={selectedId ?? ''}
                onChange={(event) => void selectGroup(event.target.value)}
                className="w-full shrink-0 rounded-lg border border-border bg-background px-2 py-2 text-xs text-text-main outline-none focus:border-primary"
              >
                {groups.map(group => (
                  <option key={group.id} value={group.id}>
                    {`${'  '.repeat(group.depth)}${group.path}`}
                  </option>
                ))}
              </select>
            )}

            <div className="min-h-[240px] flex-1 overflow-hidden rounded-lg border border-border bg-background">
              {locations.length === 0 ? (
                <div className="flex h-full items-center justify-center px-5 text-center text-xs text-text-muted">
                  No credential files yet. Select a group, then add or scan files.
                </div>
              ) : (
                <CredentialLocationTree
                  locations={locations}
                  selectedFileId={selectedFileId}
                  onSelect={(location) => void selectGroup(location.groupId, location.id)}
                />
              )}
            </div>

            {selectedFileId && (
              <p className="shrink-0 break-all font-mono text-[10px] leading-4 text-text-muted">
                {locations.find(location => location.id === selectedFileId)?.absolutePath}
              </p>
            )}
          </aside>

          <div
            role="separator"
            aria-label="Resize credential tree and file details"
            aria-orientation="vertical"
            onPointerDown={(event) => startResizing('tree-details', event)}
            className={clsx(
              'relative z-20 h-full cursor-col-resize touch-none transition-colors hover:bg-primary',
              resizeState.kind === 'dragging' && resizeState.divider === 'tree-details'
                ? 'bg-primary'
                : 'bg-border',
            )}
          >
            <div className="absolute inset-y-0 -left-1 w-3" />
          </div>

          <section ref={detailsPaneRef} className="min-h-0 min-w-0 overflow-y-auto bg-background p-4">
            {!selectedId ? (
              <div className={EMPTY}>Add a project to start managing credential files.</div>
            ) : !detail ? (
              <div className={EMPTY}>Nothing loaded for this group.</div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-3 border-b border-border pb-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate text-sm font-medium text-text-main">{detail.group.name}</h3>
                        {groupPill(detail.group)}
                      </div>
                      <p className="truncate font-mono text-[11px] text-text-muted">{detail.group.path}</p>
                      <p className="text-[11px] text-text-muted">
                        {detail.group.fileCount} files, {detail.group.secretCount} secrets
                      </p>
                    </div>
                    <button
                      onClick={() => removeGroup(detail.group)}
                      disabled={busy || originalFileSessionActive}
                      title="Delete group"
                      className="p-2 text-text-muted transition-colors hover:text-red-400 disabled:opacity-50"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button onClick={() => openGroupDraft(detail.group.id)} disabled={busy} className={BTN_SUBTLE}>
                      <Plus size={14} /> Add Group
                    </button>
                    <button onClick={() => addFiles(detail.group.id)} disabled={busy || originalFileSessionActive} className={BTN_SUBTLE}>
                      <FilePlus size={14} /> Add Files
                    </button>
                    {detail.group.depth === 0 && (
                      <button onClick={() => openScan(detail.group)} disabled={busy || originalFileSessionActive} className={BTN_SUBTLE}>
                        <Search size={14} /> Scan Directory
                      </button>
                    )}
                    <button onClick={() => materializeSafe(detail.group.id)} disabled={busy || originalFileSessionActive} className={BTN_SUBTLE}>
                      <ShieldCheck size={14} /> Materialize Safe
                    </button>
                    {unrecognizedOpaqueCount > 0 && (
                      <button
                        onClick={() => repairUnrecognizedOpaque(detail.group.id)}
                        disabled={busy || originalFileSessionActive}
                        className="flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-400 transition-colors hover:bg-amber-500/20 disabled:opacity-50"
                      >
                        <AlertTriangle size={14} />
                        Protect {unrecognizedOpaqueCount} Unrecognized
                      </button>
                    )}
                    <button onClick={() => openActivate(detail.group)} disabled={busy || originalFileSessionActive} className={BTN_SUBTLE}>
                      <Zap size={14} /> Authorize Session
                    </button>
                  </div>
                </div>

                {!selectedFile ? (
                  <div className={EMPTY}>No files in this group yet. Add files to put their secrets under management.</div>
                ) : (
                  <div className="space-y-4 rounded-lg border border-primary/50 bg-surface p-4">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <h4 className="break-all font-mono text-sm text-text-main">{selectedFile.relativePath}</h4>
                        <p className="mt-1 break-all font-mono text-[10px] text-text-muted">{selectedFile.absolutePath}</p>
                      </div>
                      <span className={clsx(PILL, NEUTRAL_PILL)}>{selectedFile.format}</span>
                      {filePill(selectedFile.state)}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <label className="text-[11px] text-text-sec">Injection</label>
                      <select
                        value={selectedFile.injection}
                        onChange={(event) => setInjection(selectedFile, event.target.value as Injection)}
                        className="rounded-lg border border-border bg-background px-2 py-1 text-xs text-text-main outline-none focus:border-primary"
                      >
                        {INJECTIONS.map((mode) => <option key={mode} value={mode}>{mode}</option>)}
                      </select>
                      <button onClick={() => inspectFile(selectedFile)} disabled={busy} className={BTN_SUBTLE}>Inspect</button>
                      {selectedFile.state.kind === 'drifted' && !originalFileSessionActive && (
                        <>
                          <button onClick={() => setDrift({ fileId: selectedFile.id, armed: false })} className={BTN_SUBTLE}>
                            Review Changes
                          </button>
                          <button onClick={() => restoreSafe(selectedFile)} disabled={busy || originalFileSessionActive} className={BTN_SUBTLE}>
                            Restore Safe
                          </button>
                          <button onClick={() => setDrift({ fileId: selectedFile.id, armed: true })} disabled={originalFileSessionActive} className={BTN_SUBTLE}>
                            Import Changes
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => removeFile(selectedFile)}
                        disabled={busy || originalFileSessionActive}
                        className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-text-main transition-colors hover:border-red-500/50 hover:text-red-400 disabled:opacity-50"
                      >
                        Remove
                      </button>
                    </div>

                    <div className="space-y-1.5 border-t border-border pt-3">
                      <div className="flex items-center gap-2">
                        <Toggle
                          checked={selectedFile.swapDuringSession}
                          onChange={(next) => setSwap(selectedFile, next)}
                          disabled={originalFileSessionActive}
                          label="Swap real values into this file during a session"
                          size="small"
                        />
                        <span className="text-[11px] text-text-main">Swap real values into this file during a session</span>
                      </div>
                      <p className="text-[11px] text-amber-400">
                        With this on, a live session writes the real secrets to this exact path.
                        Anything that can read the file during that window reads the real values, agents included.
                        Leave it off unless a tool hard-codes the path and gives you no way to point it elsewhere.
                      </p>
                    </div>

                    <div className="space-y-1.5 border-t border-border pt-3">
                      <h4 className="text-xs font-medium text-text-sec">Masked entries</h4>
                      {selectedFile.entries.length === 0 ? (
                        <p className="text-[11px] text-text-muted">Inspect this file to load its key names.</p>
                      ) : selectedFile.entries.map((entry) => (
                        <div key={entry.id} className="flex items-center gap-2 text-[11px]">
                          <span className="min-w-0 flex-1 truncate font-mono text-text-main">{entry.keyName}</span>
                          <span className={clsx(PILL, MUTED_PILL)}>{entry.secretType}</span>
                          <span className="font-mono text-text-muted">********</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>

          <div
            role="separator"
            aria-label="Resize file details and sessions"
            aria-orientation="vertical"
            onPointerDown={(event) => startResizing('details-activity', event)}
            className={clsx(
              'relative z-20 h-full cursor-col-resize touch-none transition-colors hover:bg-primary',
              resizeState.kind === 'dragging' && resizeState.divider === 'details-activity'
                ? 'bg-primary'
                : 'bg-border',
            )}
          >
            <div className="absolute inset-y-0 -left-1 w-3" />
          </div>

          <aside ref={activityPaneRef} className="min-h-0 min-w-0 space-y-4 overflow-y-auto bg-surface p-3">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-medium text-text-main">
                <History size={15} className="text-primary" />
                Sessions
              </h3>
              <p className="text-[11px] text-text-muted">Live access and credential history</p>
            </div>

            <div className="space-y-1.5 rounded-lg border border-border bg-background p-3 text-[11px] text-text-muted">
              <div className="flex items-center justify-between gap-2">
                <span>CLI</span>
                <span className={clsx(PILL, cli?.installed ? GREEN_PILL : MUTED_PILL)}>
                  {cli?.installed ? 'INSTALLED' : 'NOT INSTALLED'}
                </span>
              </div>
              <p className="break-all font-mono text-text-main">{cli?.socketPath || 'Socket not reported'}</p>
            </div>

            <div className="space-y-2">
              {sessions.length === 0 ? (
                <div className={EMPTY}>No sessions yet. Start a file session or authorize a CLI command.</div>
              ) : pagedSessions.map((session) => (
                <div key={session.id} className="space-y-1 rounded-lg border border-border bg-background p-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate font-mono text-text-main">
                      {pathById.get(session.groupId) || session.groupId}
                    </span>
                    <span className="shrink-0 text-text-muted">{session.status}</span>
                  </div>
                  <p className="text-[11px] text-text-muted">{new Date(session.createdAt).toLocaleString()}</p>
                  <p className="truncate font-mono text-[11px] text-text-muted">
                    {session.approvedBy === 'ui-original-files'
                      ? 'original file paths'
                      : session.commandSummary || 'CLI authorization'}
                  </p>
                  <div className="flex items-center justify-between text-[11px] text-text-muted">
                    <span>{Math.round((session.expiresAt - session.createdAt) / 60000)} minutes</span>
                    {typeof session.exitCode === 'number' && <span>exit {session.exitCode}</span>}
                  </div>
                </div>
              ))}
              {pager(sessions.length, sessionPage, setSessionPage)}
            </div>

            <div className="space-y-2 border-t border-border pt-4">
              <h4 className="text-xs font-medium text-text-sec">History</h4>
              {audit.length === 0 ? (
                <div className={EMPTY}>No credential history recorded yet.</div>
              ) : pagedAudit.map((record) => (
                <div key={record.id} className="space-y-1 rounded-lg border border-border bg-background p-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate font-mono text-text-main">{record.event}</span>
                    <span className="shrink-0 text-[11px] text-text-muted">
                      {new Date(record.at).toLocaleString()}
                    </span>
                  </div>
                  {record.groupId && (
                    <p className="truncate font-mono text-[11px] text-text-muted">
                      {pathById.get(record.groupId) || record.groupId}
                    </p>
                  )}
                  <p className="break-words text-[11px] text-text-muted">{record.detail}</p>
                </div>
              ))}
              {pager(audit.length, auditPage, setAuditPage)}
            </div>
          </aside>
        </div>
      </div>

      {resizeState.kind === 'dragging' && (
        <div className="absolute inset-0 z-50 cursor-col-resize select-none" />
      )}

      <Modal
        isOpen={activate !== null && activateRoot !== null}
        onClose={() => setActivate(null)}
        title="Authorize credential session"
        width="max-w-lg"
      >
        {activate && activateRoot && (
          <div>
            <div className="p-4 space-y-4">
              <div>
                <div className="text-[11px] text-text-sec mb-1">Project</div>
                <div className="text-sm text-text-main">{activateRoot.name}</div>
                <div className="text-[11px] font-mono text-text-muted">{activateRoot.path}</div>
              </div>

              <div>
                <div className="text-[11px] text-text-sec mb-1.5">Access</div>
                <div className="space-y-2">
                  <label className={clsx(
                    'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors',
                    activate.mode === 'original-files'
                      ? 'border-primary bg-primary/10'
                      : 'border-border bg-background hover:border-primary/50',
                  )}>
                    <input
                      type="radio"
                      name="credential-session-mode"
                      checked={activate.mode === 'original-files'}
                      onChange={() => setActivate({ ...activate, mode: 'original-files' })}
                      className="mt-0.5 accent-primary"
                    />
                    <span>
                      <span className="block text-sm text-text-main">Write to original files</span>
                      <span className="mt-0.5 block text-[11px] leading-4 text-text-muted">
                        Restore real values at the managed paths now, then put FAKE_SECRET back on revoke or timeout.
                      </span>
                    </span>
                  </label>
                  <label className={clsx(
                    'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors',
                    activate.mode === 'cli-authorization'
                      ? 'border-primary bg-primary/10'
                      : 'border-border bg-background hover:border-primary/50',
                  )}>
                    <input
                      type="radio"
                      name="credential-session-mode"
                      checked={activate.mode === 'cli-authorization'}
                      onChange={() => setActivate({ ...activate, mode: 'cli-authorization' })}
                      className="mt-0.5 accent-primary"
                    />
                    <span>
                      <span className="block text-sm text-text-main">Authorize CLI command</span>
                      <span className="mt-0.5 block text-[11px] leading-4 text-text-muted">
                        Keep files masked and authorize the next matching tiginal cred run command.
                      </span>
                    </span>
                  </label>
                </div>
              </div>

              <div>
                <div className="text-[11px] text-text-sec mb-1.5">Groups</div>
                <div className="space-y-1.5">
                  <label className="flex items-center gap-2 text-sm text-text-main">
                    <input type="checkbox" checked readOnly disabled className="accent-primary" />
                    <span>{activateRoot.name}</span>
                    <span className={clsx(PILL, NEUTRAL_PILL)}>session root</span>
                  </label>
                  {activateDescendants.map((group) => (
                    <label
                      key={group.id}
                      style={{ paddingLeft: (group.depth - activateRoot.depth) * 16 }}
                      className="flex items-center gap-2 text-sm text-text-main"
                    >
                      <input
                        type="checkbox"
                        checked={activate.selected.has(group.id)}
                        onChange={() => toggleActivateGroup(group.id)}
                        className="accent-primary"
                      />
                      <span>{group.name}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label htmlFor="credentials-ttl" className="block text-[11px] text-text-sec mb-1.5">Duration</label>
                <select
                  id="credentials-ttl"
                  value={activate.ttlMinutes}
                  onChange={(e) => setActivate({ ...activate, ttlMinutes: Number(e.target.value) })}
                  className={FIELD}
                >
                  {TTL_CHOICES.map((minutes) => (
                    <option key={minutes} value={minutes}>{minutes} minutes</option>
                  ))}
                </select>
              </div>

              <p className="rounded-lg border border-border bg-background p-3 text-[11px] leading-5 text-text-muted">
                {activate.mode === 'original-files' ? (
                  <>
                    Real passwords will be readable by any process that can access these files until the session ends.
                    Tiginal restores the masked copies on revoke, timeout, normal app exit, or next startup after a crash.
                  </>
                ) : (
                  <>
                    This only authorizes the next matching <span className="font-mono">tiginal cred run</span> command.
                    It does not rewrite the managed files now.
                  </>
                )}
              </p>

              {activate.mode === 'original-files' && unrecognizedOpaqueCount > 0 && (
                <p className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-[11px] leading-5 text-amber-400">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                  <span>
                    Protect the {unrecognizedOpaqueCount} unrecognized file(s) first. Tiginal cannot restore a value
                    that was never encrypted and stored.
                  </span>
                </p>
              )}
            </div>

            <div className="px-4 py-3 border-t border-border flex justify-end gap-2">
              <button onClick={() => setActivate(null)} className={BTN_MODAL}>Cancel</button>
              <button
                onClick={() => beginSession(activate)}
                disabled={busy || (activate.mode === 'original-files' && unrecognizedOpaqueCount > 0)}
                className={BTN_MODAL_PRIMARY}
              >
                {activate.mode === 'original-files' ? 'Start File Session' : 'Authorize CLI'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={drift !== null && driftState !== null}
        onClose={() => setDrift(null)}
        title="Review changes"
        width="max-w-lg"
      >
        {drift && driftFile && driftState && (
          <div>
            <div className="p-4 space-y-4">
              <div>
                <p className="text-xs font-mono text-text-main break-all">{driftFile.relativePath}</p>
                <p className="text-[11px] text-text-muted mt-1">
                  Key names only. Values are never read into the app.
                </p>
              </div>

              <div>
                <div className="text-[11px] text-text-sec mb-1.5">Changed keys</div>
                {driftState.changedKeys.length === 0 ? (
                  <p className="text-[11px] text-text-muted">None</p>
                ) : (
                  <div className="space-y-1">
                    {driftState.changedKeys.map((key) => (
                      <div key={key} className="text-[11px] font-mono text-text-main">{key}</div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <div className="text-[11px] text-text-sec mb-1.5">Keys no longer in the file</div>
                {driftState.missingKeys.length === 0 ? (
                  <p className="text-[11px] text-text-muted">None</p>
                ) : (
                  <div className="space-y-1">
                    {driftState.missingKeys.map((key) => (
                      <div key={key} className="text-[11px] font-mono text-text-main">{key}</div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="px-4 py-3 border-t border-border space-y-3">
              {drift.armed ? (
                <>
                  <p className="text-[11px] text-amber-400 flex items-start gap-1.5">
                    <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                    <span>
                      Whatever value sits in this file right now becomes the new stored secret for every
                      changed key. The values stored before this are replaced and cannot be recovered.
                    </span>
                  </p>
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setDrift({ ...drift, armed: false })} className={BTN_MODAL}>
                      Cancel
                    </button>
                    <button
                      onClick={() => importDrift(driftFile)}
                      disabled={busy}
                      className="px-4 py-2 text-sm bg-amber-500/20 border border-amber-500/40 text-amber-400 rounded-lg hover:bg-amber-500/30 transition-colors disabled:opacity-50"
                    >
                      Confirm Import
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex justify-end gap-2">
                  <button onClick={() => setDrift(null)} className={BTN_MODAL}>Close</button>
                  <button onClick={() => restoreSafe(driftFile)} disabled={busy} className={BTN_MODAL}>
                    Restore Safe
                  </button>
                  <button onClick={() => setDrift({ ...drift, armed: true })} className={BTN_MODAL_PRIMARY}>
                    Import Changes
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={groupDraft !== null}
        onClose={() => setGroupDraft(null)}
        title={groupDraft && groupDraft.parentId === null ? 'Add project' : 'Add group'}
      >
        {groupDraft && (
          <div>
            <div className="p-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-text-sec mb-1.5">Name</label>
                <input
                  type="text"
                  value={groupDraft.name}
                  onChange={(e) => setGroupDraft({ ...groupDraft, name: e.target.value })}
                  placeholder="e.g. Acme App"
                  className={clsx(FIELD, 'w-full')}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-text-sec mb-1.5">Kind</label>
                <select
                  value={groupDraft.kind}
                  onChange={(e) => setGroupDraft({ ...groupDraft, kind: e.target.value as GroupKind })}
                  className={clsx(FIELD, 'w-full')}
                >
                  {GROUP_KINDS.map((kind) => (
                    <option key={kind} value={kind}>{kind}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-text-sec mb-1.5">Scope</label>
                <select
                  value={groupDraft.scope}
                  onChange={(e) => setGroupDraft({ ...groupDraft, scope: e.target.value as GroupScope })}
                  className={clsx(FIELD, 'w-full')}
                >
                  {GROUP_SCOPES.map((scope) => (
                    <option key={scope} value={scope}>{scope}</option>
                  ))}
                </select>
              </div>

              {groupDraft.rootPath !== null && (
                <div>
                  <label className="block text-xs font-medium text-text-sec mb-1.5">Project root</label>
                  <p className="text-[11px] font-mono text-text-muted break-all">{groupDraft.rootPath}</p>
                </div>
              )}
            </div>

            <div className="px-4 py-3 border-t border-border flex justify-end gap-2">
              <button onClick={() => setGroupDraft(null)} className={BTN_MODAL}>Cancel</button>
              <button
                onClick={() => createGroup(groupDraft)}
                disabled={busy || groupDraft.name.trim().length === 0}
                className={BTN_MODAL_PRIMARY}
              >
                Create
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={scan !== null}
        onClose={() => setScan(null)}
        title="Scan results"
        width="max-w-lg"
      >
        {scan && (
          <div>
            <div className="p-4 space-y-3">
              <p className="text-[11px] font-mono text-text-muted break-all">{scan.rootPath}</p>
              {scan.results.length === 0 ? (
                <div className={EMPTY}>No credential files found under this path.</div>
              ) : (
                scan.results.map((result) => (
                  <label key={result.absolutePath} className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={scan.selected.has(result.absolutePath)}
                      onChange={() => toggleScanFile(result.absolutePath)}
                      className="accent-primary shrink-0"
                    />
                    <span className="flex-1 min-w-0 font-mono text-text-main truncate">{result.relativePath}</span>
                    <span className={clsx(PILL, NEUTRAL_PILL)}>{result.format}</span>
                    <span className={clsx(PILL, MUTED_PILL)}>{result.suggestedKind}</span>
                  </label>
                ))
              )}
            </div>

            <div className="px-4 py-3 border-t border-border flex justify-end gap-2">
              <button onClick={() => setScan(null)} className={BTN_MODAL}>Cancel</button>
              <button
                onClick={() => importScan(scan)}
                disabled={busy || scan.selected.size === 0}
                className={BTN_MODAL_PRIMARY}
              >
                Import {scan.selected.size} file(s)
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
