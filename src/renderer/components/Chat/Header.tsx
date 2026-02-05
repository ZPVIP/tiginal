import React from 'react';
import {
  EyeOff,
  MessageSquarePlus,
  History
} from 'lucide-react';
import { clsx } from 'clsx';

interface HeaderProps {
  onNewChat: () => void;
  onHistory: () => void;
  onIncognitoToggle: () => void;
  isIncognito: boolean;
}

export function Header({ 
  onNewChat, 
  onHistory, 
  onIncognitoToggle, 
  isIncognito
}: HeaderProps) {
  return (
    <div className="border-b border-border bg-background/50 backdrop-blur-sm flex items-center justify-end px-3 sticky top-0 z-30 shrink-0" style={{ height: '30px' }}>
      <div className="flex items-center gap-0.5">
        {/* Incognito Mode */}
        <button 
          onClick={onIncognitoToggle}
          title="Incognito Mode"
          className={clsx(
              "p-1.5 rounded-md transition-colors",
              isIncognito 
                  ? "bg-purple-500/20 text-purple-400" 
                  : "text-text-muted hover:text-text-main hover:bg-surface"
          )}
        >
            <EyeOff size={14} />
        </button>
        
        {/* New Chat */}
        <button 
          onClick={onNewChat}
          title="New Chat"
          className="p-1.5 text-text-muted hover:text-text-main hover:bg-surface rounded-md transition-colors"
        >
            <MessageSquarePlus size={14} />
        </button>
        
        {/* History */}
        <button 
          onClick={onHistory}
          title="Chat History"
          className="p-1.5 text-text-muted hover:text-text-main hover:bg-surface rounded-md transition-colors"
        >
            <History size={14} />
        </button>
      </div>
    </div>
  );
}
