import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { BTN_MODAL, BTN_MODAL_PRIMARY } from './credentialStyles';
import type { ManagedFile } from './FileContentPanel';
import type { FileState } from '../../../shared/credentials/types';

interface DriftReviewDialogProps {
  /** Null when closed. `armed` shows the irreversible-import confirmation. */
  draft: { fileId: string; armed: boolean } | null;
  file: ManagedFile | null;
  state: Extract<FileState, { kind: 'drifted' }> | null;
  busy: boolean;
  onArmedChange: (armed: boolean) => void;
  onClose: () => void;
  onRestoreSafe: () => void;
  onImport: () => void;
}

export function DriftReviewDialog({
  draft,
  file,
  state,
  busy,
  onArmedChange,
  onClose,
  onRestoreSafe,
  onImport,
}: DriftReviewDialogProps): React.JSX.Element {
  return (
    <Modal
      isOpen={draft !== null && state !== null}
      onClose={onClose}
      title="Review changes"
      width="max-w-lg"
    >
      {draft && file && state && (
        <div>
          <div className="p-4 space-y-4">
            <div>
              <p className="text-xs font-mono text-text-main break-all">{file.relativePath}</p>
              <p className="text-[11px] text-text-muted mt-1">
                Key names only. Values are never read into the app.
              </p>
            </div>

            <div>
              <div className="text-[11px] text-text-sec mb-1.5">Changed keys</div>
              {state.changedKeys.length === 0 ? (
                <p className="text-[11px] text-text-muted">None</p>
              ) : (
                <div className="space-y-1">
                  {state.changedKeys.map((key) => (
                    <div key={key} className="text-[11px] font-mono text-text-main">{key}</div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <div className="text-[11px] text-text-sec mb-1.5">Keys no longer in the file</div>
              {state.missingKeys.length === 0 ? (
                <p className="text-[11px] text-text-muted">None</p>
              ) : (
                <div className="space-y-1">
                  {state.missingKeys.map((key) => (
                    <div key={key} className="text-[11px] font-mono text-text-main">{key}</div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="px-4 py-3 border-t border-border space-y-3">
            {draft.armed ? (
              <>
                <p className="text-[11px] text-amber-400 flex items-start gap-1.5">
                  <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                  <span>
                    Whatever value sits in this file right now becomes the new stored secret for every
                    changed key. The values stored before this are replaced and cannot be recovered.
                  </span>
                </p>
                <div className="flex justify-end gap-2">
                  <button onClick={() => onArmedChange(false)} className={BTN_MODAL}>
                    Cancel
                  </button>
                  <button
                    onClick={onImport}
                    disabled={busy}
                    className="px-4 py-2 text-sm bg-amber-500/20 border border-amber-500/40 text-amber-400 rounded-lg hover:bg-amber-500/30 transition-colors disabled:opacity-50"
                  >
                    Confirm Import
                  </button>
                </div>
              </>
            ) : (
              <div className="flex justify-end gap-2">
                <button onClick={onClose} className={BTN_MODAL}>Close</button>
                <button onClick={onRestoreSafe} disabled={busy} className={BTN_MODAL}>
                  Restore Safe
                </button>
                <button onClick={() => onArmedChange(true)} className={BTN_MODAL_PRIMARY}>
                  Import Changes
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
