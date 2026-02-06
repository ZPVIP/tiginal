import React, { useMemo } from 'react';
import { clsx } from 'clsx';

interface ShortcutDef {
  section: string;   // Big category: "Chat Box", "Terminal"
  category: string;  // Small category: "New", "Tabs", etc.
  action: string;
  key: string;       // Internal rep, e.g. "CmdOrCtrl+T"
}

const SHORTCUTS: ShortcutDef[] = [
  // Chat Box - New
  { section: 'Chat Box', category: 'New', action: 'New Chat', key: 'CmdOrCtrl+N' },
  { section: 'Chat Box', category: 'New', action: 'Incognito Chat', key: 'CmdOrCtrl+I' },

  // Terminal - General (Clear Buffer, Toggle Input Focus)
  { section: 'Terminal', category: 'General', action: 'Clear Buffer', key: 'CmdOrCtrl+K' },
  { section: 'Terminal', category: 'General', action: 'Toggle Input Focus', key: 'Ctrl+`' },

  // Terminal - Tabs
  { section: 'Terminal', category: 'Tabs', action: 'New Tab', key: 'CmdOrCtrl+T' },
  { section: 'Terminal', category: 'Tabs', action: 'Close Tab / Pane', key: 'CmdOrCtrl+W' },
  { section: 'Terminal', category: 'Tabs', action: 'Switch to Tab 1-9', key: 'CmdOrCtrl+1-9' },

  // Terminal - Split Panes
  { section: 'Terminal', category: 'Split Panes', action: 'Split Right', key: 'CmdOrCtrl+D' },
  { section: 'Terminal', category: 'Split Panes', action: 'Split Down', key: 'CmdOrCtrl+Shift+D' },
  { section: 'Terminal', category: 'Split Panes', action: 'Maximize Pane', key: 'CmdOrCtrl+Shift+Enter' },
  { section: 'Terminal', category: 'Split Panes', action: 'Navigate Panes', key: 'CmdOrCtrl+Opt+Arrow' },

  // Terminal - View
  { section: 'Terminal', category: 'View', action: 'Zoom In', key: 'CmdOrCtrl+=' },
  { section: 'Terminal', category: 'View', action: 'Zoom Out', key: 'CmdOrCtrl+-' },
  { section: 'Terminal', category: 'View', action: 'Reset Zoom', key: 'CmdOrCtrl+0' },
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

interface SectionData {
  section: string;
  groups: { category: string; items: ShortcutDef[] }[];
}

export function ShortcutSettings() {
  
  // Group by section, then by category (preserving insertion order)
  const sections = useMemo(() => {
    const result: SectionData[] = [];
    const sectionMap = new Map<string, SectionData>();

    SHORTCUTS.forEach(s => {
      let sec = sectionMap.get(s.section);
      if (!sec) {
        sec = { section: s.section, groups: [] };
        sectionMap.set(s.section, sec);
        result.push(sec);
      }

      let group = sec.groups.find(g => g.category === s.category);
      if (!group) {
        group = { category: s.category, items: [] };
        sec.groups.push(group);
      }
      group.items.push(s);
    });

    return result;
  }, []);

  return (
    <div className="space-y-10 pb-12">
      <h2 className="text-xl font-semibold text-text-main mb-6">Keyboard Shortcuts</h2>
      
      {sections.map((sec) => (
        <div key={sec.section} className="space-y-6">
          {/* Section header (big category) */}
          <h3 className="text-base font-semibold text-text-main border-b border-border pb-2">
            {sec.section}
          </h3>

          {sec.groups.map((group) => (
            <div key={group.category} className="space-y-3">
              {/* Subcategory header */}
              <h4 className="text-sm font-medium text-text-muted uppercase tracking-wider pl-1">
                {group.category}
              </h4>
              
              <div className="w-full max-w-2xl rounded-lg overflow-hidden border border-border/50">
                {group.items.map((item, idx) => (
                  <div 
                    key={idx}
                    className={clsx(
                      "flex items-center justify-between px-4 py-2.5 transition-colors",
                      idx % 2 === 0 ? "bg-surface" : "bg-surface-light/30",
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
      ))}
    </div>
  );
}
