import React, { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { FolderOpen } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { BTN_MODAL, BTN_MODAL_PRIMARY, BTN_SUBTLE, FIELD } from './credentialStyles';
import type { GroupScope } from '../../../shared/credentials/types';

export interface NewProjectInput {
  name: string;
  scope: GroupScope;
  rootPath: string | null;
}

interface AddProjectDialogProps {
  isOpen: boolean;
  busy: boolean;
  onClose: () => void;
  /** Invokes `credentials:choose-directory` in the shell. Resolves null when cancelled. */
  onChooseDirectory: () => Promise<string | null>;
  onCreate: (input: NewProjectInput) => void;
}

const SCOPES: GroupScope[] = ['project', 'system'];

const EMPTY_DRAFT: NewProjectInput = { name: '', scope: 'project', rootPath: null };

function nativeBasename(filePath: string): string {
  const trimmed = filePath.replace(/[\\/]+$/, '');
  return trimmed.split(/[\\/]/).filter(Boolean).at(-1) ?? trimmed;
}

export function AddProjectDialog({
  isOpen,
  busy,
  onClose,
  onChooseDirectory,
  onCreate,
}: AddProjectDialogProps): React.JSX.Element {
  const [draft, setDraft] = useState<NewProjectInput>(EMPTY_DRAFT);

  // `Modal` is what unmounts, not this component, so a cancelled draft would otherwise still be here the next time the dialog opens.
  useEffect(() => {
    if (isOpen) setDraft(EMPTY_DRAFT);
  }, [isOpen]);

  const chooseDirectory = async () => {
    const chosen = await onChooseDirectory();
    if (!chosen) return;
    setDraft((prev) => ({
      ...prev,
      rootPath: chosen,
      name: prev.name.trim().length === 0 ? nativeBasename(chosen) : prev.name,
    }));
  };

  const name = draft.name.trim();
  const rootPath = draft.scope === 'project' ? draft.rootPath : null;
  const canCreate = !busy && name.length > 0 && (draft.scope !== 'project' || draft.rootPath !== null);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add project">
      <div>
        <div className="p-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-text-sec mb-1.5">Name</label>
            <input
              type="text"
              value={draft.name}
              onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="Project name"
              className={clsx(FIELD, 'w-full')}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-text-sec mb-1.5">Scope</label>
            <select
              value={draft.scope}
              onChange={(e) => setDraft((prev) => ({ ...prev, scope: e.target.value as GroupScope }))}
              className={clsx(FIELD, 'w-full')}
            >
              {SCOPES.map((scope) => (
                <option key={scope} value={scope}>{scope}</option>
              ))}
            </select>
          </div>

          {draft.scope === 'project' && (
            <div>
              <label className="block text-xs font-medium text-text-sec mb-1.5">Project root</label>
              <button
                type="button"
                onClick={() => void chooseDirectory()}
                disabled={busy}
                className={clsx(BTN_SUBTLE, 'w-fit')}
              >
                <FolderOpen size={14} />
                Choose Directory…
              </button>
              {draft.rootPath === null ? (
                <p className="text-[11px] text-text-muted mt-1.5">No directory chosen yet</p>
              ) : (
                <p className="text-[11px] font-mono text-text-muted break-all mt-1.5">{draft.rootPath}</p>
              )}
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-border flex justify-end gap-2">
          <button onClick={onClose} className={BTN_MODAL}>Cancel</button>
          <button
            onClick={() => onCreate({ name, scope: draft.scope, rootPath })}
            disabled={!canCreate}
            className={BTN_MODAL_PRIMARY}
          >
            Create
          </button>
        </div>
      </div>
    </Modal>
  );
}
