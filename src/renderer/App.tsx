import React, { useState, useRef, useEffect, useCallback } from 'react';
import { TerminalSquare, Server, Settings as SettingsIcon, MessageSquare, PanelLeft, PanelLeftClose } from 'lucide-react';
import { clsx } from 'clsx';
import { SettingsModal } from './components/Settings/SettingsModal';
import { Chat, ChatHandle } from './components/Chat/Chat';
import { TerminalView } from './components/Terminal/TerminalView';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Drawer } from './components/Drawer/Drawer';

const SSHView = () => <div className="p-4 text-text-muted">SSH Servers (Placeholder)</div>;

// Platform detection
const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform);

export default function App() {
  const [activeTab, setActiveTab] = useState<'terminal' | 'ssh'>('terminal');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  
  // Layout State
  const [showTerminal, setShowTerminal] = useState(true);
  const [showChat, setShowChat] = useState(true);
  const [chatRatio, setChatRatio] = useState(0.4); // Default 40% for chat, 60% for terminal

  // Resizing State
  const [isResizing, setIsResizing] = useState(false);

  // Terminal State (path now managed by TerminalView for context menu)
  const [activeTerminalPath, setActiveTerminalPath] = useState('');

  // Drawer State
  const [isDrawerOpen, setIsDrawerOpen] = useState(true);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const chatRef = useRef<ChatHandle>(null);
  
  // Load Layout State
  useEffect(() => {
    try {
      const savedLayout = localStorage.getItem('app-layout-config');
      if (savedLayout) {
        const config = JSON.parse(savedLayout);
        if (typeof config.showTerminal === 'boolean') setShowTerminal(config.showTerminal);
        if (typeof config.showChat === 'boolean') setShowChat(config.showChat);
        if (typeof config.chatRatio === 'number') setChatRatio(config.chatRatio);
        if (typeof config.isDrawerOpen === 'boolean') setIsDrawerOpen(config.isDrawerOpen);
      }
    } catch (e) {
      console.error('Failed to load layout config:', e);
    }
  }, []);

  // Save Layout State
  useEffect(() => {
    const config = { showTerminal, showChat, chatRatio, isDrawerOpen };
    localStorage.setItem('app-layout-config', JSON.stringify(config));
  }, [showTerminal, showChat, chatRatio, isDrawerOpen]);


  const NavItem = ({ id, icon: Icon, title, onClick, isActive }: { id: string, icon: any, title: string, onClick?: () => void, isActive?: boolean }) => (
    <button
      onClick={onClick}
      title={title}
      className={clsx(
        "p-1.5 rounded-md transition-colors",
        isActive 
          ? "bg-primary/20 text-primary" 
          : "text-text-sec hover:text-text-main hover:bg-[var(--tab-hover)]"
      )}
    >
      <Icon size={16} strokeWidth={2} />
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
          const availableWidth = windowWidth;
          
          // chatRatio = chatWidth / availableWidth
          // Chat is now on the LEFT, so chatWidth = mouseX
          const mouseX = e.clientX;
          
          // Calculate new Chat Ratio based on Mouse X
          // Chat Width = mouseX
          // Terminal Width = availableWidth - mouseX
          // Chat Ratio = mouseX / availableWidth
          
          let newChatRatio = mouseX / availableWidth;
          
          // Constraints: Min 450px for Chat
          const minChatWidth = 450;
          const minChatRatio = minChatWidth / availableWidth;
          
          let maxRatio = 0.8;

          newChatRatio = Math.max(minChatRatio, Math.min(maxRatio, newChatRatio));
          
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
  
  const handleNavClick = (id: 'terminal' | 'ssh') => {
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
          {/* Custom Title Bar with Nav Buttons */}
          <div 
            className="h-8 bg-surface/50 border-b border-border w-full flex items-center justify-between shrink-0"
            style={{ WebkitAppRegion: 'drag' } as any}
          >
             {/* Left spacer for macOS traffic lights */}
             <div className="w-[68px] shrink-0" />
             
             {/* Drawer Toggle Button */}
             <div 
               className="flex items-center h-full"
               style={{ WebkitAppRegion: 'no-drag' } as any}
             >
               <button
                 onClick={() => setIsDrawerOpen(!isDrawerOpen)}
                 className="p-1.5 rounded-md transition-colors text-text-sec hover:text-text-main hover:bg-[var(--tab-hover)]"
                 title={isDrawerOpen ? 'Close drawer' : 'Open drawer'}
               >
                 {isDrawerOpen ? <PanelLeftClose size={16} strokeWidth={2} /> : <PanelLeft size={16} strokeWidth={2} />}
               </button>
             </div>
             
             {/* Right side: Nav buttons */}
             <div 
               className="flex items-center gap-0.5 px-2 h-full"
               style={{ 
                 WebkitAppRegion: 'no-drag',
                 marginRight: isMac ? 8 : 140 // Leave space for Windows/Linux window controls
               } as any}
             >
               <NavItem 
                 id="chat" 
                 icon={MessageSquare} 
                 title="AI Chat" 
                 isActive={showChat}
                 onClick={toggleChat}
               />
               <NavItem 
                 id="terminal" 
                 icon={TerminalSquare} 
                 title="Terminal" 
                 isActive={showTerminal && activeTab === 'terminal'}
                 onClick={() => {
                   handleNavClick('terminal'); 
                   if (activeTab === 'terminal') toggleTerminal();
                   else setActiveTab('terminal');
                 }}
               />
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
               <NavItem 
                 id="settings" 
                 icon={SettingsIcon} 
                 title="Settings" 
                 isActive={isSettingsOpen}
                 onClick={() => setIsSettingsOpen(true)}
               />
             </div>
          </div>

          <div className="flex-1 flex overflow-hidden">

            {/* Drawer */}
            <Drawer
              isOpen={isDrawerOpen}
              currentConversationId={currentConversationId}
              onSelectConversation={(id) => {
                setCurrentConversationId(id);
                chatRef.current?.loadConversation(id);
              }}
              onDeleteConversation={async (id) => {
                await chatRef.current?.deleteConversation(id);
              }}
            />

            {/* Main Content Area */}
            <div className="flex-1 flex overflow-hidden w-full">
             
             {/* Left Pane: AI Chat (now on left) */}
             <div 
                className={clsx(
                    "bg-background shadow-2xl flex flex-col h-full relative min-w-0",
                    !showChat && "hidden"
                )}
                style={{ 
                    flexGrow: showTerminal ? chatRatio : 1, 
                    flexShrink: 0,
                    flexBasis: showTerminal ? '0%' : '100%'
                }}
             >
                 <ErrorBoundary>
                     <Chat ref={chatRef} />
                 </ErrorBoundary>
             </div>

             {/* Resizer */}
             {showTerminal && showChat && (
                 <div 
                    className={clsx(
                        "w-px h-full z-20 shrink-0 relative transition-colors",
                        isResizing ? "bg-primary" : "bg-border",
                        "hover:bg-primary"
                    )}
                 >
                    <div 
                        onMouseDown={startResizing}
                        className="absolute inset-y-0 -left-1 w-3 cursor-col-resize z-30"
                    />
                 </div>
             )}
             
             {/* Right Pane: Terminal/SSH (now on right) */}
             <div 
                className={clsx(
                    "flex-1 overflow-hidden relative min-w-0",
                    !showTerminal && "hidden"
                )}
                style={{ 
                    flexGrow: showChat ? (1 - chatRatio) : 1,
                    flexShrink: 0,
                    flexBasis: showChat ? '0%' : '100%' 
                }}
             >
                {/* Screens are always mounted to preserve state */}
                <div className={clsx("h-full w-full", activeTab !== 'terminal' && "hidden")}>
                    <TerminalView onActivePathChange={setActiveTerminalPath} />
                </div>
                {activeTab === 'ssh' && <SSHView />}
             </div>
          </div>
          </div>
          
          {/* Overlay for resizing safety */}
          {isResizing && (
              <div className="absolute inset-0 z-50 cursor-col-resize" />
          )}

          <SettingsModal 
            isOpen={isSettingsOpen} 
            onClose={() => setIsSettingsOpen(false)} 
          />
        </div>
    </ErrorBoundary>
  );
}
