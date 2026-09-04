import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { clsx } from 'clsx';
import {
  KeyRound, FolderTree, Plus, FileCode, Fingerprint, Zap, Trash2, ShieldCheck, AlertTriangle,
} from 'lucide-react';
import { SettingsPageHeader } from './SettingsPageHeader';
import { CredentialLocationTree } from './CredentialLocationTree';
import { ProjectPicker } from './ProjectPicker';
import { AddProjectDialog } from './AddProjectDialog';
import { FileContentPanel } from './FileContentPanel';
import { AuthorizeSessionDialog } from './AuthorizeSessionDialog';
import { DriftReviewDialog } from './DriftReviewDialog';
import { CredentialActivityPane } from './CredentialActivityPane';
import {
  PILL, NEUTRAL_PILL, MUTED_PILL, GREEN_PILL, GROUP_PILLS, FILE_PILLS,
  BTN_SUBTLE, EMPTY,
} from './credentialStyles';
import type { NewProjectInput } from './AddProjectDialog';
import type { CredentialCall, ManagedFile } from './FileContentPanel';
import type { ActivateDraft } from './AuthorizeSessionDialog';
import type {
  AuditRecord, CredentialFileLocation, CredentialSession, CredentialUiSessionGrant,
  CredentialUiSessionMode, CredentialUiSessionRequest, FileKind, FileState,
  GroupStatusReport, GroupSummary, SecretType,
} from '../../../shared/credentials/types';

type CredentialDivider = 'tree-details' | 'details-activity';

type ResizeState =
  | { kind: 'idle' }
  | { kind: 'dragging'; divider: CredentialDivider; pointerId: number };

interface ColumnRatios {
  tree: number;
  details: number;
  activity: number;
}

interface InspectResult {
  state: FileState;
  keys: Array<{ key: string; secretType: SecretType; masked: true }>;
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

const CREDENTIALS_LAYOUT_KEY = 'credentials-layout-config-v1';
const DIVIDER_WIDTH = 1;
const COLUMN_MINIMUMS = { tree: 220, details: 320, activity: 280 };
const MIN_WORKSPACE_WIDTH = COLUMN_MINIMUMS.tree
  + COLUMN_MINIMUMS.details
  + COLUMN_MINIMUMS.activity
  + DIVIDER_WIDTH * 2;
const DEFAULT_COLUMN_RATIOS: ColumnRatios = { tree: 0.25, details: 0.45, activity: 0.3 };

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
  const [addingProject, setAddingProject] = useState(false);
  const [cli, setCli] = useState<{ socketPath: string; installed: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);
  const [preferredRatios, setPreferredRatios] = useState<ColumnRatios>(readColumnRatios);
  const [workspaceWidth, setWorkspaceWidth] = useState(MIN_WORKSPACE_WIDTH);
  const [resizeState, setResizeState] = useState<ResizeState>({ kind: 'idle' });
  const workspaceRef = useRef<HTMLDivElement>(null);
  const treePaneRef = useRef<HTMLElement>(null);
  const detailsPaneRef = useRef<HTMLElement>(null);
  const activityPaneRef = useRef<HTMLElement>(null);

