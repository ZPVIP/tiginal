import type { ReactNode } from 'react';
import { clsx } from 'clsx';

interface SettingsPageHeaderProps {
  icon: ReactNode;
  title: string;
  actions?: ReactNode;
}

export function SettingsPageHeader({
  icon,
  title,
  actions,
}: SettingsPageHeaderProps) {
  return (
    <header className="flex items-start justify-between gap-6 shrink-0">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-text-main">
          <span className="flex h-7 w-7 items-center justify-center text-primary shrink-0">
            {icon}
          </span>
          <h2 className="whitespace-nowrap text-2xl font-bold leading-8">{title}</h2>
        </div>
      </div>
      {actions && (
        <div className="flex min-h-8 items-center gap-3 shrink-0">
          {actions}
        </div>
      )}
    </header>
  );
}

interface GlobalToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

export function GlobalToggle({ checked, onChange, disabled = false }: GlobalToggleProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-medium text-text-muted">Global</span>
      <button
        type="button"
        role="switch"
        aria-label="Global"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={clsx(
          'relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none disabled:cursor-not-allowed disabled:opacity-50',
          checked ? 'bg-primary' : 'bg-toggle-off border border-toggle-off-border'
        )}
      >
        <span
          className={clsx(
            'inline-block h-3.5 w-3.5 transform rounded-full shadow-sm transition-transform',
            checked ? 'translate-x-5 bg-primary-foreground' : 'translate-x-0.5 bg-toggle-off-thumb'
          )}
        />
      </button>
    </div>
  );
}
