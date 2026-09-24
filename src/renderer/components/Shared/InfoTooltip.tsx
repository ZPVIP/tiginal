import { useId } from 'react';

interface InfoTooltipProps {
  label: string;
  className?: string;
}

export function InfoTooltip({ label, className = '' }: InfoTooltipProps) {
  const tooltipId = useId();
  return (
    <span className={`group relative inline-flex ${className}`}>
      <button
        type="button"
        aria-label={label}
        aria-describedby={tooltipId}
        className="inline-flex h-4 w-4 items-center justify-center text-text-muted outline-none hover:text-text-main focus-visible:text-primary"
      >
        <svg
          viewBox="0 0 16 16"
          width="16"
          height="16"
          aria-hidden="true"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <circle cx="8" cy="8" r="6.5" stroke="currentColor" />
          <path d="M8 7V11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          <circle cx="8" cy="4.75" r="0.8" fill="currentColor" />
        </svg>
      </button>
      <span
        id={tooltipId}
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 hidden w-64 -translate-x-1/2 rounded-md border border-border bg-background px-3 py-2 text-left text-xs font-normal leading-5 text-text-main shadow-lg group-hover:block group-focus-within:block"
      >
        {label}
      </span>
    </span>
  );
}
