import type { ReactNode } from 'react';
import { clsx } from 'clsx';

export interface HorizontalTab<Id extends string> {
  id: Id;
  label: string;
  icon?: ReactNode;
}

interface HorizontalTabsProps<Id extends string> {
  tabs: readonly HorizontalTab<Id>[];
  activeTab: Id;
  onChange(id: Id): void;
  ariaLabel: string;
  className?: string;
}

export function HorizontalTabs<Id extends string>({
  tabs,
  activeTab,
  onChange,
  ariaLabel,
  className,
}: HorizontalTabsProps<Id>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={clsx('flex space-x-1 bg-surface border border-border p-1 rounded-lg shrink-0', className)}
    >
      {tabs.map(tab => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={activeTab === tab.id}
          onClick={() => onChange(tab.id)}
          className={clsx(
            'flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-all',
            activeTab === tab.id
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-text-sec hover:bg-surface-light hover:text-text-main',
          )}
        >
          {tab.icon}
          {tab.label}
        </button>
      ))}
    </div>
  );
}
