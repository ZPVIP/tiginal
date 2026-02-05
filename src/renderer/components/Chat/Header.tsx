import React from 'react';
import {
  EyeOff,
  MessageSquarePlus,
  History
} from 'lucide-react';
import { clsx } from 'clsx';
import { TigiCat } from '../icons/TigiCat';

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
    <div className="border-b border-border bg-background/50 backdrop-blur-sm flex items-center justify-between px-4 sticky top-0 z-30 shrink-0" style={{ height: '40px' }}>
      <div className="flex items-center gap-2">
        {/* Tigi Branding */}
        <TigiCat size={28} />
        <div className="font-semibold text-text-main">Tigi</div>
      </div>

      <div className="flex items-center gap-1">
        {/* Incognito Mode */}
        <button 
          onClick={onIncognitoToggle}
          title="Incognito Mode"
          className={clsx(
              "p-2 rounded-lg transition-colors",
              isIncognito 
                  ? "bg-purple-500/20 text-purple-400" 
                  : "text-text-muted hover:text-text-main hover:bg-surface"
          )}
        >
            <EyeOff size={18} />
        </button>
        
        {/* New Chat */}
        <button 
          onClick={onNewChat}
          title="New Chat"
          className="p-2 text-text-muted hover:text-text-main hover:bg-surface rounded-lg transition-colors"
        >
            <MessageSquarePlus size={18} />
        </button>
        
        {/* History */}
        <button 
          onClick={onHistory}
          title="Chat History"
          className="p-2 text-text-muted hover:text-text-main hover:bg-surface rounded-lg transition-colors"
        >
            <History size={18} />
        </button>
      </div>
    </div>
  );
}
