import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { clsx } from 'clsx';
import { createPortal } from 'react-dom';
import type { GroupSummary } from '../../../shared/credentials/types';

interface ProjectPickerProps {
  groups: GroupSummary[];
  selectedId: string | null;
  onSelect: (groupId: string) => void;
  disabled?: boolean;
}

type PickerState = { kind: 'closed' } | { kind: 'open'; activeIndex: number };

function GroupLines({ group }: { group: GroupSummary }): React.JSX.Element {
  const isProject = group.scope === 'project';
  return (
    <span className="block min-w-0">
      <span className="block truncate text-xs font-medium">{group.name}</span>
      <span className={clsx('block truncate text-[11px] text-text-muted', isProject && 'font-mono')}>
        {isProject ? (group.rootPath ?? group.path) : 'System scope'}
      </span>
    </span>
  );
}

export function ProjectPicker({
  groups,
  selectedId,
  onSelect,
  disabled = false,
}: ProjectPickerProps): React.JSX.Element | null {
  const [state, setState] = useState<PickerState>({ kind: 'closed' });
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLDivElement | null>>([]);
  const baseId = useId();
  const listId = `${baseId}-list`;
  const optionId = (index: number) => `${baseId}-option-${index}`;

  const open = state.kind === 'open';
  const clampIndex = (index: number) => Math.min(Math.max(index, 0), groups.length - 1);
  const activeIndex = state.kind === 'open' ? clampIndex(state.activeIndex) : -1;

  useLayoutEffect(() => {
    if (!open) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setCoords({ top: rect.bottom + 4, left: rect.left, width: rect.width });
  }, [open, selectedId, groups.length]);

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (triggerRef.current?.contains(target)) return;
      if (listRef.current?.contains(target)) return;
      setState({ kind: 'closed' });
    };
    // Capture phase so a parent calling stopPropagation, such as a draggable modal surface, cannot strand the list open.
    document.addEventListener('mousedown', onDocMouseDown, true);
    const reposition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) {
        setState({ kind: 'closed' });
        return;
      }
      setCoords({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    };
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown, true);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    optionRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  const openList = () => {
    if (disabled) return;
    setState({ kind: 'open', activeIndex: Math.max(groups.findIndex(group => group.id === selectedId), 0) });
  };

  const commit = (index: number) => {
    const group: GroupSummary | undefined = groups[index];
    if (!group) return;
    onSelect(group.id);
    setState({ kind: 'closed' });
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault();
        if (state.kind === 'closed') openList();
        else setState({ kind: 'open', activeIndex: clampIndex(activeIndex + (event.key === 'ArrowDown' ? 1 : -1)) });
        return;
      }
      case 'Home':
      case 'End': {
        if (state.kind === 'closed') return;
        event.preventDefault();
        setState({ kind: 'open', activeIndex: event.key === 'Home' ? 0 : groups.length - 1 });
        return;
      }
      case 'Enter':
      case ' ': {
        // preventDefault suppresses the click a native button synthesizes from these keys, so this branch is the only thing that toggles and `onClick` stays purely a pointer path.
        event.preventDefault();
        if (state.kind === 'closed') openList();
        else commit(activeIndex);
        return;
      }
      case 'Escape': {
        if (state.kind === 'closed') return;
        event.preventDefault();
        setState({ kind: 'closed' });
        return;
      }
      default:
        return;
    }
  };

  if (groups.length === 0) return null;

  const selectedGroup = groups.find(group => group.id === selectedId);

  return (
    <div className="relative w-full shrink-0">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Credential project"
        aria-controls={listId}
        aria-activedescendant={open ? optionId(activeIndex) : undefined}
        onClick={() => (state.kind === 'open' ? setState({ kind: 'closed' }) : openList())}
        onKeyDown={onKeyDown}
        className={clsx(
          'flex w-full items-center rounded-lg border border-border bg-background py-2 pl-3 pr-8 text-left text-text-main outline-none focus:border-primary',
          open && 'border-primary',
          disabled && 'cursor-not-allowed opacity-50'
        )}
      >
        <span className="min-w-0 flex-1">
          {selectedGroup ? (
            <GroupLines group={selectedGroup} />
          ) : (
            <span className="block text-[11px] text-text-muted">Select a project</span>
          )}
        </span>
        <ChevronDown
          size={14}
          className={clsx(
            'pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-muted transition-transform',
            open && 'rotate-180'
          )}
        />
      </button>

      {open &&
        createPortal(
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label="Credential project"
            style={{ top: coords.top, left: coords.left, width: coords.width }}
            className="fixed z-[9999] max-h-60 overflow-y-auto rounded-lg border border-border bg-surface shadow-lg"
          >
            {groups.map((group, index) => {
              const selected = group.id === selectedId;
              return (
                <div
                  key={group.id}
                  ref={(element) => {
                    optionRefs.current[index] = element;
                  }}
                  id={optionId(index)}
                  role="option"
                  aria-selected={selected}
                  onMouseDown={(event) => {
                    // Keeps focus on the trigger, so the outside-mousedown handler cannot close the list before the selection lands.
                    event.preventDefault();
                    commit(index);
                  }}
                  className={clsx(
                    'cursor-pointer px-3 py-2 transition-colors',
                    index === activeIndex ? 'bg-primary/20' : selected ? 'bg-primary/10' : 'hover:bg-primary/20',
                    selected ? 'text-primary' : 'text-text-main'
                  )}
                >
                  <GroupLines group={group} />
                </div>
              );
            })}
          </div>,
          document.body
        )}
    </div>
  );
}
