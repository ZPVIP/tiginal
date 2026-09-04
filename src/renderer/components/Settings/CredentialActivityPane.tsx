import React, { useState } from 'react';
import { clsx } from 'clsx';
import { ChevronLeft, ChevronRight, History } from 'lucide-react';
import { EMPTY, GREEN_PILL, MUTED_PILL, PILL } from './credentialStyles';
import type { AuditRecord, CredentialSession } from '../../../shared/credentials/types';

interface CredentialActivityPaneProps {
  sessions: CredentialSession[];
  audit: AuditRecord[];
  cli: { socketPath: string; installed: boolean } | null;
  /** Group id to group path, so a session or audit row can show the path instead of the id. */
  pathById: Map<string, string>;
}

const PAGE_SIZE = 10;

function paginate<T>(items: T[], page: number): T[] {
  return items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
}

function totalPages(total: number): number {
  return Math.ceil(total / PAGE_SIZE);
}

function pager(total: number, page: number, setPage: (next: number) => void) {
  return totalPages(total) > 1 ? (
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
  ) : null;
}

export const CredentialActivityPane = React.forwardRef<HTMLElement, CredentialActivityPaneProps>(
  function CredentialActivityPane({ sessions, audit, cli, pathById }, ref): React.JSX.Element {
    const [sessionPage, setSessionPage] = useState(0);
    const [auditPage, setAuditPage] = useState(0);

    const pagedSessions = paginate(sessions, sessionPage);
    const pagedAudit = paginate(audit, auditPage);

    return (
      <aside ref={ref} className="min-h-0 min-w-0 space-y-4 overflow-y-auto bg-surface p-3">
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
    );
  },
);