  /** Stable so the detail pane's reveal effect is not refired by every parent render. */
  const call = useCallback<CredentialCall>(async <T,>(channel: string, ...args: unknown[]) => {
    const invoke = window.electron?.invoke;
    if (!invoke) return null;
    setBusy(true);
    try {
      return (await invoke(channel, ...args)) as T | null;
    } catch (e) {
      setBanner({ kind: 'error', text: cleanError(e) });
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

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

  const visibleLocations = useMemo(
    () => locations.filter((location) => location.groupId === selectedId),
    [locations, selectedId],
  );

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

  const createProject = async (input: NewProjectInput) => {
    const created = await call<GroupSummary>('credentials:create-group', {
      parentId: null,
      name: input.name,
      kind: 'generic',
      scope: input.scope,
      rootPath: input.rootPath,
    });
    setAddingProject(false);
    if (created) {
      setSelectedId(created.id);
      setSelectedFileId(null);
      setBanner({ kind: 'info', text: `Created ${created.name || input.name}` });
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

  const addFiles = async (groupId: string, kind: FileKind) => {
    const paths = await call<string[]>('credentials:choose-files');
    if (!paths || paths.length === 0) return;
    const result = await call<{ imported: number; skipped: number; errors: string[] }>(
      'credentials:import-files', groupId, paths, kind,
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
                onClick={() => setAddingProject(true)}
                disabled={busy}
                title="Add project"
                className="rounded-lg bg-primary p-2 text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                <Plus size={14} />
              </button>
            </div>

            <ProjectPicker
              groups={groups}
              selectedId={selectedId}
              onSelect={(groupId) => void selectGroup(groupId)}
              disabled={busy}
            />

            <div className="min-h-[240px] flex-1 overflow-hidden rounded-lg border border-border bg-background">
              {visibleLocations.length === 0 ? (
                <div className="flex h-full items-center justify-center px-5 text-center text-xs text-text-muted">
                  {selectedId === null
                    ? 'No projects yet. Use + to add one.'
                    : 'No credential files in this project yet. Use Add Key Files or Add ENV Files to put some under management.'}
                </div>
              ) : (
                <CredentialLocationTree
                  locations={visibleLocations}
                  selectedFileId={selectedFileId}
                  onSelect={(location) => void selectGroup(location.groupId, location.id)}
                />
              )}
            </div>

            {selectedFileId && (
              <p className="shrink-0 break-all font-mono text-[10px] leading-4 text-text-muted">
                {visibleLocations.find(location => location.id === selectedFileId)?.absolutePath}
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
                    <button onClick={() => addFiles(detail.group.id, 'key')} disabled={busy || originalFileSessionActive} className={BTN_SUBTLE}>
                      <KeyRound size={14} /> Add Key Files
                    </button>
                    <button onClick={() => addFiles(detail.group.id, 'env')} disabled={busy || originalFileSessionActive} className={BTN_SUBTLE}>
                      <FileCode size={14} /> Add ENV Files
                    </button>
                    {detail.group.scope === 'system' && (
                      <button onClick={() => addFiles(detail.group.id, 'ssh-key')} disabled={busy || originalFileSessionActive} className={BTN_SUBTLE}>
                        <Fingerprint size={14} /> Add SSH Private Key
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
                  <>
                    <div className="space-y-4 rounded-lg border border-primary/50 bg-surface p-4">
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <h4 className="break-all font-mono text-sm text-text-main">{selectedFile.relativePath}</h4>
                          <p className="mt-1 break-all font-mono text-[10px] text-text-muted">{selectedFile.absolutePath}</p>
                        </div>
                        <span className={clsx(PILL, NEUTRAL_PILL)}>{selectedFile.kind}</span>
                        {filePill(selectedFile.state)}
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
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

                    <FileContentPanel
                      file={selectedFile}
                      call={call}
                      onChanged={() => refresh(selectedId)}
                      disabled={originalFileSessionActive}
                      busy={busy}
                    />
                  </>
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

          <CredentialActivityPane
            ref={activityPaneRef}
            sessions={sessions}
            audit={audit}
            cli={cli}
            pathById={pathById}
          />
        </div>
      </div>

      {resizeState.kind === 'dragging' && (
        <div className="absolute inset-0 z-50 cursor-col-resize select-none" />
      )}

      <AuthorizeSessionDialog
        draft={activate}
        root={activateRoot}
        descendants={activateDescendants}
        unrecognizedOpaqueCount={unrecognizedOpaqueCount}
        busy={busy}
        onChange={setActivate}
        onClose={() => setActivate(null)}
        onConfirm={(draft) => void beginSession(draft)}
      />

      <DriftReviewDialog
        draft={drift}
        file={driftFile}
        state={driftState}
        busy={busy}
        onArmedChange={(armed) => setDrift((prev) => (prev === null ? null : { ...prev, armed }))}
        onClose={() => setDrift(null)}
        onRestoreSafe={() => { if (driftFile) void restoreSafe(driftFile); }}
        onImport={() => { if (driftFile) void importDrift(driftFile); }}
      />

      <AddProjectDialog
        isOpen={addingProject}
        busy={busy}
        onClose={() => setAddingProject(false)}
        onChooseDirectory={() => call<string>('credentials:choose-directory')}
        onCreate={(input) => void createProject(input)}
      />
    </div>
  );
}
