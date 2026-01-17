import React, { useState, useRef, useEffect } from 'react';
import { Plus, X, Monitor, ChevronLeft, ChevronRight } from 'lucide-react';
import { clsx } from 'clsx';
import { TerminalInstance, TerminalRef } from './TerminalInstance';
import { CommandInput } from './CommandInput';

interface Tab {
  id: string;
  title: string;
  cwd: string;
}

export function TerminalView() {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, tabId: string } | null>(null);
  const tabCounter = useRef(0);
  const tabsContainerRef = useRef<HTMLDivElement>(null);
  
  // Refs for terminal instances
  const termRefs = useRef<Map<string, TerminalRef>>(new Map());

  // --- Logic ---

  const createTab = () => {
      tabCounter.current += 1;
      const newId = `tab-${tabCounter.current}`;
      const newTab = { id: newId, title: 'Terminal', cwd: '' };
      
      setTabs(prev => [...prev, newTab]);
      setActiveTabId(newId);
  };

  const closeTab = (id: string) => {
      setTabs(prev => {
          const idx = prev.findIndex(t => t.id === id);
          if (idx === -1) return prev;
          
          const newTabs = prev.filter(t => t.id !== id);
          if (activeTabId === id) {
             // Activate adjacent or last
             if (newTabs.length > 0) {
                 // Try to keep index, else go last
                 const nextTab = newTabs[idx] || newTabs[newTabs.length - 1];
                 setActiveTabId(nextTab.id);
             } else {
                 setActiveTabId(null);
             }
          }
          return newTabs;
      });
      termRefs.current.delete(id);
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

  const handleTitleChange = (id: string, path: string) => {
      setTabs(prev => prev.map(t => t.id === id ? { ...t, title: path, cwd: path } : t));
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
      if (!activeTabId) return;
      const term = termRefs.current.get(activeTabId);
      if (term) {
          // If execute is true, append \r (enter). If false, just paste text.
          const textToSend = execute ? `${command}\r` : command;
          term.send(textToSend);
          term.focus();
      }
  };

  // --- Shortcuts ---

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        const isCmdOrCtrl = e.metaKey || e.ctrlKey;

        // Switch Tabs Cmd+1-9
        if (isCmdOrCtrl && e.key >= '1' && e.key <= '9') {
            e.preventDefault();
            const idx = parseInt(e.key) - 1;
            if (tabs[idx]) setActiveTabId(tabs[idx].id);
        }

        // Switch Cmd+Left/Right
        if (isCmdOrCtrl && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
             e.preventDefault();
             if (!activeTabId) return;
             const currIdx = tabs.findIndex(t => t.id === activeTabId);
             if (currIdx === -1) return;

             if (e.key === 'ArrowLeft' && currIdx > 0) {
                 setActiveTabId(tabs[currIdx - 1].id);
             } else if (e.key === 'ArrowRight' && currIdx < tabs.length - 1) {
                 setActiveTabId(tabs[currIdx + 1].id);
             }
        }

        // Close Cmd+W
        if (isCmdOrCtrl && e.key === 'w') {
            e.preventDefault();
            if (activeTabId) closeTab(activeTabId);
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


  // --- Helper to format title ---
  const formatTitle = (path: string, index: number) => {
      let display = path || 'Terminal';
      if (display.length > 22) {
          display = '...' + display.slice(-22);
      }
      if (index < 9) {
          display = `[${index + 1}] ${display}`;
      }
      return display;
  };

  // Initial tab - use ref to guard against StrictMode double invocation
  const initializedRef = useRef(false);
  useEffect(() => {
      if (initializedRef.current) return;
      if (tabs.length === 0) {
          initializedRef.current = true;
          createTab();
      }
  }, []);

  return (
    <div className="flex flex-col h-full bg-background font-mono text-sm">
      {/* Tab Bar */}
      <div className="flex bg-surface/50 border-b border-border select-none shrink-0" style={{ height: '40px' }}>
        {/* Tab Container */}
        <div 
           ref={tabsContainerRef}
           className="flex-1 flex h-full overflow-x-auto no-scrollbar scroll-smooth"
           onWheel={(e) => {
               if (e.shiftKey) return; 
           }}
        >
            {tabs.map((tab, idx) => (
                <div 
                  key={tab.id}
                  onClick={() => setActiveTabId(tab.id)}
                  onContextMenu={(e) => {
                      e.preventDefault();
                      setContextMenu({ x: e.clientX, y: e.clientY, tabId: tab.id });
                  }}
                  title={tab.cwd || 'Terminal'} // Hover shows full path
                  className={clsx(
                      "flex items-center px-2 h-full cursor-pointer transition-colors border-r border-border min-w-[180px] max-w-[180px]", // Increased width
                      activeTabId === tab.id ? "bg-background text-white font-bold" : "text-gray-400 bg-surface hover:bg-surface/80",
                      "whitespace-nowrap"
                  )}
                >
                    <span 
                        className="w-full text-center font-mono text-[11px] whitespace-nowrap overflow-hidden"
                        style={{ direction: 'rtl' }}
                    >
                        <bdi>{formatTitle(tab.cwd || 'Terminal', idx)}</bdi>
                    </span>
                    {/* No X button as requested */}
                </div>
            ))}
            
            {/* New Tab Button (Inline) */}
            <button 
                onClick={createTab}
                className="px-3 h-full flex items-center justify-center text-gray-500 hover:text-white hover:bg-white/5 border-r border-border"
                title="New Tab"
            >
                <Plus size={14} />
            </button>
        </div>

        {/* Scroll Controls */}
        <div className="flex items-center bg-surface border-l border-border h-full">
            <button 
               onClick={() => scrollTabs('left')}
               className="p-2 h-full hover:bg-white/5 hover:text-white text-gray-500"
            >
                <ChevronLeft size={14} />
            </button>
            <button 
               onClick={() => scrollTabs('right')}
               className="p-2 h-full hover:bg-white/5 hover:text-white text-gray-500"
            >
                <ChevronRight size={14} />
            </button>
        </div>
      </div>

      {/* Terminal Area (Flex Grow) */}
      <div className="flex-1 relative overflow-hidden bg-[#1a1a1a] p-1 flex flex-col min-h-0">
          <div className="flex-1 overflow-hidden relative">
              {tabs.map(tab => (
                  <TerminalInstance
                      key={tab.id}
                      id={tab.id}
                      isActive={activeTabId === tab.id}
                      ref={(el) => {
                          if (el) termRefs.current.set(tab.id, el);
                          else termRefs.current.delete(tab.id);
                      }}
                      onTitleChange={handleTitleChange}
                      onExit={() => closeTab(tab.id)} 
                  />
              ))}
              
              {tabs.length === 0 && (
                 <div className="flex flex-col items-center justify-center h-full text-gray-500">
                     <Monitor size={48} className="mb-4 opacity-20" />
                     <p>No active terminals</p>
                     <button onClick={createTab} className="mt-4 px-4 py-2 bg-primary/10 text-primary rounded-lg hover:bg-primary/20 transition-colors">
                         Open New Terminal
                     </button>
                 </div>
              )}
          </div>
          
          {/* Command Input Area (Bottom) */}
          <div className="shrink-0 z-10">
              <CommandInput onSend={handleSendCommand} />
          </div>
      </div>

      {/* Context Menu */}
      {contextMenu && (
          <div 
             className="fixed z-50 bg-[#262626] border border-[#404040] shadow-xl text-gray-200 text-xs py-1 rounded w-40"
             style={{ top: contextMenu.y, left: contextMenu.x }}
             onClick={(e) => e.stopPropagation()} // Prevent closing immediately
          >
              <button 
                 onClick={() => { closeTab(contextMenu.tabId); setContextMenu(null); }}
                 className="w-full text-left px-3 py-1.5 hover:bg-primary hover:text-white"
              >
                  Close
              </button>
              <button 
                 onClick={() => { closeOthers(contextMenu.tabId); setContextMenu(null); }}
                 className="w-full text-left px-3 py-1.5 hover:bg-primary hover:text-white"
              >
                  Close Others
              </button>
              <div className="h-[1px] bg-[#404040] my-1" />
              <button 
                 onClick={() => { closeToRight(contextMenu.tabId); setContextMenu(null); }}
                 className="w-full text-left px-3 py-1.5 hover:bg-primary hover:text-white"
              >
                  Close to the Right
              </button>
              <button 
                 onClick={() => { closeToLeft(contextMenu.tabId); setContextMenu(null); }}
                 className="w-full text-left px-3 py-1.5 hover:bg-primary hover:text-white"
              >
                  Close to the Left
              </button>
          </div>
      )}
    </div>
  );
}
