import React, { useState, useRef, useEffect, type ReactNode } from 'react';
import { Copy, Check } from 'lucide-react';

export interface CopyButtonProps {
  /** Text to copy, or an async/sync getter returning the text */
  text?: string | (() => string | Promise<string | void>);
  /** Optional custom copy callback */
  onCopy?: () => void | Promise<void>;
  /** Tooltip/title for normal state */
  title?: string;
  /** Tooltip/title for copied state */
  copiedTitle?: string;
  /** Icon size in px, defaults to 14 */
  iconSize?: number;
  /** Additional CSS class names */
  className?: string;
  /** Disabled state */
  disabled?: boolean;
  /** Custom default icon before copying (defaults to <Copy size={iconSize} />) */
  defaultIcon?: ReactNode;
  /** Additional children rendered after the icon (e.g. text labels) */
  children?: ReactNode;
  /** Timeout in ms before reverting back to copy icon (defaults to 3000ms) */
  timeout?: number;
  /** aria-label */
  'aria-label'?: string;
}

export function CopyButton({
  text,
  onCopy,
  title = 'Copy',
  copiedTitle = 'Copied!',
  iconSize = 14,
  className = 'rounded-md p-1.5 text-text-muted hover:bg-surface-light hover:text-text-main disabled:opacity-30',
  disabled = false,
  defaultIcon,
  children,
  timeout = 3000,
  'aria-label': ariaLabel,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const handleCopy = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (disabled || copied) return;

    try {
      if (typeof text === 'string') {
        if (text) await navigator.clipboard.writeText(text);
      } else if (typeof text === 'function') {
        const result = await text();
        if (typeof result === 'string' && result) {
          await navigator.clipboard.writeText(result);
        }
      }

      if (onCopy) {
        await onCopy();
      }

      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setCopied(false);
      }, timeout);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
    }
  };

  const isButtonDisabled = disabled || copied;

  return (
    <button
      type="button"
      title={copied ? copiedTitle : title}
      aria-label={ariaLabel || (copied ? copiedTitle : title)}
      disabled={isButtonDisabled}
      onClick={handleCopy}
      className={`${className} ${copied ? '!opacity-100 text-emerald-500 hover:text-emerald-500 cursor-default' : ''}`}
    >
      {copied ? (
        <Check size={iconSize} className="shrink-0 text-emerald-500" />
      ) : (
        defaultIcon ?? <Copy size={iconSize} className="shrink-0" />
      )}
      {children}
    </button>
  );
}
