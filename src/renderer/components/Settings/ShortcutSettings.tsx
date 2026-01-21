import React, { useMemo } from 'react';
import { clsx } from 'clsx';
import { Command, Option, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, CornerDownLeft, Delete } from 'lucide-react';

interface ShortcutDef {
  category: string;
  action: string;
  key: string; // Internal rep, e.g. "CmdOrCtrl+T"
}

const SHORTCUTS: ShortcutDef[] = [
  // Tabs
  { category: 'Tabs', action: 'New Tab', key: 'CmdOrCtrl+T' },
  { category: 'Tabs', action: 'Close Tab / Pane', key: 'CmdOrCtrl+W' },
  { category: 'Tabs', action: 'Switch to Tab 1-9', key: 'CmdOrCtrl+1-9' },

  // Panes
  { category: 'Split Panes', action: 'Split Right', key: 'CmdOrCtrl+D' },
  { category: 'Split Panes', action: 'Split Down', key: 'CmdOrCtrl+Shift+D' },
  { category: 'Split Panes', action: 'Maximize Pane', key: 'CmdOrCtrl+Shift+Enter' },
  { category: 'Split Panes', action: 'Navigate Panes', key: 'CmdOrCtrl+Opt+Arrow' },

  // View
  { category: 'View', action: 'Zoom In', key: 'CmdOrCtrl+=' },
  { category: 'View', action: 'Zoom Out', key: 'CmdOrCtrl+-' },
  { category: 'View', action: 'Reset Zoom', key: 'CmdOrCtrl+0' },

  // Terminal
  { category: 'Terminal', action: 'Clear Buffer', key: 'CmdOrCtrl+K' },
  { category: 'Terminal', action: 'Toggle Input Focus', key: 'Ctrl+`' },
];

const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

const KeyDisplay = ({ shortcut }: { shortcut: string }) => {
  // Parse shortcut string
  // Replace CmdOrCtrl based on platform
  let parts = shortcut.split('+');
  
  const renderKey = (k: string, idx: number) => {
    // Exact mapping for symbols on Mac
    if (isMac) {
      if (k === 'CmdOrCtrl' || k === 'Cmd') return <span key={idx} className="font-sans text-base">⌘</span>;
      if (k === 'Ctrl') return <span key={idx} className="font-sans text-base">⌃</span>;
      if (k === 'Alt' || k === 'Opt') return <span key={idx} className="font-sans text-base">⌥</span>;
      if (k === 'Shift') return <span key={idx} className="font-sans text-base">⇧</span>;
      if (k === 'Enter') return <span key={idx} className="font-sans text-base">↵</span>;
      if (k === 'Backspace') return <span key={idx} className="font-sans text-base">⌫</span>;
      if (k === 'Delete') return <span key={idx} className="font-sans text-base">⌦</span>;
      if (k === 'Esc') return <span key={idx} className="font-sans text-base">⎋</span>;
      if (k === 'Arrow') return <span key={idx} className="font-sans text-base">←↑↓→</span>;
    } else {
      // Windows / Linux text representation
      if (k === 'CmdOrCtrl') k = 'Ctrl';
      if (k === 'Opt') k = 'Alt';
      // Keep as text
    }

    return (
      <span 
        key={idx} 
        className={clsx(
          "min-w-[20px] h-6 px-1.5 flex items-center justify-center rounded text-xs font-mono border shadow-sm select-none",
          "bg-surface-light border-border text-text-main"
        )}
      >
        {k}
      </span>
    );
  };

  return (
    <div className="flex items-center gap-1">
       {parts.map((part, i) => renderKey(part, i))}
    </div>
  );
};

export function ShortcutSettings() {
  
  // Group by category
  const grouped = useMemo(() => {
    const groups: Record<string, ShortcutDef[]> = {};
    SHORTCUTS.forEach(s => {
      if (!groups[s.category]) groups[s.category] = [];
      groups[s.category].push(s);
    });
    return groups;
  }, []);

  return (
    <div className="space-y-8 pb-12">
      <h2 className="text-xl font-semibold text-text-main mb-6">Keyboard Shortcuts</h2>
      
      {Object.entries(grouped).map(([category, items]) => (
        <div key={category} className="space-y-3">
          <h3 className="text-sm font-medium text-text-muted uppercase tracking-wider pl-1">
            {category}
          </h3>
          
          <div className="w-full max-w-2xl rounded-lg overflow-hidden border border-border/50">
            {items.map((item, idx) => (
              <div 
                key={idx}
                className={clsx(
                  "flex items-center justify-between px-4 py-2.5 transition-colors",
                  // Zebra striping: odd rows get accent
                  idx % 2 === 0 ? "bg-surface" : "bg-surface-light/30",
                  // Hover effect
                  "hover:bg-primary/5"
                )}
              >
                <span className="text-sm text-text-main font-medium">
                  {item.action}
                </span>
                
                <KeyDisplay shortcut={item.key} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
