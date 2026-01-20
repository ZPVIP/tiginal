import React from 'react';

export function ShortcutSettings() {
  const shortcuts = [
    { category: 'Tabs', key: 'Cmd+T', action: 'New Tab (Native)' },
    { category: 'Tabs', key: 'Cmd+W', action: 'Close Tab' },
    { category: 'Tabs', key: 'Cmd+1-9', action: 'Switch to Tab 1-9' },
    { category: 'Tabs', key: 'Cmd+Shift+[/]', action: 'Previous/Next Tab' },
    
    { category: 'Split Panes', key: 'Cmd+\\', action: 'Split Right' },
    { category: 'Split Panes', key: 'Cmd+Opt+Arrow', action: 'Navigate Panes' },
    { category: 'Split Panes', key: 'Cmd+Shift+W', action: 'Close Active Pane' },
    
    { category: 'Terminal', key: 'Cmd+K', action: 'Clear Buffer (Native)' },
    { category: 'Terminal', key: 'Cmd+C', action: 'Copy (Selection)' },
    { category: 'Terminal', key: 'Cmd+V', action: 'Paste' },
  ];

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold mb-4">Keyboard Shortcuts</h2>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {shortcuts.map((s, i) => (
          <div key={i} className="flex items-center justify-between p-3 bg-surface border border-border rounded-lg">
            <div>
               <div className="text-xs text-text-muted mb-0.5">{s.category}</div>
               <div className="text-sm font-medium">{s.action}</div>
            </div>
            <div className="flex gap-1">
                 {s.key.split('+').map((k, ki) => (
                     <span key={ki} className="px-2 py-1 bg-background rounded text-xs border border-border font-mono text-text-sec">
                         {k}
                     </span>
                 ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
