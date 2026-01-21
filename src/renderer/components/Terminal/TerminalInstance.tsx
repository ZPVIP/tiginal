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
  const { currentTheme } = useTheme(); // Use Theme Context

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
    },
    setFontSize: (size: number) => {
        if (xtermRef.current) {
            xtermRef.current.options.fontSize = size;
            fitAddonRef.current?.fit();
            if (ptyIdRef.current !== null) {
                send('pty:resize', ptyIdRef.current, xtermRef.current.cols, xtermRef.current.rows);
            }
        }
    },
    getFontSize: () => xtermRef.current?.options.fontSize || 14
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
          fitAddonRef.current?.fit();
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
          fitAddon.fit();
          send('pty:resize', myPtyId, term.cols, term.rows);
        }, 100);
      } catch (e) {
        console.error("Failed to setup PTY", e);
        term.write('\r\n\x1b[31mFailed to start shell.\x1b[0m\r\n');
      }

      // Resize observer
      ro = new ResizeObserver(() => {
        if (isActive && fitAddon && term) {
          fitAddon.fit();
          if (ptyIdRef.current !== null) {
            send('pty:resize', ptyIdRef.current, term.cols, term.rows);
          }
        }
      });
      ro.observe(container);
    };

    init();

    return () => {
      disposed = true;
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
