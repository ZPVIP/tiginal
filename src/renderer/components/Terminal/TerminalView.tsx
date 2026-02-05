import React, { useState, useRef, useEffect } from 'react';
import { Plus, X, Monitor, ChevronLeft, ChevronRight, Maximize2 } from 'lucide-react';
import { clsx } from 'clsx';
import { TerminalRef } from './TerminalInstance';
import { CommandInput, CommandInputHandle } from './CommandInput';
import { SplitLayout, Column, Pane } from './SplitLayout';

interface Tab {
  id: string;
  title: string;
  cwd: string; // Reflects active pane's CWD
  columns: Column[];
  columnWidths: number[]; // Ratios summing to approx 1
  activePaneId: string;
  maximizedPaneId: string | null; // If set, only this pane is shown
}

interface TerminalViewProps {
  onActivePathChange?: (path: string) => void;
}

export function TerminalView({ onActivePathChange }: TerminalViewProps) {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, tabId: string, type: 'tab' } | { x: number, y: number, paneId: string, type: 'pane' } | null>(null);
  
  const tabCounter = useRef(0);
  const paneCounter = useRef(0);
  const tabsContainerRef = useRef<HTMLDivElement>(null);
  
  // Refs for terminal instances
  const termRefs = useRef<Map<string, TerminalRef>>(new Map());
  
  // Ref for CommandInput
  const commandInputRef = useRef<CommandInputHandle>(null);

  // --- Helpers ---
  
  const createPaneId = () => {
      paneCounter.current += 1;
      return `pane-${paneCounter.current}`;
  };

  const createColId = () => {
       return `col-${Math.random().toString(36).substr(2, 9)}`;
  };

  const getActiveTab = () => tabs.find(t => t.id === activeTabId);

  // --- Logic ---

  const createTab = () => {
      tabCounter.current += 1;
      const newTabId = `tab-${tabCounter.current}`;
      const initialPaneId = createPaneId();
      
      const newTab: Tab = { 
          id: newTabId, 
          title: 'Terminal', 
          cwd: '', 
          columns: [{ 
              id: createColId(), 
              panes: [{ id: initialPaneId, cwd: '' }],
              splitRatio: 0.5 
          }],
          columnWidths: [1], // Single column = 100%
          activePaneId: initialPaneId,
          maximizedPaneId: null
      };
      
      setTabs(prev => [...prev, newTab]);
      setActiveTabId(newTabId);
  };

  const closeTab = (id: string) => {
      setTabs(prev => {
          const idx = prev.findIndex(t => t.id === id);
          if (idx === -1) return prev;
          
          const newTabs = prev.filter(t => t.id !== id);
          
          // Clean up refs for all panes in closed tab
          const tab = prev[idx];
          tab.columns.forEach(col => {
              col.panes.forEach(pane => {
                  termRefs.current.delete(pane.id);
              });
          });

          if (activeTabId === id) {
             if (newTabs.length > 0) {
                 const nextTab = newTabs[idx] || newTabs[newTabs.length - 1];
                 setActiveTabId(nextTab.id);
             } else {
                 setActiveTabId(null);
             }
          }
          return newTabs;
      });
  };

  const closeOthers = (id: string) => {
      setTabs(prev => prev.filter(t => t.id === id));
      setActiveTabId(id);
  };
  
  const closeToRight = (id: string) => {
    setTabs(prev => {
        const idx = prev.findIndex(t => t.id === id);
        return prev.slice(0, idx + 1);
    });
    setTabs(prev => {
      if (!prev.find(t => t.id === activeTabId)) {
          setActiveTabId(id);
      }
      return prev; 
    });
  };

  const closeToLeft = (id: string) => {
    setTabs(prev => {
        const idx = prev.findIndex(t => t.id === id);
        return prev.slice(idx);
    });
    setTabs(prev => {
        if (!prev.find(t => t.id === activeTabId)) {
            setActiveTabId(id);
        }
        return prev;
    });
  };
  
  // --- Split Logic ---
  
  const splitRight = () => {
      if (!activeTabId) return;
      setTabs(prev => prev.map(tab => {
          if (tab.id !== activeTabId) return tab;
          if (tab.columns.length >= 4) return tab; // Max 4 columns
          
          const newPaneId = createPaneId();
          const newCol = {
              id: createColId(),
              panes: [{ id: newPaneId, cwd: tab.cwd }], // Inherit CWD
              splitRatio: 0.5
          };
          
          const newColCount = tab.columns.length + 1;
          const newWidths = Array(newColCount).fill(1 / newColCount); // Reset to equal distribution for simplicity?
          // Or smarter: Halve the active column?
          // Standard iTerm/Tmux behavior: New split halves the current pane.
          // Since we split *globally* right (new column), it effectively reduces space of ALL?
          // Let's implement simple: Equal widths for now, or just append 1/N?
          // Let's stick to Equal Widths on Split Right for specific request?
          // User request: "Split Right" (Cmd+\).
          // Let's just reset to equal for simplicity on adding. User can resize later.
          
          return {
              ...tab,
              columns: [...tab.columns, newCol],
              columnWidths: newWidths,
              activePaneId: newPaneId
          };
      }));
  };

  const splitVertical = (direction: 'up' | 'down', targetPaneId?: string) => {
      if (!activeTabId) return;
      
      setTabs(prev => prev.map(tab => {
          if (tab.id !== activeTabId) return tab;
          
          const paneIdToSplit = targetPaneId || tab.activePaneId;
          
          // Find column containing this pane
          const colIndex = tab.columns.findIndex(c => c.panes.some(p => p.id === paneIdToSplit));
          if (colIndex === -1) return tab;
          
          const col = tab.columns[colIndex];
          if (col.panes.length >= 2) return tab; // Max 2 rows
          
          const newPaneId = createPaneId();
          const newPane = { id: newPaneId, cwd: tab.cwd };
          
          const newPanes = direction === 'up' 
             ? [newPane, col.panes[0]] 
             : [col.panes[0], newPane];
             
          const newColumns = [...tab.columns];
          newColumns[colIndex] = { ...col, panes: newPanes, splitRatio: 0.5 };
          
          return {
              ...tab,
              columns: newColumns,
              activePaneId: newPaneId
          };
      }));
  };

  const closePane = (paneId: string) => {
      // Pre-calculate the new active pane ID for focusing later
      let newActivePaneIdForFocus: string | null = null;
      
      setTabs(prev => prev.map(tab => {
          // Optimization: check if pane exists in tab
          if (!tab.columns.some(c => c.panes.some(p => p.id === paneId))) return tab;

          // Remove pane
          let newActiveId = tab.activePaneId;
          let newColumns = tab.columns.map(col => {
              if (col.panes.some(p => p.id === paneId)) {
                 const remaining = col.panes.filter(p => p.id !== paneId);
                 if (remaining.length === 0) return null; // Column empty
                 return { ...col, panes: remaining };
              }
              return col;
          }).filter(Boolean) as Column[];
          
          if (newColumns.length === 0) {
              return { ...tab, columns: [] }; // Will be filtered out below
          }
          
          // If column removed, update widths
          let newWidths = tab.columnWidths;
          if (newColumns.length < tab.columns.length) {
              // A column was removed. Reset to equal?
              // Or try to merge width to neighbor.
              // Simpler: Reset to equal.
              newWidths = Array(newColumns.length).fill(1 / newColumns.length);
          }
          
          // Update active ID if we closed the active one
          if (activeTabId === tab.id && tab.activePaneId === paneId) {
             // Find nearest
             const allPanes = newColumns.flatMap(c => c.panes);
             newActiveId = allPanes[allPanes.length - 1].id;
          }
          
          // Track this for focusing after state update
          if (activeTabId === tab.id) {
              newActivePaneIdForFocus = newActiveId;
          }
          
          return { ...tab, columns: newColumns, columnWidths: newWidths, activePaneId: newActiveId };
      }).filter(tab => tab.columns.length > 0)); // Remove empty tabs
      
      // Update activeTabId if the active tab was removed
      setTabs(currentTabs => {
          if (activeTabId && !currentTabs.find(t => t.id === activeTabId)) {
              // Active tab was removed, switch to another
              if (currentTabs.length > 0) {
                  const newActiveTab = currentTabs[currentTabs.length - 1]; // Last tab, or could find nearest
                  setActiveTabId(newActiveTab.id);
                  // Update focus target
                  newActivePaneIdForFocus = newActiveTab.activePaneId;
              } else {
                  setActiveTabId(null);
                  newActivePaneIdForFocus = null;
              }
          }
          return currentTabs;
      });
      
      // Focus the new active pane after close
      setTimeout(() => {
          if (newActivePaneIdForFocus) {
              const term = termRefs.current.get(newActivePaneIdForFocus);
              term?.focus();
          }
      }, 100);
      
      // Separate effect to remove empty tabs if needed
      termRefs.current.delete(paneId);
  };
  
  // Clean up empty tabs immediately
  useEffect(() => {
     setTabs(prev => {
         const emptyTabs = prev.filter(t => t.columns.length === 0);
         if (emptyTabs.length > 0) {
             return prev.filter(t => t.columns.length > 0);
         }
         return prev;
     });
  }, [tabs.map(t => t.columns.length).join(',')]);


  const resizePane = (colId: string, newRatio: number) => {
      setTabs(prev => prev.map(tab => {
          if (!tab.columns.find(c => c.id === colId)) return tab;
          return {
              ...tab,
              columns: tab.columns.map(c => c.id === colId ? { ...c, splitRatio: newRatio } : c)
          };
      }));
  };
  
  const resizeColumn = (colIndex: number, newRatio: number) => {
      setTabs(prev => prev.map(tab => {
          if (tab.id !== activeTabId) return tab;
          
          // colIndex is index of left column
          if (colIndex < 0 || colIndex >= tab.columns.length - 1) return tab;
          
          const currentLeft = tab.columnWidths[colIndex];
          const currentRight = tab.columnWidths[colIndex + 1];
          const combined = currentLeft + currentRight;
          
          // newRatio is the TARGET ratio for left column.
          // Constraints: min width (e.g., 0.1)
          const clampedRatio = Math.max(0.05, Math.min(combined - 0.05, newRatio));
          
          const newRight = combined - clampedRatio;
          
          const newWidths = [...tab.columnWidths];
          newWidths[colIndex] = clampedRatio;
          newWidths[colIndex + 1] = newRight;
          
          return { ...tab, columnWidths: newWidths };
      }));
  };

  const handleTitleChange = (paneId: string, path: string) => {
      setTabs(prev => prev.map(tab => {
          // Update Pane CWD
          let found = false;
          const newColumns = tab.columns.map(col => ({
             ...col,
             panes: col.panes.map(p => {
                 if (p.id === paneId) {
                     found = true;
                     return { ...p, cwd: path };
                 }
                 return p;
             })
          }));
          
          if (!found) return tab;
          
          // If this pane is active, update Tab title/cwd
          if (tab.activePaneId === paneId) {
              return { ...tab, title: path, cwd: path, columns: newColumns };
          }
          return { ...tab, columns: newColumns };
      }));
  };

  // --- Interaction ---

  const handlePaneActivate = (paneId: string) => {
     if (!activeTabId) return;
     setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, activePaneId: paneId } : t));
     
     // Focus the terminal so keyboard input works immediately
     requestAnimationFrame(() => {
        const term = termRefs.current.get(paneId);
        term?.focus();
     });
  };

  const scrollTabs = (direction: 'left' | 'right') => {
      if (!tabsContainerRef.current) return;
      const amount = 200;
      tabsContainerRef.current.scrollBy({ 
          left: direction === 'left' ? -amount : amount, 
          behavior: 'smooth' 
      });
  };
  
  const handleSendCommand = (command: string, execute: boolean) => {
      const tab = getActiveTab();
      if (!tab) return;
      
      const term = termRefs.current.get(tab.activePaneId);
      if (term) {
          const textToSend = execute ? `${command}\r` : command;
          term.send(textToSend);
          if (!execute) {
             term.focus();
          }
      }
  };

  // --- Maximize ---
  
  const toggleMaximize = () => {
      if (!activeTabId) return;
      const tab = getActiveTab();
      if (!tab) return;
      
      setTabs(prev => prev.map(t => {
          if (t.id !== activeTabId) return t;
          // Toggle: if already maximized, restore; else maximize active pane
          const newMaximized = t.maximizedPaneId ? null : t.activePaneId;
          return { ...t, maximizedPaneId: newMaximized };
      }));
      
      // Focus the active pane after toggle
      requestAnimationFrame(() => {
          const term = termRefs.current.get(tab.activePaneId);
          term?.focus();
      });
  };

  // --- Font Size Controls ---
  const DEFAULT_FONT_SIZE = 12;
  const MIN_FONT_SIZE = 8;
  const MAX_FONT_SIZE = 32;
  
  const changeFontSize = (paneId: string, delta: number) => {
      const term = termRefs.current.get(paneId);
      if (!term) return;
      const currentSize = term.getFontSize();
      const newSize = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, currentSize + delta));
      term.setFontSize(newSize);
  };
  
  const resetFontSize = (paneId: string) => {
      const term = termRefs.current.get(paneId);
      if (!term) return;
      term.setFontSize(DEFAULT_FONT_SIZE);
  };
  
  const increaseFontSize = () => {
      const tab = getActiveTab();
      if (tab) changeFontSize(tab.activePaneId, 2);
  };
  
  const decreaseFontSize = () => {
      const tab = getActiveTab();
      if (tab) changeFontSize(tab.activePaneId, -2);
  };
  
  const resetActivePaneFontSize = () => {
      const tab = getActiveTab();
      if (tab) resetFontSize(tab.activePaneId);
  };

  // --- Shortcuts ---

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        const isCmdOrCtrl = e.metaKey || e.ctrlKey;
        const isShift = e.shiftKey;
        const isAlt = e.altKey;

        // Switch Tabs Cmd+1-9
        if (isCmdOrCtrl && !isShift && !isAlt && e.key >= '1' && e.key <= '9') {
            e.preventDefault();
            const idx = parseInt(e.key) - 1;
            if (tabs[idx]) setActiveTabId(tabs[idx].id);
            return;
        }

        // Split Right: Cmd+D
        if (isCmdOrCtrl && !isShift && e.key.toLowerCase() === 'd') {
            e.preventDefault();
            splitRight();
            return;
        }

        // Split Down: Cmd+Shift+D
        if (isCmdOrCtrl && isShift && e.key.toLowerCase() === 'd') {
            e.preventDefault();
            splitVertical('down');
            return;
        }

        // Maximize Toggle: Cmd+Shift+Enter
        if (isCmdOrCtrl && isShift && e.key === 'Enter') {
            e.preventDefault();
            toggleMaximize();
            return;
        }

        // Font Size: Cmd+Plus, Cmd+Minus, Cmd+0
        if (isCmdOrCtrl && !isShift && (e.key === '=' || e.key === '+')) {
            e.preventDefault();
            increaseFontSize();
            return;
        }
        if (isCmdOrCtrl && !isShift && e.key === '-') {
            e.preventDefault();
            decreaseFontSize();
            return;
        }
        if (isCmdOrCtrl && !isShift && e.key === '0') {
            e.preventDefault();
            resetActivePaneFontSize();
            return;
        }
        
        // Toggle focus: Ctrl+` (backtick)
        if (e.ctrlKey && e.key === '`') {
            e.preventDefault();
            toggleInputFocus();
            return;
        }

        // Smart Close: Cmd+W
        // - If multiple panes, close active pane
        // - If single pane, close tab
        if (isCmdOrCtrl && !isShift && e.key === 'w') {
            e.preventDefault();
            const tab = getActiveTab();
            if (!tab) return;
            
            const totalPanes = tab.columns.reduce((acc, col) => acc + col.panes.length, 0);
            if (totalPanes > 1) {
                closePane(tab.activePaneId);
            } else {
                closeTab(tab.id);
            }
            return;
        }

        // Navigate Panes: Cmd+Opt+Arrows
        if (isCmdOrCtrl && isAlt) {
            const tab = getActiveTab();
            if (!tab) return;
            
            // Reconstruct grid to find neighbors
            // Flat list of visible panes for simple navigation?
            // Columns 0..N, each has 0..1 panes.
            
            // Current indices
            let colIdx = -1;
            let paneIdx = -1;
            
            tab.columns.forEach((c, ci) => {
                c.panes.forEach((p, pi) => {
                    if (p.id === tab.activePaneId) {
                        colIdx = ci;
                        paneIdx = pi;
                    }
                });
            });
            
            if (colIdx === -1) return;
            
            let nextStack: Column | undefined;
            let nextPaneId: string | undefined;

            if (e.key === 'ArrowLeft') {
                if (colIdx > 0) {
                     nextStack = tab.columns[colIdx - 1];
                     // Try to match vertical position (0 or 1)
                     nextPaneId = nextStack.panes[Math.min(paneIdx, nextStack.panes.length - 1)].id;
                }
            } else if (e.key === 'ArrowRight') {
                if (colIdx < tab.columns.length - 1) {
                     nextStack = tab.columns[colIdx + 1];
                     nextPaneId = nextStack.panes[Math.min(paneIdx, nextStack.panes.length - 1)].id;
                }
            } else if (e.key === 'ArrowUp') {
                if (paneIdx > 0) {
                     nextPaneId = tab.columns[colIdx].panes[paneIdx - 1].id;
                }
            } else if (e.key === 'ArrowDown') {
                 if (paneIdx < tab.columns[colIdx].panes.length - 1) {
                     nextPaneId = tab.columns[colIdx].panes[paneIdx + 1].id;
                 }
            }
            
            if (nextPaneId) {
                e.preventDefault();
                handlePaneActivate(nextPaneId);
            }
        }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [tabs, activeTabId]);

  // Global click to close context menu
  useEffect(() => {
      const handleClick = () => setContextMenu(null);
      window.addEventListener('click', handleClick);
      return () => window.removeEventListener('click', handleClick);
  }, []);

  // Listen for IPC "new-tab"
  useEffect(() => {
      const cleanup = window.electron?.on('new-tab', () => {
          createTab();
      });
      return cleanup;
  }, []);
  
  // Listen for toggle-command-input-focus from terminal
  useEffect(() => {
      const handler = () => {
          commandInputRef.current?.focus();
      };
      window.addEventListener('toggle-command-input-focus', handler);
      return () => window.removeEventListener('toggle-command-input-focus', handler);
  }, []);

  // Notify parent about active path and record visit
  useEffect(() => {
      if (!onActivePathChange) return;
      const tab = getActiveTab();
      if (tab?.cwd) {
          onActivePathChange(tab.cwd);
          window.electron?.invoke('shell:record-visit', tab.cwd).catch(console.error);
      }
  }, [tabs, activeTabId, onActivePathChange]);

  // Helper to format title
  const formatPath = (path: string) => {
      let display = path || 'Terminal';
      if (display.length > 20) {
          display = '...' + display.slice(-20);
      }
      return display;
  };
  
  const handleClear = (paneId?: string) => {
      const targetId = paneId || activeTab?.activePaneId;
      if (!targetId) return;
      
      const term = termRefs.current.get(targetId);
      term?.clear();
  };

  const handleCopy = (paneId: string) => {
      const term = termRefs.current.get(paneId);
      // Simplified copy using document command (usually picks up selection)
      document.execCommand('copy');
      setContextMenu(null);
  };

  const handlePaste = async (paneId: string) => {
      try {
          const text = await navigator.clipboard.readText();
          const term = termRefs.current.get(paneId);
          term?.send(text);
      } catch (e) {
          console.error('Failed to paste', e);
      }
      setContextMenu(null);
  };

  const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform);

  // Initial tab
  const initializedRef = useRef(false);
  useEffect(() => {
      if (initializedRef.current) return;
      if (tabs.length === 0) {
          initializedRef.current = true;
          createTab();
          // Auto focus CommandInput on startup
          setTimeout(() => {
              commandInputRef.current?.focus();
          }, 200);
      }
  }, []);
  
  // Toggle focus between terminal and CommandInput
  const toggleInputFocus = () => {
      const tab = getActiveTab();
      if (!tab) return;
      
      // Check if any textarea has focus (CommandInput)
      const activeElement = document.activeElement;
      const isTextareaFocused = activeElement?.tagName === 'TEXTAREA';
      
      if (isTextareaFocused) {
          // Focus terminal
          const term = termRefs.current.get(tab.activePaneId);
          term?.focus();
      } else {
          // Focus CommandInput
          commandInputRef.current?.focus();
      }
  };

  const activeTab = getActiveTab();

  return (
    <div className="flex flex-col h-full bg-background font-mono text-sm">
      {/* Tab Bar */}
      <div className="relative flex bg-tab-inactive select-none shrink-0" style={{ height: '30px' }}>
        {/* Bottom border that active tab will cover */}
        <div className="absolute bottom-0 left-0 right-0 h-px bg-border" />
        <div 
           ref={tabsContainerRef}
           className="flex-1 flex h-full overflow-x-auto no-scrollbar scroll-smooth"
        >
            {tabs.map((tab, idx) => (
                <div 
                  key={tab.id}
                  onClick={() => setActiveTabId(tab.id)}
                  onContextMenu={(e) => {
                      e.preventDefault();
                      setContextMenu({ x: e.clientX, y: e.clientY, tabId: tab.id, type: 'tab' });
                  }}
                  title={tab.cwd || 'Terminal'}
                  className={clsx(
                      "flex items-center px-2 cursor-pointer transition-colors border-r border-border min-w-[220px] max-w-[220px]",
                      activeTabId === tab.id 
                        ? "relative z-10 bg-tab-active text-text-main font-bold h-[calc(100%+1px)] border-t-2 border-t-primary" 
                        : "text-text-sec bg-tab-inactive hover:bg-elevated hover:text-text-main h-full",
                      "whitespace-nowrap"
                  )}
                >
                    <span 
                        className="w-full text-center font-mono text-xs whitespace-nowrap overflow-hidden flex items-center justify-center gap-1"
                        style={{ direction: 'rtl' }}
                    >
                        {tab.maximizedPaneId && (
                            <Maximize2 size={12} className="text-primary shrink-0" />
                        )}
                        <bdi className="flex items-center">
                            {idx < 9 && (
                                <span className="mr-1.5 opacity-80 inline-flex items-baseline">
                                     {isMac ? (
                                        <span className="pr-1 text-sm leading-3 relative top-[1px]">⌘</span>
                                     ) : '^'}
                                     <span>{idx + 1}</span>
                                </span>
                            )}
                            {formatPath(tab.cwd || 'Terminal')}
                        </bdi>
                    </span>
                </div>
            ))}
            
            <button 
                onClick={createTab}
                className="px-3 h-full flex items-center justify-center text-text-muted hover:text-text-main hover:bg-elevated border-r border-border"
            >
                <Plus size={14} />
            </button>
        </div>

        <div className="flex items-center bg-tab-inactive border-l border-border h-full">
            <button onClick={() => scrollTabs('left')} className="p-2 h-full hover:bg-elevated hover:text-text-main text-text-muted">
                <ChevronLeft size={14} />
            </button>
            <button onClick={() => scrollTabs('right')} className="p-2 h-full hover:bg-elevated hover:text-text-main text-text-muted">
                <ChevronRight size={14} />
            </button>
        </div>
      </div>

      {/* Terminal Grid */}
      <div className="flex-1 relative overflow-hidden bg-background p-1 flex flex-col min-h-0">
          <div className="flex-1 overflow-hidden relative">
              {activeTab ? (
                  <SplitLayout
                      columns={activeTab.columns}
                      activePaneId={activeTab.activePaneId}
                      maximizedPaneId={activeTab.maximizedPaneId}
                      columnRatios={activeTab.columnWidths}
                      onPaneActivate={handlePaneActivate}
                      onTitleChange={handleTitleChange}
                      onExit={closePane}
                      onResizePane={resizePane}
                      onResizeColumn={resizeColumn}
                      registerTerminalRef={(id, ref) => {
                          if(ref) termRefs.current.set(id, ref);
                          else termRefs.current.delete(id);
                      }}
                      onContextMenu={(e, paneId) => {
                          e.preventDefault();
                          setContextMenu({ x: e.clientX, y: e.clientY, paneId, type: 'pane' });
                      }}
                  />
              ) : (
                 <div className="flex flex-col items-center justify-center h-full text-gray-500">
                     <Monitor size={48} className="mb-4 opacity-20" />
                     <p>No active terminals</p>
                     <button onClick={createTab} className="mt-4 px-4 py-2 bg-primary/10 text-primary rounded-lg hover:bg-primary/20 transition-colors">
                         Open New Terminal
                     </button>
                 </div>
              )}
          </div>
          
          <div className="shrink-0 z-10">
              <CommandInput 
                  ref={commandInputRef}
                  onSend={handleSendCommand}
                  onClear={() => handleClear()}
                  cwd={activeTab?.cwd || ''}
              />
          </div>
      </div>

      {/* Context Menu */}
      {contextMenu && (() => {
           // Position logic: if near bottom, open upwards
           const MENU_HEIGHT = 280; // Estimated height with all items
           const windowHeight = window.innerHeight;
           
           let top = contextMenu.y;
           const isNearBottom = contextMenu.y + MENU_HEIGHT > windowHeight;
           
           // If near bottom, place bottom of menu at click position (or slightly above)
           if (isNearBottom) {
               top = Math.max(0, contextMenu.y - MENU_HEIGHT);
           }

           return (
              <div 
                 className="fixed z-50 bg-surface border border-border shadow-xl text-primary text-xs py-1 rounded w-40 select-none"
                 style={{ top, left: contextMenu.x }}
                 onClick={(e) => e.stopPropagation()}
              >
                  {contextMenu.type === 'tab' ? (
                      <>
                          <button 
                             onClick={() => { 
                               const tab = tabs.find(t => t.id === contextMenu.tabId);
                               if (tab?.cwd) {
                                 navigator.clipboard.writeText(tab.cwd);
                               }
                               setContextMenu(null); 
                             }}
                             className="w-full text-left px-3 py-1.5 hover:bg-primary hover:text-white"
                          >
                              Copy Path
                          </button>
                          <div className="h-px bg-border my-1" />
                          <button 
                             onClick={() => { closeTab(contextMenu.tabId); setContextMenu(null); }}
                             className="w-full text-left px-3 py-1.5 hover:bg-primary hover:text-white"
                          >
                              Close Tab
                          </button>
                          <button 
                             onClick={() => { closeOthers(contextMenu.tabId); setContextMenu(null); }}
                             className="w-full text-left px-3 py-1.5 hover:bg-primary hover:text-white"
                          >
                              Close Others
                          </button>
                          <button 
                             onClick={() => { closeToRight(contextMenu.tabId); setContextMenu(null); }}
                             className="w-full text-left px-3 py-1.5 hover:bg-primary hover:text-white"
                          >
                              Close to Right
                          </button>
                      </>
                  ) : (() => {
                      // Pane Context Menu
                      const canSplitRight = (activeTab?.columns.length || 0) < 4;
                      const globalTargetId = 'paneId' in contextMenu ? contextMenu.paneId : '';
                      const targetCol = activeTab?.columns.find(c => c.panes.some(p => p.id === globalTargetId));
                      const canSplitVertical = targetCol ? targetCol.panes.length < 2 : false;
                      const isMaximized = !!activeTab?.maximizedPaneId;
                      
                      return (
                      <>
                          {/* Copy / Paste */}
                          <button 
                             onClick={() => handleCopy(globalTargetId)}
                             className="w-full text-left px-3 py-1.5 hover:bg-primary hover:text-white flex justify-between"
                          >
                              <span>Copy</span>
                              <span className="opacity-50">⌘C</span>
                          </button>
                          <button 
                             onClick={() => handlePaste(globalTargetId)}
                             className="w-full text-left px-3 py-1.5 hover:bg-primary hover:text-white flex justify-between"
                          >
                              <span>Paste</span>
                              <span className="opacity-50">⌘V</span>
                          </button>
                          
                          <div className="h-px bg-border my-1" />

                          <button 
                             onClick={() => { if(canSplitRight) { splitRight(); setContextMenu(null); } }}
                             disabled={!canSplitRight}
                             className="w-full text-left px-3 py-1.5 hover:bg-primary hover:text-white disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-current flex justify-between"
                          >
                              <span>Split Right</span>
                              <span className="opacity-50">⌘D</span>
                          </button>
                          <button 
                             onClick={() => { if(canSplitVertical) { splitVertical('down', globalTargetId); setContextMenu(null); } }}
                             disabled={!canSplitVertical}
                             className="w-full text-left px-3 py-1.5 hover:bg-primary hover:text-white disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-current flex justify-between"
                          >
                              <span>Split Down</span>
                              <span className="opacity-50">⇧⌘D</span>
                          </button>
                          
                          <div className="h-px bg-border my-1" />
                          
                          <button 
                             onClick={() => { toggleMaximize(); setContextMenu(null); }}
                             className="w-full text-left px-3 py-1.5 hover:bg-primary hover:text-white flex justify-between"
                          >
                              <span>{isMaximized ? 'Restore' : 'Maximize'}</span>
                              <span className="opacity-50">⇧⌘↵</span>
                          </button>

                          <div className="h-px bg-border my-1" />

                          <button 
                             onClick={() => { changeFontSize(globalTargetId, 2); setContextMenu(null); }}
                             className="w-full text-left px-3 py-1.5 hover:bg-primary hover:text-white flex justify-between"
                          >
                              <span>Zoom In</span>
                              <span className="opacity-50">⌘+</span>
                          </button>
                          <button 
                             onClick={() => { changeFontSize(globalTargetId, -2); setContextMenu(null); }}
                             className="w-full text-left px-3 py-1.5 hover:bg-primary hover:text-white flex justify-between"
                          >
                              <span>Zoom Out</span>
                              <span className="opacity-50">⌘-</span>
                          </button>
                          <button 
                             onClick={() => { resetFontSize(globalTargetId); setContextMenu(null); }}
                             className="w-full text-left px-3 py-1.5 hover:bg-primary hover:text-white flex justify-between"
                          >
                              <span>Reset Zoom</span>
                              <span className="opacity-50">⌘0</span>
                          </button>

                          <div className="h-px bg-border my-1" />

                          <button 
                             onClick={() => { if(globalTargetId) { closePane(globalTargetId); setContextMenu(null); } }}
                             className="w-full text-left px-3 py-1.5 hover:bg-red-500/20 hover:text-red-400 text-red-500/80 flex justify-between"
                          >
                              <span>Close Pane</span>
                              <span className="opacity-50">⌘W</span>
                          </button>
                      </>
                      );
                  })()}
              </div>
           );
      })()}
    </div>
  );
}
