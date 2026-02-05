import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { clsx } from 'clsx';
import { createPortal } from 'react-dom';

export type FancySelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

interface FancySelectProps {
  value: string;
  onChange: (value: string) => void;
  options: FancySelectOption[];
  placeholder?: string;
  className?: string;
  buttonClassName?: string;
  listClassName?: string;
  leftIcon?: React.ReactNode;
}

export function FancySelect({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  className,
  buttonClassName,
  listClassName,
  leftIcon
}: FancySelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 0 });

  const currentLabel = options.find(o => o.value === value)?.label || (value ? value : placeholder);

  useLayoutEffect(() => {
    if (!open) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setCoords({ top: rect.bottom + 4, left: rect.left, width: rect.width });
  }, [open, value, options.length]);

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      const inTrigger = rootRef.current?.contains(target);
      const inDropdown = dropdownRef.current?.contains(target);
      if (!inTrigger && !inDropdown) setOpen(false);
    };
    // Use capture so parent handlers calling stopPropagation (e.g. draggable modal surfaces)
    // don't prevent outside-click closing.
    document.addEventListener('mousedown', onDocMouseDown, true);
    const onResize = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return setOpen(false);
      setCoords({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    };
    window.addEventListener('resize', onResize);

    // Close (or reflow) on scroll so the menu doesn't get detached.
    const onScroll = () => onResize();
    window.addEventListener('scroll', onScroll, true);

    return () => {
      document.removeEventListener('mousedown', onDocMouseDown, true);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={clsx('relative', className)}>
      <div
        ref={triggerRef}
        tabIndex={0}
        onClick={() => setOpen(v => !v)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen(v => !v);
          }
          if (e.key === 'Escape') setOpen(false);
        }}
        className={clsx(
          'w-full bg-surface text-text-main text-sm rounded-lg py-2 px-3 pr-8 border border-border outline-none cursor-pointer flex items-center focus:border-primary',
          open && 'border-primary',
          buttonClassName
        )}
      >
        {leftIcon}
        <span className={clsx('flex-1 truncate', !value && 'text-text-muted')}>{currentLabel}</span>
        <ChevronDown
          size={14}
          className={clsx(
            'absolute right-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none transition-transform',
            open && 'rotate-180'
          )}
        />
      </div>

      {open &&
        createPortal(
          <div
            ref={dropdownRef}
            style={{ top: coords.top, left: coords.left, width: coords.width }}
            className={clsx(
              'fixed z-[9999] max-h-60 overflow-y-auto bg-surface border border-border rounded-lg shadow-lg',
              listClassName
            )}
          >
            {options.map(opt => (
              <button
                key={opt.value}
                type="button"
                disabled={opt.disabled}
                onMouseDown={(e) => {
                  // Prevent blur-close before click registers (matches TerminalSettings pattern).
                  e.preventDefault();
                  if (opt.disabled) return;
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={clsx(
                  'w-full text-left px-3 py-2 text-sm transition-colors',
                  opt.disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-primary/20',
                  value === opt.value ? 'bg-primary/10 text-primary' : 'text-text-main'
                )}
              >
                <span className="font-medium">{opt.label}</span>
              </button>
            ))}
            {options.length === 0 && (
              <div className="px-3 py-2 text-sm text-text-muted">No options</div>
            )}
          </div>,
          document.body
        )}
    </div>
  );
}
