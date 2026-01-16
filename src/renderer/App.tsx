import React, { useState, useRef, useEffect, useCallback } from 'react';
import { TerminalSquare, Server, Settings as SettingsIcon, MessageSquare } from 'lucide-react';
import { clsx } from 'clsx';
import { Settings } from './components/Settings/Settings';
import { Chat } from './components/Chat/Chat';
import { TerminalView } from './components/Terminal/TerminalView';
import { ErrorBoundary } from './components/ErrorBoundary';

const SSHView = () => <div className="p-4 text-gray-400">SSH Servers (Placeholder)</div>;

export default function App() {
  const [activeTab, setActiveTab] = useState<'terminal' | 'ssh' | 'settings'>('terminal');
  const [isAIPanelOpen, setIsAIPanelOpen] = useState(false);
  const [aiPanelWidth, setAiPanelWidth] = useState(450);
  const [isResizing, setIsResizing] = useState(false);

  const NavItem = ({ id, icon: Icon, title }: { id: typeof activeTab, icon: any, title: string }) => (
    <button
      onClick={() => setActiveTab(id)}
      title={title}
      className={clsx(
        "p-2 rounded-lg mb-2 transition-colors",
        activeTab === id 
          ? "bg-primary/20 text-primary" 
          : "text-gray-400 hover:text-gray-100 hover:bg-white/5"
      )}
    >
      <Icon size={20} strokeWidth={2} />
    </button>
  );

  // Resize Logic
  const startResizing = useCallback((e: React.MouseEvent) => {
      e.preventDefault();
      setIsResizing(true);
  }, []);

  useEffect(() => {
      if (!isResizing) return;

      const handleMouseMove = (e: MouseEvent) => {
          const windowWidth = window.innerWidth;
          const newWidth = windowWidth - e.clientX; 
          // Right panel width = total - mouseX
          
          // Constraints
          // 1. AI Panel Min: 380px
          // 2. Terminal (Left) Min: 250px => Max AI Width = windowWidth - 250 - 48 (sidebar)
          const sidebarWidth = 48;
          const maxAiWidth = windowWidth - 250 - sidebarWidth;
          
          if (newWidth >= 380 && newWidth <= maxAiWidth) {
              setAiPanelWidth(newWidth);
          }
      };

      const handleMouseUp = () => {
          setIsResizing(false);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);

      return () => {
          document.removeEventListener('mousemove', handleMouseMove);
          document.removeEventListener('mouseup', handleMouseUp);
      };
  }, [isResizing]);

  return (
    <ErrorBoundary>
        <div className="flex h-screen w-screen bg-background overflow-hidden relative">
          {/* Sidebar */}
          <div className="w-12 bg-surface/50 border-r border-border flex flex-col items-center py-4 z-10">
            <NavItem id="terminal" icon={TerminalSquare} title="Terminal" />
            <NavItem id="ssh" icon={Server} title="SSH Servers" />
            <div className="flex-1" />
            {/* AI Toggle Button */}
            <button
              onClick={() => setIsAIPanelOpen(!isAIPanelOpen)}
              title="Toggle AI Chat"
              className={clsx(
                "p-2 rounded-lg mb-2 transition-colors",
                isAIPanelOpen
                  ? "bg-purple-500/20 text-purple-400" 
                  : "text-gray-400 hover:text-gray-100 hover:bg-white/5"
              )}
            >
              <MessageSquare size={20} strokeWidth={2} />
            </button>
            <NavItem id="settings" icon={SettingsIcon} title="Settings" />
          </div>

          {/* Main Content Area */}
          <div className="flex-1 flex overflow-hidden">
             
             {/* Left Pane (Terminal/Settings) - Flex Grow */}
             <div className="flex-1 overflow-hidden relative min-w-[250px]">
                {activeTab === 'terminal' && <TerminalView />}
                {activeTab === 'ssh' && <SSHView />}
                {activeTab === 'settings' && <Settings />}
             </div>

             {/* Resizer & AI Panel */}
             {isAIPanelOpen && (
                 <>
                    {/* Resizer Handle */}
                    <div 
                        onMouseDown={startResizing}
                        className={clsx(
                            "w-1 h-full cursor-col-resize hover:bg-primary transition-colors z-20",
                            isResizing ? "bg-primary" : "bg-border"
                        )}
                    />
                    
                    {/* AI Panel */}
                    <div 
                       style={{ width: aiPanelWidth }}
                       className="border-l border-border bg-background shadow-2xl flex flex-col h-full relative"
                    >
                         <ErrorBoundary>
                             <Chat />
                         </ErrorBoundary>
                    </div>
                 </>
             )}
          </div>
          
          {/* Overlay for resizing safety */}
          {isResizing && (
              <div className="absolute inset-0 z-50 cursor-col-resize" />
          )}
        </div>
    </ErrorBoundary>
  );
}
