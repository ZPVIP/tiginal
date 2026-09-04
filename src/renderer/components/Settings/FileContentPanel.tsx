import React, { useCallback, useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { EnvEntryDialog } from './EnvEntryDialog';
import { BTN_SUBTLE, MUTED_PILL, PILL } from './credentialStyles';
import type {
  EnvEntryEdit, FileKind, GroupStatusReport, RevealedFileContent,
} from '../../../shared/credentials/types';

export type ManagedFile = GroupStatusReport['files'][number];
/** The shell's IPC wrapper. It surfaces a rejection in the page banner and resolves null. */
export type CredentialCall = <T>(channel: string, ...args: unknown[]) => Promise<T | null>;

interface FileContentPanelProps {
  file: ManagedFile | null;
  call: CredentialCall;
  /** Reloads the group report so the state pills stay honest after a write. */
  onChanged: () => void | Promise<void>;
  disabled: boolean;
  busy: boolean;
}

type RevealState =
  | { kind: 'loading' }
  | { kind: 'failed' }
  | { kind: 'ready'; content: RevealedFileContent };

type EnvDialogState =
  | { kind: 'closed' }
  | { kind: 'add' }
  | { kind: 'edit'; keyName: string; value: string };

const HEADING = 'text-xs font-medium text-text-sec';
const MUTED_LINE = 'text-[11px] text-text-muted';

const CONTENT_HEADINGS: Record<FileKind, string> = {
  key: 'File contents',
  env: 'Entries',
  'ssh-key': 'Private key',
};

function draftFor(state: EnvDialogState): { previousKeyName: string | null; keyName: string; value: string } | null {
  switch (state.kind) {
    case 'closed':
      return null;
    case 'add':
      return { previousKeyName: null, keyName: '', value: '' };
    case 'edit':
      return { previousKeyName: state.keyName, keyName: state.keyName, value: state.value };
  }
}

function PlainText({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="overflow-x-auto">
      <pre className="font-mono text-[11px] leading-5 text-text-main whitespace-pre-wrap break-all">{text}</pre>
    </div>
  );
}

export function FileContentPanel({
  file,
  call,
  onChanged,
  disabled,
  busy,
}: FileContentPanelProps): React.JSX.Element | null {
  // Revealed plaintext is stamped with the file it came from because the effect below cannot run until after this render commits. Without the stamp, the render that switches files would paint the previous file's secrets under the new file's heading.
  const [reveal, setReveal] = useState<{ fileId: string; state: RevealState } | null>(null);
  const [dialog, setDialog] = useState<EnvDialogState>({ kind: 'closed' });
  const requestRef = useRef(0);
  const fileId = file?.id ?? null;

  // A slow reveal for a file the user has already navigated away from must not land under the new heading, so only the newest token may write state.
  const claimToken = useCallback(() => {
    requestRef.current += 1;
    return requestRef.current;
  }, []);

  const applyReveal = useCallback((token: number, id: string, content: RevealedFileContent | null) => {
    if (token !== requestRef.current) return;
    setReveal({
      fileId: id,
      state: content === null ? { kind: 'failed' } : { kind: 'ready', content },
    });
  }, []);

  const revealFile = useCallback(async (id: string) => {
    const token = claimToken();
    setReveal({ fileId: id, state: { kind: 'loading' } });
    applyReveal(token, id, await call<RevealedFileContent>('credentials:reveal-file', id));
  }, [applyReveal, call, claimToken]);

  useEffect(() => {
    if (fileId === null) return;
    void revealFile(fileId);
  }, [fileId, revealFile]);

  if (file === null) return null;

  // Both writes answer with the file's new content, so a refusal is a null the dialog can stay open over instead of a closed dialog and a retyped value.
  const saveEntry = async (previousKeyName: string | null, keyName: string, value: string) => {
    const edit: EnvEntryEdit = { fileId: file.id, previousKeyName, keyName, value };
    const token = claimToken();
    const content = await call<RevealedFileContent>('credentials:save-entry', edit);
    if (content === null) return;
    setDialog({ kind: 'closed' });
    applyReveal(token, file.id, content);
    await onChanged();
  };

  const deleteEntry = async (keyName: string) => {
    const confirmed = window.confirm(
      `Delete ${keyName} from ${file.relativePath}? Its line is removed from the file on disk.`,
    );
    if (!confirmed) return;
    const token = claimToken();
    const content = await call<RevealedFileContent>('credentials:delete-entry', file.id, keyName);
    if (content === null) return;
    applyReveal(token, file.id, content);
    await onChanged();
  };

  const envTable = (content: Extract<RevealedFileContent, { kind: 'env' }>): React.JSX.Element => (
    <div className="space-y-3">
      {content.entries.length === 0 ? (
        <p className={MUTED_LINE}>
          This file has no managed entries yet. Use Add Entry to put one under management.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-left text-text-sec">
                <th className="py-1 pr-3 font-medium">Key</th>
                <th className="py-1 pr-3 font-medium">Value</th>
                <th className="py-1 pr-3 font-medium"><span className="sr-only">Kind</span></th>
                <th className="py-1 font-medium"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {content.entries.map((entry) => (
                <tr key={entry.keyName} className="border-t border-border align-top">
                  <td className="py-1.5 pr-3 font-mono text-text-main break-all">{entry.keyName}</td>
                  <td className="py-1.5 pr-3 font-mono text-text-main break-all">{entry.value}</td>
                  <td className="py-1.5 pr-3 whitespace-nowrap">
                    <span className={clsx(PILL, MUTED_PILL)}>{entry.secretType}</span>
                    {!entry.onDisk && (
                      <span
                        className={clsx(PILL, MUTED_PILL, 'ml-1.5')}
                        title="Tiginal holds this key, but the file on disk no longer has it."
                      >
                        not in file
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 text-right whitespace-nowrap">
                    <button
                      onClick={() => setDialog({ kind: 'edit', keyName: entry.keyName, value: entry.value })}
                      disabled={disabled || busy}
                      title={`Edit ${entry.keyName}`}
                      aria-label={`Edit ${entry.keyName}`}
                      className="p-1.5 text-text-muted hover:text-text-main disabled:opacity-50"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      onClick={() => void deleteEntry(entry.keyName)}
                      disabled={disabled || busy}
                      title={`Delete ${entry.keyName}`}
                      aria-label={`Delete ${entry.keyName}`}
                      className="p-1.5 text-text-muted hover:text-red-400 disabled:opacity-50"
                    >
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <button
        onClick={() => setDialog({ kind: 'add' })}
        disabled={disabled || busy}
        className={BTN_SUBTLE}
      >
        <Plus size={14} />
        Add Entry
      </button>
    </div>
  );

  const contentBody = (content: RevealedFileContent): React.JSX.Element => {
    switch (content.kind) {
      case 'key':
        return <PlainText text={content.text} />;
      case 'ssh-key':
        return (
          <>
            <PlainText text={content.text} />
            <div className="space-y-2 border-t border-border pt-3">
              <h4 className={HEADING}>Public key</h4>
              {content.publicKeyText === null ? (
                <p className={MUTED_LINE}>No sibling .pub file was found next to this key.</p>
              ) : (
                <PlainText text={content.publicKeyText} />
              )}
            </div>
          </>
        );
      case 'env':
        return envTable(content);
    }
  };

  const revealBody = (state: RevealState): React.JSX.Element => {
    switch (state.kind) {
      case 'loading':
        return <p className={MUTED_LINE}>Reading…</p>;
      case 'failed':
        return <p className={MUTED_LINE}>Could not read this file. See the message above.</p>;
      case 'ready':
        return contentBody(state.content);
    }
  };

  return (
    <>
      <div className="space-y-2 rounded-lg border border-border bg-surface p-4">
        <h4 className={HEADING}>{CONTENT_HEADINGS[file.kind]}</h4>
        {revealBody(reveal !== null && reveal.fileId === file.id ? reveal.state : { kind: 'loading' })}
      </div>

      <EnvEntryDialog
        draft={draftFor(dialog)}
        busy={busy}
        onClose={() => setDialog({ kind: 'closed' })}
        onSave={(keyName, value) => {
          void saveEntry(dialog.kind === 'edit' ? dialog.keyName : null, keyName, value);
        }}
      />
    </>
  );
}
