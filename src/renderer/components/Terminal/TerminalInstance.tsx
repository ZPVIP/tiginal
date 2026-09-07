import React, { useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { clsx } from 'clsx';
import { useTheme } from '../../context/ThemeContext';

// Interface for IPC calls will be picked up from types/electron.d.ts
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
  clear: () => void;
  write: (data: string) => void;
  send: (data: string) => void; // Write to PTY
  setFontSize: (size: number) => void;
  getFontSize: () => number;
}

export const TerminalInstance = forwardRef<TerminalRef, TerminalInstanceProps>(({ id, isActive, onTitleChange, onExit }, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const ptyIdRef = useRef<number | null>(null);
  const lastPtySizeRef = useRef<{ cols: number; rows: number } | null>(null);
  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;
  const { currentTheme } = useTheme(); // Use Theme Context

  const fitTerminal = () => {
    const term = xtermRef.current;
    const fitAddon = fitAddonRef.current;
    if (!term || !fitAddon) return;

    const wasAtBottom = term.buffer.active.viewportY === term.buffer.active.baseY;
    fitAddon.fit();
    if (wasAtBottom) term.scrollToBottom();

    const ptyId = ptyIdRef.current;
    const previous = lastPtySizeRef.current;
    if (ptyId !== null && (previous?.cols !== term.cols || previous.rows !== term.rows)) {
      lastPtySizeRef.current = { cols: term.cols, rows: term.rows };
      send('pty:resize', ptyId, term.cols, term.rows);
    }
  };

  // Expose methods
  useImperativeHandle(ref, () => ({
    fit: () => {
      fitTerminal();
    },
    focus: () => xtermRef.current?.focus(),
    write: (data: string) => xtermRef.current?.write(data),
    send: (data: string) => {
        if (ptyIdRef.current !== null) {
            send('pty:write', ptyIdRef.current, data);
        }
    },
    setFontSize: (size: number) => {
        if (xtermRef.current) {
            xtermRef.current.options.fontSize = size;
            fitTerminal();
        }
    },
    getFontSize: () => xtermRef.current?.options.fontSize || 14,
    clear: () => {
        // Clear scrollback locally
        xtermRef.current?.write('\x1b[3J');
        // Send Ctrl+L to shell to clear viewport and redraw prompt
        if (ptyIdRef.current !== null) {
            send('pty:write', ptyIdRef.current, '\u000C');
        }
    }
  }));

  // Update theme when it changes
  useEffect(() => {
    if (xtermRef.current) {
       xtermRef.current.options.theme = currentTheme.terminal;
    }
  }, [currentTheme]);

  // Listen for font settings changes
  useEffect(() => {
    const handler = async () => {
      if (!xtermRef.current) return;
      try {
        const settings = await invoke('settings:get', 'terminal');
        if (settings) {
          const parsed = JSON.parse(settings);
          if (parsed.fontFamily) {
            xtermRef.current.options.fontFamily = parsed.fontFamily;
          }
          if (parsed.fontSize) {
            xtermRef.current.options.fontSize = parsed.fontSize;
          }
          fitTerminal();
        }
      } catch (e) {
        console.error('Failed to update terminal font', e);
      }
    };
    window.addEventListener('terminal-settings-changed', handler);
    return () => window.removeEventListener('terminal-settings-changed', handler);
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;

    let term: XTerm;
    let fitAddon: FitAddon;
    let ro: ResizeObserver;
    let myPtyId: number;
    let cleanupData: (() => void) | undefined;
    let cleanupExit: (() => void) | undefined;
    let disposed = false;
    let resizeFrame = 0;

    const init = async () => {
      // Load terminal settings
      let terminalFontFamily = '"SF Mono", "Fira Code", "Cascadia Code", Menlo, Monaco, "Courier New", monospace';
      let terminalFontSize = 14;
      
      try {
        const settings = await invoke('settings:get', 'terminal');
        if (settings) {
          const parsed = JSON.parse(settings);
          if (parsed.fontFamily) terminalFontFamily = parsed.fontFamily;
          if (parsed.fontSize) terminalFontSize = parsed.fontSize;
        }
      } catch (e) {
        console.error('Failed to load terminal settings', e);
      }

      if (disposed) return;

      // Init XTerm
      term = new XTerm({
        cursorBlink: true,
        cursorStyle: 'bar',
        fontSize: terminalFontSize,
        fontFamily: terminalFontFamily,
        lineHeight: 1.2,
        theme: currentTheme.terminal,
        allowProposedApi: true,
      });

      fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(container);
      
      xtermRef.current = term;
      fitAddonRef.current = fitAddon;

      // Let Ctrl+` trigger focus toggle via CustomEvent
      term.attachCustomKeyEventHandler((event) => {
        // Cmd+K to clear
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
             event.preventDefault();
             // Clear scrollback
             term.write('\x1b[3J');
             // Send Ctrl+L to shell
             if (ptyIdRef.current !== null) {
                send('pty:write', ptyIdRef.current, '\u000C');
             }
             return false;
        }

        if (event.ctrlKey && event.key === '`') {
          window.dispatchEvent(new CustomEvent('toggle-command-input-focus'));
          return false;
        }
        return true;
      });

      // Input handler
      term.onData(data => {
        if (ptyIdRef.current !== null) {
          send('pty:write', ptyIdRef.current, data);
        }
      });

      // Setup PTY
      try {
        const { cols, rows } = term;
        myPtyId = await invoke('pty:create', { cols, rows });
        ptyIdRef.current = myPtyId;

        const dataHandler = (ptyId: number, data: string) => {
          if (ptyId === myPtyId) {
            term.write(data);
            const osc7Match = data.match(/\x1b\]7;file:\/\/[^\/]*([^\x07]+)\x07/);
            if (osc7Match) {
              onTitleChange(id, decodeURIComponent(osc7Match[1]));
            }
            const iterm2Match = data.match(/\x1b\]1337;CurrentDir=([^\x07]+)\x07/);
            if (iterm2Match) {
              onTitleChange(id, iterm2Match[1]);
            }
          }
        };

        const exitHandler = (ptyId: number) => {
          if (ptyId === myPtyId) {
            onExit(id);
          }
        };

        cleanupData = window.electron!.on('pty:data', dataHandler);
        cleanupExit = window.electron!.on('pty:exit', exitHandler);
        
        setTimeout(() => {
          fitTerminal();
        }, 100);
      } catch (e) {
        console.error("Failed to setup PTY", e);
        term.write('\r\n\x1b[31mFailed to start shell.\x1b[0m\r\n');
      }

      // Resize observer
      ro = new ResizeObserver(() => {
        if (!isActiveRef.current) return;
        cancelAnimationFrame(resizeFrame);
        resizeFrame = requestAnimationFrame(fitTerminal);
      });
      ro.observe(container);
    };

    init();

    return () => {
      disposed = true;
      cancelAnimationFrame(resizeFrame);
      ro?.disconnect();
      cleanupData?.();
      cleanupExit?.();
      if (myPtyId) send('pty:kill', myPtyId);
      term?.dispose();
    };
  }, []); // Mount ONCE

  // React to active/resize changes
  useEffect(() => {
      if (isActive && fitAddonRef.current && xtermRef.current) {
          // Give a small tick for layout to settle (display: none -> block)
          requestAnimationFrame(() => {
              fitTerminal();
              xtermRef.current?.focus();
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
