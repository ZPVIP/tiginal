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
  
  // Layout State
  const [showTerminal, setShowTerminal] = useState(true);
  const [showChat, setShowChat] = useState(true);
  const [chatRatio, setChatRatio] = useState(0.4); // Default 40% for chat, 60% for terminal

  // Resizing State
  const [isResizing, setIsResizing] = useState(false);
  
  // Load Layout State
  useEffect(() => {
    try {
      const savedLayout = localStorage.getItem('app-layout-config');
      if (savedLayout) {
        const config = JSON.parse(savedLayout);
        if (typeof config.showTerminal === 'boolean') setShowTerminal(config.showTerminal);
        if (typeof config.showChat === 'boolean') setShowChat(config.showChat);
        if (typeof config.chatRatio === 'number') setChatRatio(config.chatRatio);
      }
    } catch (e) {
      console.error('Failed to load layout config:', e);
    }
  }, []);

  // Save Layout State
  useEffect(() => {
    const config = { showTerminal, showChat, chatRatio };
    localStorage.setItem('app-layout-config', JSON.stringify(config));
  }, [showTerminal, showChat, chatRatio]);


  const NavItem = ({ id, icon: Icon, title, onClick, isActive }: { id: string, icon: any, title: string, onClick?: () => void, isActive?: boolean }) => (
    <button
      onClick={onClick}
      title={title}
      className={clsx(
        "p-2 rounded-lg mb-2 transition-colors",
        isActive 
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
          const sidebarWidth = 48;
          const availableWidth = windowWidth - sidebarWidth;
          
          // chatRatio = chatWidth / availableWidth
          // Mouse X relative to available area start (sidebarWidth)
          const mouseX = e.clientX - sidebarWidth;
          
          // Calculate new Terminal Ratio based on Mouse X
          // Terminal Width = mouseX
          // Chat Width = availableWidth - mouseX
          // Chat Ratio = (availableWidth - mouseX) / availableWidth
          
          let newChatRatio = (availableWidth - mouseX) / availableWidth;
          
          // Constraints: Min 20% each
          newChatRatio = Math.max(0.2, Math.min(0.8, newChatRatio));
          
          setChatRatio(newChatRatio);
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

  // Toggle Handlers
  const toggleTerminal = () => {
    // If only terminal is shown, do nothing (cannot deactivate)
    if (showTerminal && !showChat) return;
    
    // If hidden, show it
    if (!showTerminal) {
       setShowTerminal(true);
       return;
    }
    
    // If visible (and chat is also visible), hide it -> Chat becomes full
    if (showTerminal && showChat) {
        setShowTerminal(false);
    }
  };

  const toggleChat = () => {
     // If only chat is shown, do nothing
     if (showChat && !showTerminal) return;

     // If hidden, show it
     if (!showChat) {
         setShowChat(true);
         return;
     }

     // If visible (and terminal is visible), hide it -> Terminal becomes full
     if (showChat && showTerminal) {
         setShowChat(false);
     }
  };
  
  const handleNavClick = (id: 'terminal' | 'ssh' | 'settings') => {
      setActiveTab(id);
      // Ensure terminal panel is visible if we click a nav item intended for it
      if (!showTerminal) {
          setShowTerminal(true);
          // If in full chat mode, maybe split or switch?
          // Requirement: "If only AI Chat selected... click Terminal... display Terminal window"
          // It implies restoring split view OR switching full view.
          // "比例跟关闭的时候一样" -> implies restore split.
      }
  };


  return (
    <ErrorBoundary>
        <div className="flex flex-col h-screen w-screen bg-background overflow-hidden relative">
          {/* Custom Title Bar */}
          <div 
            className="h-8 bg-surface/50 border-b border-border w-full flex items-center shrink-0"
            style={{ WebkitAppRegion: 'drag' } as any}
          >
             {/* Title Bar Content (Traffic lights sit here natively) */}
          </div>

          <div className="flex-1 flex overflow-hidden">
            {/* Sidebar */}
            <div className="w-12 bg-surface/50 border-r border-border flex flex-col items-center py-4 z-10 shrink-0 select-none">
                <NavItem 
                id="terminal" 
                icon={TerminalSquare} 
                title="Terminal" 
                isActive={showTerminal && activeTab === 'terminal'}
                onClick={() => {
                    handleNavClick('terminal'); 
                    // Special toggle logic only if already active tab
                    if (activeTab === 'terminal') toggleTerminal();
                    else setActiveTab('terminal');
                }}
                />
                
                {/* AI Toggle Button - Moved below Terminal */}
                <button
                onClick={toggleChat}
                title="Toggle AI Chat"
                className={clsx(
                    "p-2 rounded-lg mb-2 transition-colors",
                    showChat
                    ? "bg-purple-500/20 text-purple-400" 
                    : "text-gray-400 hover:text-gray-100 hover:bg-white/5"
                )}
                >
                <MessageSquare size={20} strokeWidth={2} />
                </button>
                
                <NavItem 
                id="ssh" 
                icon={Server} 
                title="SSH Servers" 
                isActive={showTerminal && activeTab === 'ssh'}
                onClick={() => {
                    handleNavClick('ssh');
                    if (activeTab === 'ssh') toggleTerminal();
                }}
                />
                
                <div className="flex-1" />
                
                <NavItem 
                id="settings" 
                icon={SettingsIcon} 
                title="Settings" 
                isActive={showTerminal && activeTab === 'settings'}
                onClick={() => {
                    handleNavClick('settings');
                    if (activeTab === 'settings') toggleTerminal(); 
                }}
                />
            </div>

            {/* Main Content Area */}
            <div className="flex-1 flex overflow-hidden w-full">
             
             {/* Left Pane (Terminal/Settings) */}
             {showTerminal && (
                 <div 
                    className="flex-1 overflow-hidden relative min-w-0"
                    style={{ 
                        flexGrow: showChat ? (1 - chatRatio) : 1,
                        flexShrink: 0,
                        flexBasis: showChat ? '0%' : '100%' 
                    }}
                 >
                    {/* Screens are always mounted to preserve state */}
                    <div className={clsx("h-full w-full", activeTab !== 'terminal' && "hidden")}>
                        <TerminalView />
                    </div>
                    {activeTab === 'ssh' && <SSHView />}
                    {activeTab === 'settings' && <Settings />}
                 </div>
             )}

             {/* Resizer */}
             {showTerminal && showChat && (
                 <div 
                    onMouseDown={startResizing}
                    className={clsx(
                        "w-1 h-full cursor-col-resize hover:bg-primary transition-colors z-20 shrink-0",
                        isResizing ? "bg-primary" : "bg-border"
                    )}
                />
             )}
             
             {/* AI Panel */}
             {showChat && (
                 <div 
                    className="border-l border-border bg-background shadow-2xl flex flex-col h-full relative min-w-0"
                    style={{ 
                        flexGrow: showTerminal ? chatRatio : 1, 
                        flexShrink: 0,
                        flexBasis: showTerminal ? '0%' : '100%'
                    }}
                 >
                     <ErrorBoundary>
                         <Chat />
                     </ErrorBoundary>
                 </div>
             )}
          </div>
          </div>
          
          {/* Overlay for resizing safety */}
          {isResizing && (
              <div className="absolute inset-0 z-50 cursor-col-resize" />
          )}
        </div>
    </ErrorBoundary>
  );
}
