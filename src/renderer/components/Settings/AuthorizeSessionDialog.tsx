import React from 'react';
import { clsx } from 'clsx';
import { AlertTriangle, CheckCircle2, Terminal } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { BTN_MODAL, BTN_MODAL_PRIMARY, FIELD, NEUTRAL_PILL, PILL } from './credentialStyles';
import type {
  CredentialCliStatus, CredentialUiSessionMode, GroupSummary,
} from '../../../shared/credentials/types';

export interface ActivateDraft {
  rootId: string;
  selected: Set<string>;
  ttlMinutes: number;
  mode: CredentialUiSessionMode;
}

interface AuthorizeSessionDialogProps {
  /** Null when closed. */
  draft: ActivateDraft | null;
  root: GroupSummary | null;
  descendants: GroupSummary[];
  unrecognizedOpaqueCount: number;
  busy: boolean;
  cli: CredentialCliStatus | null;
  onChange: (draft: ActivateDraft) => void;
  onClose: () => void;
  onConfirm: (draft: ActivateDraft) => void;
}

const TTL_CHOICES = [5, 15, 30, 60];

function withGroupToggled(draft: ActivateDraft, id: string): ActivateDraft {
  const selected = new Set(draft.selected);
  if (selected.has(id)) selected.delete(id);
  else selected.add(id);
  return { ...draft, selected };
}

export function AuthorizeSessionDialog({
  draft,
  root,
  descendants,
  unrecognizedOpaqueCount,
  busy,
  cli,
  onChange,
  onClose,
  onConfirm,
}: AuthorizeSessionDialogProps): React.JSX.Element {
  return (
    <Modal
      isOpen={draft !== null && root !== null}
      onClose={onClose}
      title="Authorize credential session"
      width="max-w-2xl"
    >
      {draft && root && (
        <div>
          <div className="p-4 space-y-4">
            <div>
              <div className="text-[11px] text-text-sec mb-1">Project</div>
              <div className="text-sm text-text-main">
                {root.name} <span className="font-mono text-[11px] text-text-muted">({root.path})</span>
              </div>
            </div>

            <div>
              <div className="text-[11px] text-text-sec mb-1.5">Access</div>
              <div className="space-y-2">
                <label className={clsx(
                  'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors',
                  draft.mode === 'original-files'
                    ? 'border-primary bg-primary/10'
                    : 'border-border bg-background hover:border-primary/50',
                )}>
                  <input
                    type="radio"
                    name="credential-session-mode"
                    checked={draft.mode === 'original-files'}
                    onChange={() => onChange({ ...draft, mode: 'original-files' })}
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
                  draft.mode === 'cli-authorization'
                    ? 'border-primary bg-primary/10'
                    : 'border-border bg-background hover:border-primary/50',
                )}>
                  <input
                    type="radio"
                    name="credential-session-mode"
                    checked={draft.mode === 'cli-authorization'}
                    onChange={() => onChange({ ...draft, mode: 'cli-authorization' })}
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
                  <span>{root.name}</span>
                  <span className={clsx(PILL, NEUTRAL_PILL)}>session root</span>
                </label>
                {descendants.map((group) => (
                  <label
                    key={group.id}
                    style={{ paddingLeft: (group.depth - root.depth) * 16 }}
                    className="flex items-center gap-2 text-sm text-text-main"
                  >
                    <input
                      type="checkbox"
                      checked={draft.selected.has(group.id)}
                      onChange={() => onChange(withGroupToggled(draft, group.id))}
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
                value={draft.ttlMinutes}
                onChange={(e) => onChange({ ...draft, ttlMinutes: Number(e.target.value) })}
                className={FIELD}
              >
                {TTL_CHOICES.map((minutes) => (
                  <option key={minutes} value={minutes}>{minutes} minutes</option>
                ))}
              </select>
            </div>

            {draft.mode === 'cli-authorization' && (
              <div className={clsx(
                'space-y-2 rounded-lg border p-3 text-[11px] leading-5',
                cli?.installed
                  ? 'border-green-500/30 bg-green-500/10 text-text-muted'
                  : 'border-amber-500/40 bg-amber-500/10 text-text-muted',
              )}>
                <div className="flex items-center gap-2 font-medium text-text-main">
                  {cli?.installed
                    ? <CheckCircle2 size={13} className="text-green-400" />
                    : <AlertTriangle size={13} className="text-amber-400" />}
                  {cli === null
                    ? 'Checking the Tiginal CLI'
                    : cli.installed
                      ? 'Tiginal CLI is available on PATH'
                      : 'Tiginal CLI is not on PATH'}
                </div>

                {cli && !cli.installed && (
                  <div className="space-y-2">
                    <p>Add this line to the end of your shell configuration:</p>
                    <pre className="overflow-x-auto rounded bg-background px-2 py-1 font-mono text-text-main">{`export PATH="${cli.binDirectory}:$PATH"`}</pre>
                    <p>
                      Use <span className="font-mono">~/.zshrc</span> for zsh or{' '}
                      <span className="font-mono">~/.bashrc</span> for bash. Then open a new terminal, or reload it with{' '}
                      <span className="font-mono">source ~/.zshrc</span> or{' '}
                      <span className="font-mono">source ~/.bashrc</span>.
                    </p>
                    <p>Verify the setup with <span className="font-mono">tiginal cred list</span>.</p>
                  </div>
                )}
              </div>
            )}

            <p className="rounded-lg border border-border bg-background p-3 text-[11px] leading-5 text-text-muted">
              {draft.mode === 'original-files' ? (
                <>
                  Real passwords will be readable by any process that can access these files until the session ends.
                  Tiginal restores the masked copies on revoke, timeout, normal app exit, or next startup after a crash.
                </>
              ) : (
                <span className="block space-y-2">
                  <span className="flex items-center gap-2 text-text-main">
                    <Terminal size={13} /> Run an authorized command
                  </span>
                  <code className="block whitespace-pre-wrap break-words rounded bg-surface px-2 py-1 text-text-main">
                    tiginal cred run {root.path} [-v|--verbose] -- &lt;command&gt; [args...]
                  </code>
                  <span className="block">
                    Tiginal injects the selected credentials into that command while keeping the managed files masked.
                    This authorization applies only to the next matching command.
                  </span>
                  <span className="block">For several commands, start an authorized shell:</span>
                  <code className="block whitespace-nowrap rounded bg-surface px-2 py-1 text-text-main">
                    tiginal cred shell {root.path}
                  </code>
                </span>
              )}
            </p>

            {draft.mode === 'original-files' && unrecognizedOpaqueCount > 0 && (
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
            <button onClick={onClose} className={BTN_MODAL}>Cancel</button>
            <button
              onClick={() => onConfirm(draft)}
              disabled={busy || (draft.mode === 'original-files' && unrecognizedOpaqueCount > 0)}
              className={BTN_MODAL_PRIMARY}
            >
              {draft.mode === 'original-files' ? 'Start File Session' : 'Authorize CLI'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
