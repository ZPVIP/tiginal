import { ExternalLink, MonitorSpeaker, Plus } from 'lucide-react';
import type { SystemAudioPermissionInfo } from '../../../shared/audio/types';
import { Modal } from '../ui/Modal';

interface SystemAudioPermissionDialogProps {
  isOpen: boolean;
  permissionInfo: Extract<SystemAudioPermissionInfo, { kind: 'macos' }> | null;
  onClose(): void;
  onOpenSettings(): void;
}

function PermissionPreview({ owner }: { owner: 'application' | 'launcher' }) {
  const appLabel = owner === 'application' ? 'Tiginal' : 'Terminal or IDE';

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-[#f4f4f5] text-[#242426] shadow-sm dark:bg-[#252527] dark:text-[#f4f4f5]">
      <div className="flex items-center gap-1.5 border-b border-black/10 px-3 py-2 dark:border-white/10">
        <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
        <span className="ml-3 text-[11px] font-medium">Privacy & Security</span>
      </div>
      <div className="grid grid-cols-[112px_1fr] text-[10px]">
        <div className="space-y-2 border-r border-black/10 bg-black/[0.03] p-3 dark:border-white/10 dark:bg-white/[0.03]">
          <div className="h-2 w-14 rounded bg-current opacity-20" />
          <div className="h-2 w-16 rounded bg-current opacity-20" />
          <div className="rounded bg-primary/15 px-2 py-1.5 font-medium text-primary">Privacy & Security</div>
          <div className="h-2 w-12 rounded bg-current opacity-20" />
        </div>
        <div className="p-4">
          <div className="mb-1 flex items-center gap-2 text-xs font-semibold">
            <MonitorSpeaker size={15} /> Screen & System Audio Recording
          </div>
          <p className="mb-4 max-w-sm text-[9px] leading-4 opacity-60">
            Allow the applications below to record your screen and system audio.
          </p>
          <div className="mb-2 text-[9px] font-semibold uppercase tracking-wide opacity-60">
            Screen & System Audio Recording
          </div>
          <div className="flex items-center justify-between rounded-lg bg-white/70 px-3 py-2 shadow-sm dark:bg-black/20">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-[11px] font-bold text-white">T</div>
              <span className="font-medium">{appLabel}</span>
            </div>
            <div className="relative h-5 w-9 rounded-full bg-[#34c759]">
              <span className="absolute right-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow" />
            </div>
          </div>
          <div className="mt-3 flex h-6 w-6 items-center justify-center rounded-md border border-black/15 bg-white/60 dark:border-white/15 dark:bg-black/10">
            <Plus size={12} />
          </div>
          <div className="mb-2 mt-4 text-[9px] font-semibold uppercase tracking-wide opacity-60">
            System Audio Recording Only
          </div>
          <div className="flex items-center justify-between rounded-lg bg-white/70 px-3 py-2 shadow-sm dark:bg-black/20">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-[11px] font-bold text-white">T</div>
              <span className="font-medium">{appLabel}</span>
            </div>
            <div className="relative h-5 w-9 rounded-full bg-[#34c759]">
              <span className="absolute right-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow" />
            </div>
          </div>
          <div className="mt-3 flex h-6 w-6 items-center justify-center rounded-md border border-black/15 bg-white/60 dark:border-white/15 dark:bg-black/10">
            <Plus size={12} />
          </div>
        </div>
      </div>
    </div>
  );
}

export function SystemAudioPermissionDialog({
  isOpen,
  permissionInfo,
  onClose,
  onOpenSettings,
}: SystemAudioPermissionDialogProps) {
  const owner = permissionInfo?.permissionOwner ?? 'application';
  const appLabel = owner === 'application' ? 'Tiginal' : 'the Terminal or IDE that launched Tiginal';
  const statusMessage = permissionInfo?.screenStatus === 'denied'
    ? 'macOS currently reports that screen access is denied.'
    : permissionInfo?.screenStatus === 'restricted'
      ? 'A system policy currently restricts screen access.'
      : null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Allow system audio" width="max-w-2xl">
      <div className="space-y-5 p-5">
        <div>
          <p className="text-sm leading-6 text-text-main">
            Tiginal needs macOS permission to hear audio played by other apps.
          </p>
          {statusMessage && (
            <p className="mt-2 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-500">
              {statusMessage}
            </p>
          )}
        </div>

        <PermissionPreview owner={owner} />

        <ol className="space-y-2 text-sm leading-5 text-text-muted">
          <li><span className="mr-2 font-semibold text-text-main">1.</span>Open System Settings.</li>
          <li><span className="mr-2 font-semibold text-text-main">2.</span>Add and enable {appLabel} in both the Screen & System Audio Recording and System Audio Recording Only sections.</li>
          <li><span className="mr-2 font-semibold text-text-main">3.</span>Quit and reopen {owner === 'application' ? 'Tiginal' : 'both the launcher and Tiginal'}.</li>
        </ol>

        {owner === 'launcher' && (
          <p className="rounded-lg bg-surface-light px-3 py-2 text-xs leading-5 text-text-muted">
            This development build inherits permission from its launcher. A packaged Tiginal app appears under its own name.
          </p>
        )}

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm text-text-muted transition-colors hover:bg-surface-light hover:text-text-main"
          >
            Not now
          </button>
          <button
            type="button"
            onClick={onOpenSettings}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            Open System Settings <ExternalLink size={14} />
          </button>
        </div>
      </div>
    </Modal>
  );
}
