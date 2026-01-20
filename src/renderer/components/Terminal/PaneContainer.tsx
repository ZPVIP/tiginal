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
  
  // Simple click handler: just activate (select) the pane
  // User will manually click the textarea to focus it
  const handleClick = () => {
      onActivate(id);
  };
  
  return (
    <div 
      className="relative h-full w-full flex flex-col overflow-hidden"
      onClick={handleClick}
      onContextMenu={onContextMenu}
    >
        <TerminalInstance
            id={id}
            isActive={true} 
            ref={terminalRef}
            onTitleChange={onTitleChange}
            onExit={onExit}
        />
    </div>
  );
}
