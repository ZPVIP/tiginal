import React from 'react';
import { Terminal, Check, CheckCheck, X, AlertTriangle } from 'lucide-react';
import { clsx } from 'clsx';

interface BashConfirmModalProps {
  open: boolean;
  command: string;
  description?: string;
  riskLevel?: 'safe' | 'low' | 'medium' | 'high';
  onAllow: () => void;
  onAllowAll: () => void;
  onDeny: () => void;
}

export function BashConfirmModal({
  open,
  command,
  description,
  riskLevel = 'medium',
  onAllow,
  onAllowAll,
  onDeny,
}: BashConfirmModalProps) {
  if (!open) return null;

  const riskColors: Record<string, { bg: string; text: string; border: string }> = {
    safe: { bg: 'bg-green-500/10', text: 'text-green-400', border: 'border-green-500/30' },
    low: { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/30' },
    medium: { bg: 'bg-yellow-500/10', text: 'text-yellow-400', border: 'border-yellow-500/30' },
    high: { bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/30' },
  };

  const riskLabels: Record<string, string> = {
    safe: 'Safe',
    low: 'Low Risk',
    medium: 'Medium Risk',
    high: 'High Risk',
  };

  const colors = riskColors[riskLevel] || riskColors.medium;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-surface border border-border rounded-xl w-full max-w-2xl mx-4 shadow-2xl animate-in zoom-in-95 fade-in duration-200">
        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-border">
          <div className={clsx("p-2 rounded-lg", colors.bg)}>
            <Terminal className={clsx("w-5 h-5", colors.text)} />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-text-main">Command Execution Confirmation</h3>
            <p className="text-sm text-text-muted">AI requests to execute the following command</p>
          </div>
          <div className={clsx(
            "px-2.5 py-1 rounded-full text-xs font-medium border",
            colors.bg, colors.text, colors.border
          )}>
            {riskLabels[riskLevel]}
          </div>
        </div>

        {/* Description */}
        {description && (
          <div className="px-6 py-3 border-b border-border bg-background/30">
            <p className="text-sm text-text-sec">{description}</p>
          </div>
        )}

        {/* Command Display */}
        <div className="p-6">
          <div className="bg-background rounded-lg border border-border overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-surface/50">
              <div className="w-3 h-3 rounded-full bg-red-500" />
              <div className="w-3 h-3 rounded-full bg-yellow-500" />
              <div className="w-3 h-3 rounded-full bg-green-500" />
              <span className="ml-2 text-xs text-text-muted font-mono">bash</span>
            </div>
            <pre className="p-4 overflow-x-auto text-sm font-mono text-text-main whitespace-pre-wrap">
              <code>{command}</code>
            </pre>
          </div>

          {/* Warning for high risk */}
          {riskLevel === 'high' && (
            <div className="mt-4 flex items-start gap-3 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
              <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-300">
                This command may have destructive effects. Please review carefully before executing.
              </p>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
          <button
            onClick={onDeny}
            className="px-4 py-2.5 text-sm bg-background hover:bg-surface-light border border-border rounded-lg transition-colors flex items-center gap-2 text-text-main"
          >
            <X size={16} />
            Deny
          </button>
          <button
            onClick={onAllowAll}
            className="px-4 py-2.5 text-sm bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition-colors flex items-center gap-2"
          >
            <CheckCheck size={16} />
            Allow All
          </button>
          <button
            onClick={onAllow}
            className="px-4 py-2.5 text-sm bg-primary hover:bg-blue-600 text-white rounded-lg transition-colors flex items-center gap-2"
          >
            <Check size={16} />
            Allow
          </button>
        </div>
      </div>
    </div>
  );
}
