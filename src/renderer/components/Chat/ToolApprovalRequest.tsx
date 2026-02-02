import React from 'react';
import { Terminal, Check, CheckCheck, X, AlertTriangle, ShieldCheck, ShieldAlert } from 'lucide-react';
import { clsx } from 'clsx';

interface ToolApprovalRequestProps {
  name: string;
  command: string;
  description?: string;
  riskLevel?: 'safe' | 'low' | 'medium' | 'high';
  onAllow: () => void;
  onAllowAll: () => void;
  onDeny: () => void;
}

export function ToolApprovalRequest({
  name,
  command,
  description,
  riskLevel = 'medium',
  onAllow,
  onAllowAll,
  onDeny,
}: ToolApprovalRequestProps) {
  
  const riskColors: Record<string, { bg: string; text: string; border: string; icon: React.ReactNode }> = {
    safe: { bg: 'bg-green-500/5', text: 'text-green-400', border: 'border-green-500/20', icon: <ShieldCheck className="w-4 h-4 text-green-400" /> },
    low: { bg: 'bg-blue-500/5', text: 'text-blue-400', border: 'border-blue-500/20', icon: <ShieldCheck className="w-4 h-4 text-blue-400" /> },
    medium: { bg: 'bg-yellow-500/5', text: 'text-yellow-400', border: 'border-yellow-500/20', icon: <AlertTriangle className="w-4 h-4 text-yellow-500" /> },
    high: { bg: 'bg-red-500/5', text: 'text-red-400', border: 'border-red-500/20', icon: <ShieldAlert className="w-4 h-4 text-red-500" /> },
  };

  const colors = riskColors[riskLevel] || riskColors.medium;

  console.log('ToolApprovalRequest mounting', { name, riskLevel });

  return (
        <div className={clsx("rounded-lg border overflow-hidden shadow-sm animate-in fade-in slide-in-from-bottom-2 duration-300", colors.bg, colors.border)}>
            {/* Header / Info */}
            <div className="flex items-start gap-3 p-3 border-b border-border/10">
                <div className="mt-0.5">{colors.icon}</div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-medium text-text-main">Requesting to run {name}</span>
                        <span className={clsx("text-[10px] px-1.5 py-0.5 rounded border uppercase tracking-wider", colors.border, colors.text)}>
                            {riskLevel} Risk
                        </span>
                    </div>
                    {description && <p className="text-xs text-text-muted line-clamp-2">{description}</p>}
                </div>
            </div>

            {/* Command Preview */}
            <div className="bg-background/40 p-3 font-mono text-xs text-text-sec overflow-x-auto whitespace-pre-wrap border-b border-border/10">
                {command}
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-2 p-2 bg-background/20">
                <button
                    onClick={onDeny}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-text-muted hover:text-text-main hover:bg-surface-hover rounded transition-colors"
                >
                    <X size={14} />
                    Deny
                </button>
                <div className="w-[1px] h-4 bg-border/20 mx-1" />
                <button
                    onClick={onAllowAll}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-purple-400 hover:text-purple-300 hover:bg-purple-500/10 rounded transition-colors"
                    title="Allow all future commands in this session"
                >
                    <CheckCheck size={14} />
                    Allow All
                </button>
                <button
                    onClick={onAllow}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary/90 hover:bg-primary text-white rounded shadow-sm hover:shadow transition-all"
                >
                    <Check size={14} />
                    Allow
                </button>
            </div>
        </div>
  );
}
