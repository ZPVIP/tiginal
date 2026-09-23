import React, { useState } from 'react';
import { clsx } from 'clsx';
import { Modal } from '../ui/Modal';
import { BTN_MODAL, BTN_MODAL_PRIMARY, FIELD } from './credentialStyles';

interface EnvEntryDialogProps {
  /** Null when the dialog is closed. `previousKeyName` is null when adding. */
  draft: { previousKeyName: string | null; keyName: string; value: string } | null;
  busy: boolean;
  onClose: () => void;
  onSave: (keyName: string, value: string) => void;
}

interface EnvEntryFormProps {
  initialKeyName: string;
  initialValue: string;
  busy: boolean;
  onClose: () => void;
  onSave: (keyName: string, value: string) => void;
}

const LABEL = 'block text-xs font-medium text-text-sec mb-1.5';

export function EnvEntryDialog({ draft, busy, onClose, onSave }: EnvEntryDialogProps): React.JSX.Element {
  const editing = draft !== null && draft.previousKeyName !== null;

  return (
    <Modal isOpen={draft !== null} onClose={onClose} title={editing ? 'Edit entry' : 'Add entry'}>
      {draft && (
        <EnvEntryForm
          // Remounting is what seeds the fields, so this key is what stops a reopen on another row from showing the row before it. The prefix keeps the add case from colliding with a real key of the same name.
          key={draft.previousKeyName === null ? 'add' : `edit:${draft.previousKeyName}`}
          initialKeyName={draft.keyName}
          initialValue={draft.value}
          busy={busy}
          onClose={onClose}
          onSave={onSave}
        />
      )}
    </Modal>
  );
}

function EnvEntryForm({
  initialKeyName,
  initialValue,
  busy,
  onClose,
  onSave,
}: EnvEntryFormProps): React.JSX.Element {
  const [keyName, setKeyName] = useState(initialKeyName);
  const [value, setValue] = useState(initialValue);

  const trimmedKey = keyName.trim();

  return (
    <div>
      <div className="p-4 space-y-3">
        <div>
          <label htmlFor="env-entry-key" className={LABEL}>Key</label>
          <input
            id="env-entry-key"
            type="text"
            value={keyName}
            onChange={(e) => setKeyName(e.target.value)}
            spellCheck={false}
            className={clsx(FIELD, 'w-full font-mono')}
          />
        </div>

        <div>
          <label htmlFor="env-entry-value" className={LABEL}>Value</label>
          <textarea
            id="env-entry-value"
            rows={3}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            spellCheck={false}
            className={clsx(FIELD, 'w-full font-mono resize-none')}
          />
        </div>

        <p className="text-[11px] text-text-muted">
          Stored exactly as typed. Tiginal quotes it in the file only when a bare value would read back short.
        </p>
      </div>

      <div className="px-4 py-3 border-t border-border flex justify-end gap-2">
        <button onClick={onClose} className={BTN_MODAL}>Cancel</button>
        <button
          onClick={() => onSave(trimmedKey, value)}
          disabled={busy || trimmedKey.length === 0}
          className={BTN_MODAL_PRIMARY}
        >
          Save
        </button>
      </div>
    </div>
  );
}
