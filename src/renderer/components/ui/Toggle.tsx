import React from 'react';
import { clsx } from 'clsx';

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label: string;
  size?: 'small' | 'medium';
}

export function Toggle({ checked, onChange, disabled = false, label, size = 'medium' }: ToggleProps) {
  const isSmall = size === 'small';

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        'relative inline-flex shrink-0 items-center rounded-full transition-colors focus:outline-none disabled:cursor-not-allowed disabled:opacity-50',
        isSmall ? 'h-4 w-7' : 'h-5 w-9',
        checked ? 'bg-primary' : 'bg-toggle-off border border-toggle-off-border',
      )}
    >
      <span
        className={clsx(
          'inline-block transform rounded-full shadow-sm transition-transform',
          isSmall ? 'h-3 w-3' : 'h-3.5 w-3.5',
          checked ? 'bg-primary-foreground' : 'bg-toggle-off-thumb',
          checked
            ? isSmall ? 'translate-x-3.5' : 'translate-x-5'
            : 'translate-x-0.5',
        )}
      />
    </button>
  );
}
