import type { FileState, GroupStatus } from '../../../shared/credentials/types';

export const NEUTRAL_PILL = 'bg-surface-light border-border text-text-muted';
export const MUTED_PILL = 'bg-surface-light border-border text-text-muted/70';
export const AMBER_PILL = 'bg-amber-500/10 border-amber-500/30 text-amber-400';
export const GREEN_PILL = 'bg-green-500/10 border-green-500/30 text-green-400';
export const RED_PILL = 'bg-red-500/10 border-red-500/30 text-red-400';

export const GROUP_PILLS: Record<GroupStatus, { label: string; className: string }> = {
  safe: { label: 'SAFE', className: NEUTRAL_PILL },
  drifted: { label: 'DRIFTED', className: AMBER_PILL },
  live: { label: 'LIVE', className: GREEN_PILL },
  unmanaged: { label: 'UNMANAGED', className: MUTED_PILL },
  missing: { label: 'MISSING', className: RED_PILL },
};

export const FILE_PILLS: Record<FileState['kind'], { label: string; className: string }> = {
  safe: { label: 'SAFE', className: NEUTRAL_PILL },
  'safe-edited': { label: 'SAFE (EDITED)', className: NEUTRAL_PILL },
  drifted: { label: 'DRIFTED', className: AMBER_PILL },
  missing: { label: 'MISSING', className: RED_PILL },
  unmanaged: { label: 'UNMANAGED', className: MUTED_PILL },
};

export const PILL = 'text-[10px] px-1.5 py-0.5 rounded border shrink-0';
export const BTN_SUBTLE = 'flex items-center gap-1.5 px-3 py-1.5 bg-surface border border-border text-text-main text-xs rounded-lg hover:border-primary hover:bg-surface-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
export const BTN_MODAL = 'px-4 py-2 text-sm bg-background hover:bg-surface-light border border-border rounded-lg transition-colors';
export const BTN_MODAL_PRIMARY = 'px-4 py-2 text-sm bg-primary hover:opacity-90 text-primary-foreground rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
export const FIELD = 'bg-background text-text-main text-sm rounded-lg py-2 px-3 border border-border focus:border-primary outline-none';
export const EMPTY = 'text-center py-8 text-text-muted text-sm';
