import React, { useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { clsx } from 'clsx';

// Interface for IPC calls
declare global {
  interface Window {
    electron?: {
      invoke(channel: string, ...args: any[]): Promise<any>;
      send(channel: string, ...args: any[]): void;
      on(channel: string, func: (...args: any[]) => void): () => void; // Returns cleanup
    };
  }
}
const invoke = window.electron?.invoke || (async () => {});
const send = window.electron?.send || (() => {});

interface TerminalInstanceProps {
  id: string;
  isActive: boolean;
  onTitleChange: (id: string, title: string) => void;
  onExit: (id: string) => void;
}

export interface TerminalRef {
  fit: () => void;
  focus: () => void;
  write: (data: string) => void;
  send: (data: string) => void; // Write to PTY
}

export const TerminalInstance = forwardRef<TerminalRef, TerminalInstanceProps>(({ id, isActive, onTitleChange, onExit }, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const ptyIdRef = useRef<number | null>(null);

  // Expose methods
  useImperativeHandle(ref, () => ({
    fit: () => {
      if (fitAddonRef.current && xtermRef.current) {
        // Ensure container has dimensions
        fitAddonRef.current.fit();
        if (ptyIdRef.current !== null) {
           send('pty:resize', ptyIdRef.current, xtermRef.current.cols, xtermRef.current.rows);
        }
      }
    },
    focus: () => xtermRef.current?.focus(),
    write: (data: string) => xtermRef.current?.write(data),
    send: (data: string) => {
        if (ptyIdRef.current !== null) {
            send('pty:write', ptyIdRef.current, data);
        }
    }
  }));

  useEffect(() => {
    if (!containerRef.current) return;

    // 1. Init XTerm
    const term = new XTerm({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize: 14,
      fontFamily: '"SF Mono", "Fira Code", "Cascadia Code", Menlo, Monaco, "Courier New", monospace',
      lineHeight: 1.2,
      theme: {
        background: '#1a1a1a', // Match app bg
        foreground: '#cdd6f4',
        cursor: '#f5e0dc',
        cursorAccent: '#1e1e2e',
        selectionBackground: '#585b70',
        selectionForeground: '#cdd6f4',
        black: '#45475a',
        red: '#f38ba8',
        green: '#a6e3a1',
        yellow: '#f9e2af',
        blue: '#89b4fa',
        magenta: '#f5c2e7',
        cyan: '#94e2d5',
        white: '#bac2de',
        brightBlack: '#585b70',
        brightRed: '#f38ba8',
        brightGreen: '#a6e3a1',
        brightYellow: '#f9e2af',
        brightBlue: '#89b4fa',
        brightMagenta: '#f5c2e7',
        brightCyan: '#94e2d5',
        brightWhite: '#a6adc8',
      },
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    
    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // Input handler - Local Echo is handled by PTY usually, so just send.
    term.onData(data => {
        if (ptyIdRef.current !== null) {
             send('pty:write', ptyIdRef.current, data);
        }
    });

    // 2. Setup PTY
    let myPtyId: number;
    let cleanupData: () => void;
    let cleanupExit: () => void;

    const setup = async () => {
         try {
             const { cols, rows } = term;
             myPtyId = await invoke('pty:create', { cols, rows });
             ptyIdRef.current = myPtyId;
             // send('pty:subscribe', myPtyId); // Handled in create now for zero-latency

             // Listeners - preload strips _event, so we receive (ptyId, data) directly
             const dataHandler = (ptyId: number, data: string) => {
                 if (ptyId === myPtyId) {
                     term.write(data);
                     // Title Update Logic
                     const osc7Match = data.match(/\x1b\]7;file:\/\/[^\/]*([^\x07]+)\x07/);
                     if (osc7Match) {
                       onTitleChange(id, decodeURIComponent(osc7Match[1])); // Use component ID (prop)
                     }
                     const iterm2Match = data.match(/\x1b\]1337;CurrentDir=([^\x07]+)\x07/);
                     if (iterm2Match) {
                        onTitleChange(id, iterm2Match[1]);
                     }
                 }
             };

             const exitHandler = (ptyId: number) => {
                 if (ptyId === myPtyId) {
                     onExit(id); // Use component ID (prop)
                 }
             };

             cleanupData = window.electron!.on('pty:data', dataHandler);
             cleanupExit = window.electron!.on('pty:exit', exitHandler);
             
             // Initial fit after pty creation and slight delay to ensure container size is ready
             setTimeout(() => {
                 fitAddon.fit();
                 send('pty:resize', myPtyId, term.cols, term.rows);
             }, 100);

         } catch (e) {
             console.error("Failed to setup PTY", e);
             term.write('\r\n\x1b[31mFailed to start shell.\x1b[0m\r\n');
         }
    };

    setup();

    // Initial resize observer for container
    const ro = new ResizeObserver(() => {
        if (isActive && fitAddon && term) {
            fitAddon.fit();
            if (ptyIdRef.current !== null) {
                send('pty:resize', ptyIdRef.current, term.cols, term.rows);
            }
        }
    });
    ro.observe(containerRef.current);

    return () => {
        ro.disconnect();
        if (cleanupData) cleanupData();
        if (cleanupExit) cleanupExit();
        if (myPtyId) send('pty:kill', myPtyId); // Clean up PTY on unmount
        term.dispose();
    };
  }, []); // Mount ONCE

  // React to active/resize changes
  useEffect(() => {
      if (isActive && fitAddonRef.current && xtermRef.current) {
          // Give a small tick for layout to settle (display: none -> block)
          requestAnimationFrame(() => {
              fitAddonRef.current?.fit();
              xtermRef.current?.focus();
              if (ptyIdRef.current !== null && xtermRef.current) {
                 send('pty:resize', ptyIdRef.current, xtermRef.current.cols, xtermRef.current.rows);
              }
          });
      }
  }, [isActive]);

  return (
    <div 
      // Important: Flex-1 and min-h-0 are crucial for xterm to fill remaining space
      className={clsx("h-full w-full overflow-hidden", !isActive && "hidden")}
    >
        <div ref={containerRef} className="h-full w-full" />
    </div>
  );
});

TerminalInstance.displayName = "TerminalInstance";
