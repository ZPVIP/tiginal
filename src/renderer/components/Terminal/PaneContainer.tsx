import React from 'react';
import { TerminalInstance, TerminalRef } from './TerminalInstance';

interface PaneContainerProps {
  id: string;
  isActive: boolean;
  onActivate: (id: string) => void;
  onTitleChange: (id: string, title: string) => void;
  onExit: (id: string) => void;
  terminalRef: (ref: TerminalRef | null) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}

export function PaneContainer({ 
  id, 
  isActive, 
  onActivate, 
  onTitleChange, 
  onExit,
  terminalRef,
  onContextMenu
}: PaneContainerProps) {
  
  return (
    <div 
      className="relative h-full w-full flex flex-col overflow-hidden"
      onContextMenu={onContextMenu}
    >
        <TerminalInstance
            id={id}
            isActive={true} 
            ref={terminalRef}
            onTitleChange={onTitleChange}
            onExit={onExit}
        />
        
        {/* Transparent overlay for inactive panes - guarantees click selection */}
        {!isActive && (
            <div 
                className="absolute inset-0 z-10 bg-transparent cursor-pointer"
                onClick={() => onActivate(id)}
            />
        )}
    </div>
  );
}
