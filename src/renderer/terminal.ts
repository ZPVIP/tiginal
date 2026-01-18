import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { ipcRenderer } from 'electron';

export class TerminalManager {
  private terminal: Terminal;
  private fitAddon: FitAddon;
  private container: HTMLElement;
  private ptyId: number | null = null;
  private resizeObserver: ResizeObserver | null = null;

  constructor(container: HTMLElement) {
    this.container = container;

    this.terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize: 14,
      fontFamily: '"SF Mono", "Fira Code", "Cascadia Code", Menlo, Monaco, "Courier New", monospace',
      lineHeight: 1.2,
      letterSpacing: 0,
      theme: {
        background: '#181825',
        foreground: '#cdd6f4',
        cursor: '#f5e0dc',
        cursorAccent: '#181825',
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

    this.fitAddon = new FitAddon();
    this.terminal.loadAddon(this.fitAddon);
  }

  async initialize(): Promise<void> {
    // Open terminal in container
    this.terminal.open(this.container);

    // Fit to container
    this.fit();

    // Create PTY
    const { cols, rows } = this.terminal;
    this.ptyId = await ipcRenderer.invoke('pty:create', { cols, rows });

    // Subscribe to PTY events
    ipcRenderer.send('pty:subscribe', this.ptyId);

    // Handle data from PTY
    ipcRenderer.on('pty:data', (_event, id: number, data: string) => {
      if (id === this.ptyId) {
        this.terminal.write(data);
      }
    });

    // Handle PTY exit
    ipcRenderer.on('pty:exit', (_event, id: number, exitCode: number) => {
      if (id === this.ptyId) {
        this.terminal.writeln(`\r\n[Process exited with code ${exitCode}]`);
      }
    });

    // Handle user input
    this.terminal.onData((data) => {
      if (this.ptyId !== null) {
        ipcRenderer.send('pty:write', this.ptyId, data);
      }
    });

    // Handle resize
    this.setupResizeObserver();

    // Focus terminal
    this.terminal.focus();
  }

  private fit(): void {
    try {
      this.fitAddon.fit();
    } catch {
      // Ignore fit errors during initialization
    }
  }

  private setupResizeObserver(): void {
    this.resizeObserver = new ResizeObserver(() => {
      this.handleResize();
    });
    this.resizeObserver.observe(this.container);
  }

  private handleResize(): void {
    this.fit();

    if (this.ptyId !== null) {
      const { cols, rows } = this.terminal;
      ipcRenderer.send('pty:resize', this.ptyId, cols, rows);
    }
  }

  dispose(): void {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }

    if (this.ptyId !== null) {
      ipcRenderer.send('pty:kill', this.ptyId);
    }

    this.terminal.dispose();
  }

  setTheme(theme: any): void { // Using any for ITheme since we didn't import strict type here to avoid conflict, but it matches xterm
    this.terminal.options.theme = theme;
  }
}
