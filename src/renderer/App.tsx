import React, { useState, useRef, useEffect, useCallback } from 'react';
import { TerminalSquare, Server, Settings as SettingsIcon, MessageSquare, PanelLeft, PanelLeftClose, SquarePen, EyeOff, SquareSplitHorizontal } from 'lucide-react';
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
  const [chatRatio, setChatRatio] = useState(0.5); // Default 50% for IDE mode

  // Resizing State
  const [isResizing, setIsResizing] = useState(false);

  // Terminal State (path now managed by TerminalView for context menu)
  const [activeTerminalPath, setActiveTerminalPath] = useState('');

  // Drawer State
  const [isDrawerOpen, setIsDrawerOpen] = useState(true);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [isIncognito, setIsIncognito] = useState(false);
  const chatRef = useRef<ChatHandle>(null);
  const contentAreaRef = useRef<HTMLDivElement>(null);

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


  // Clamp chatRatio when drawer opens/closes or layout changes to ensure chat min-width
  useEffect(() => {
    if (!showChat || !showTerminal) return;
    // Use a rAF to read the actual content area width after layout settles
    const rafId = requestAnimationFrame(() => {
      const contentArea = contentAreaRef.current;
      if (!contentArea) return;
      const availableWidth = contentArea.clientWidth;
      if (availableWidth <= 0) return;

      const minChatWidth = 448;
      const minChatRatio = minChatWidth / availableWidth;
      if (chatRatio < minChatRatio) {
        setChatRatio(minChatRatio);
      }
    });
    return () => cancelAnimationFrame(rafId);
  }, [isDrawerOpen, showChat, showTerminal]);

  const NavItem = ({ id, icon: Icon, title, onClick, isActive }: { id: string, icon: any, title: string, onClick?: () => void, isActive?: boolean }) => (
    <button
      onClick={onClick}
      title={title}
      className={clsx(
        "p-1.5 rounded-md transition-colors",
        isActive
          ? "text-primary hover:bg-[var(--tab-hover)]"
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
      const contentArea = contentAreaRef.current;
      if (!contentArea) return;

      // Use the content area's actual bounding rect to account for the drawer offset
      const rect = contentArea.getBoundingClientRect();
      const availableWidth = rect.width;
      const mouseX = e.clientX - rect.left;

      let newChatRatio = mouseX / availableWidth;

      // Constraint: Min 448px for AI Chat (w-md)
      const minChatWidth = 448;
      const minChatRatio = minChatWidth / availableWidth;

      // Terminal can shrink to give space to chat, but keep a small minimum
      const minTerminalWidth = 120;
      const maxChatRatio = Math.min(0.9, (availableWidth - minTerminalWidth) / availableWidth);

      newChatRatio = Math.max(minChatRatio, Math.min(maxChatRatio, newChatRatio));

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

  // View Switching Logic
  const switchToChat = () => {
    setShowChat(true);
    setShowTerminal(false);
  };

  const switchToTerminal = (tab?: 'terminal' | 'ssh') => {
    setShowChat(false);
    setShowTerminal(true);
    if (tab) setActiveTab(tab);
  };

  const switchToIDE = () => {
    setShowChat(true);
    setShowTerminal(true);
  };

  const handleNavClick = (id: 'terminal' | 'ssh') => {
    switchToTerminal(id);
  };

  // Global keyboard shortcuts for Chat
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (!mod) return;

      if (e.key === 'n') {
        e.preventDefault();
        if (showChat) chatRef.current?.newChat();
      }

      if (e.key === 'i') {
        e.preventDefault();
        if (showChat) chatRef.current?.toggleIncognito();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showChat]);

  return (
    <ErrorBoundary>
      <div className="flex flex-col h-screen w-screen bg-background overflow-hidden relative">
        {/* Custom Title Bar with Nav Buttons */}
        <div
          className="h-8 bg-surface/50 border-b border-border w-full flex items-center shrink-0"
          style={{ WebkitAppRegion: 'drag' } as any}
        >
          {/* Left Section: Aligned with Drawer Width (256px) - Static */}
          <div 
             className="h-full w-64 flex items-center shrink-0 border-r border-border"
          >
              {/* Traffic Lights Spacer */}
              <div className={clsx("shrink-0", isMac ? "w-[76px]" : "w-4")} />

              {/* Spacer to push left buttons to the right */}
              <div className="flex-1" />

              {/* Left Action Buttons Group */}
              <div
                className="flex items-center gap-1 pr-2"
                style={{ WebkitAppRegion: 'no-drag' } as any}
              >
                {/* Drawer Toggle Button */}
                <button
                  onClick={() => setIsDrawerOpen(!isDrawerOpen)}
                  disabled={!showChat}
                  className={clsx(
                    "p-1.5 rounded-md transition-colors",
                    !showChat
                      ? "text-text-muted opacity-50 cursor-not-allowed"
                      : isDrawerOpen
                        ? "text-primary hover:bg-[var(--tab-hover)]"
                        : "text-text-sec hover:text-text-main hover:bg-[var(--tab-hover)]"
                  )}
                  title={!showChat ? 'Chat is hidden' : (isDrawerOpen ? 'Close drawer' : 'Open drawer')}
                >
                  {isDrawerOpen ? <PanelLeftClose size={16} strokeWidth={2} /> : <PanelLeft size={16} strokeWidth={2} />}
                </button>

                {/* New Chat Button */}
                <button
                  onClick={() => chatRef.current?.newChat()}
                  disabled={!showChat}
                  className={clsx(
                    "p-1.5 rounded-md transition-colors",
                    !showChat
                      ? "text-text-muted opacity-50 cursor-not-allowed"
                      : "text-text-sec hover:text-text-main hover:bg-[var(--tab-hover)]"
                  )}
                  title={`New Chat (${isMac ? '⌘ + N' : 'Ctrl + N'})`}
                >
                  <SquarePen size={16} strokeWidth={2} />
                </button>

                {/* Incognito Mode Button */}
                <button
                  onClick={() => chatRef.current?.toggleIncognito()}
                  disabled={!showChat}
                  className={clsx(
                    "p-1.5 rounded-md transition-colors",
                    !showChat
                      ? "text-text-muted opacity-50 cursor-not-allowed"
                      : isIncognito
                        ? "bg-purple-500/20 text-purple-400"
                        : "text-text-sec hover:text-text-main hover:bg-[var(--tab-hover)]"
                  )}
                  title={`Incognito Mode (${isMac ? '⌘ + I' : 'Ctrl + I'})`}
                >
                  <EyeOff size={16} strokeWidth={2} />
                </button>
              </div>
          </div>

          {/* Right Section: Navigation Icons */}
          <div
            className="flex items-center gap-2 h-full pl-2"
            style={{ WebkitAppRegion: 'no-drag' } as any}
          >
            <NavItem
              id="chat"
              icon={MessageSquare}
              title="AI Chat"
              isActive={showChat && !showTerminal}
              onClick={switchToChat}
            />
            <NavItem
              id="terminal"
              icon={TerminalSquare}
              title="Terminal"
              isActive={!showChat && showTerminal && activeTab === 'terminal'}
              onClick={() => switchToTerminal('terminal')}
            />
            <NavItem
              id="ide"
              icon={SquareSplitHorizontal}
              title="IDE Mode"
              isActive={showChat && showTerminal}
              onClick={switchToIDE}
            />
            <NavItem
              id="ssh"
              icon={Server}
              title="SSH Servers"
              isActive={!showChat && showTerminal && activeTab === 'ssh'}
              onClick={() => switchToTerminal('ssh')}
            />
            <NavItem
              id="settings"
              icon={SettingsIcon}
              title="Settings"
              isActive={isSettingsOpen}
              onClick={() => setIsSettingsOpen(true)}
            />
          </div>

          {/* Empty flex-1 spacer to keep buttons on the left */}
          <div className="flex-1" />

          {/* Right spacer for Windows/Linux window controls */}
          {!isMac && <div className="w-[140px] shrink-0" />}
        </div>

        <div className="flex-1 flex overflow-hidden">

          {/* Drawer - only show when Chat is visible */}
          {showChat && (
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
          )}

          {/* Main Content Area */}
          <div ref={contentAreaRef} className="flex-1 flex overflow-hidden w-full">

            {/* Left Pane: AI Chat (now on left) */}
            <div
              className={clsx(
                "bg-background shadow-2xl flex flex-col h-full relative",
                !showChat && "hidden"
              )}
              style={{
                flexGrow: showTerminal ? chatRatio : 1,
                flexShrink: 0,
                flexBasis: showTerminal ? '0%' : '100%',
                minWidth: showTerminal ? 448 : undefined,
              }}
            >
              <ErrorBoundary>
                <Chat ref={chatRef} onIncognitoChange={setIsIncognito} onConversationChange={setCurrentConversationId} />
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
                "overflow-hidden relative min-w-0",
                !showTerminal && "hidden"
              )}
              style={{
                flexGrow: showChat ? (1 - chatRatio) : 1,
                flexShrink: 1,
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
