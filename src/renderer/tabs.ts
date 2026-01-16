import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { ipcRenderer } from 'electron';

interface Tab {
  id: string;
  title: string;
  cwd: string;
  ptyId: number;
  terminal: Terminal;
  fitAddon: FitAddon;
  element: HTMLElement;
  tabElement: HTMLElement;
}

export class TabManager {
  private tabs: Map<string, Tab> = new Map();
  private activeTabId: string | null = null;
  private tabsContainer: HTMLElement;
  private terminalsContainer: HTMLElement;
  private tabCounter = 0;
  private contextMenu: HTMLElement | null = null;

  constructor() {
    this.tabsContainer = document.getElementById('tabs')!;
    this.terminalsContainer = document.getElementById('terminals')!;
    
    // Listen for new-tab and close-tab from main process
    ipcRenderer.on('new-tab', () => this.createTab());
    ipcRenderer.on('close-tab', () => this.closeActiveTab());
    
    // New tab button
    document.getElementById('new-tab-btn')!.addEventListener('click', () => {
      this.createTab();
    });

    // Close context menu on click outside
    document.addEventListener('click', () => this.hideContextMenu());

    // Keyboard shortcuts for tab switching
    document.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey) {
        // Cmd+1-9 to switch tabs
        if (e.key >= '1' && e.key <= '9') {
          e.preventDefault();
          const index = parseInt(e.key) - 1;
          this.activateTabByIndex(index);
        }
        // Cmd+Left/Right to switch adjacent tabs
        else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          this.activatePreviousTab();
        }
        else if (e.key === 'ArrowRight') {
          e.preventDefault();
          this.activateNextTab();
        }
      }
    });
  }

  private formatTitle(cwd: string): string {
    const maxChars = 22;
    if (cwd.length <= maxChars) {
      return cwd;
    }
    // Show ... + last maxChars characters
    return '…' + cwd.slice(-maxChars);
  }

  private updateTabTitle(tab: Tab, cwd: string): void {
    tab.cwd = cwd;
    tab.title = this.formatTitle(cwd);
    const titleEl = tab.tabElement.querySelector('.tab-title') as HTMLElement;
    if (titleEl) {
      titleEl.title = cwd; // Full path on hover
    }
    // Update all tab numbers to ensure [id] prefix is correct
    this.updateTabNumbers();
  }

  async createTab(): Promise<void> {
    const id = `tab-${++this.tabCounter}`;
    const homedir = require('os').homedir();
    const title = this.formatTitle(homedir);

    // Create terminal pane
    const pane = document.createElement('div');
    pane.className = 'terminal-pane';
    pane.id = `pane-${id}`;
    this.terminalsContainer.appendChild(pane);

    // Create terminal
    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize: 14,
      fontFamily: '"SF Mono", "Fira Code", "Cascadia Code", Menlo, Monaco, "Courier New", monospace',
      lineHeight: 1.2,
      theme: {
        background: '#1e1e2e',
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
    terminal.loadAddon(fitAddon);
    terminal.open(pane);

    // Create PTY
    const { cols, rows } = terminal;
    const ptyId = await ipcRenderer.invoke('pty:create', { cols, rows });

    // Subscribe to PTY events
    ipcRenderer.send('pty:subscribe', ptyId);

    // Create tab element
    const tabElement = document.createElement('div');
    tabElement.className = 'tab';
    tabElement.innerHTML = `
      <span class="tab-title" title="${homedir}">${title}</span>
    `;
    
    tabElement.addEventListener('click', () => {
      this.activateTab(id);
    });

    // Right-click context menu
    tabElement.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.showContextMenu(e, id);
    });
    
    this.tabsContainer.appendChild(tabElement);

    // Store tab
    const tab: Tab = {
      id,
      title,
      cwd: homedir,
      ptyId,
      terminal,
      fitAddon,
      element: pane,
      tabElement,
    };
    this.tabs.set(id, tab);

    // Handle terminal data
    terminal.onData((data) => {
      ipcRenderer.send('pty:write', ptyId, data);
    });

    // Activate tab
    this.activateTab(id);
    
    // Fit after activation
    setTimeout(() => {
      fitAddon.fit();
      ipcRenderer.send('pty:resize', ptyId, terminal.cols, terminal.rows);
      terminal.focus();
    }, 50);

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      if (this.activeTabId === id) {
        fitAddon.fit();
        ipcRenderer.send('pty:resize', ptyId, terminal.cols, terminal.rows);
      }
    });
    resizeObserver.observe(pane);

    // Update tab numbers to show [id] prefix
    this.updateTabNumbers();
  }

  private showContextMenu(e: MouseEvent, tabId: string): void {
    this.hideContextMenu();

    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.innerHTML = `
      <div class="context-menu-item" data-action="close">Close</div>
      <div class="context-menu-item" data-action="close-others">Close Others</div>
      <div class="context-menu-item" data-action="close-left">Close to the Left</div>
      <div class="context-menu-item" data-action="close-right">Close to the Right</div>
    `;

    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;

    menu.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      const action = target.dataset.action;
      if (!action) return;

      switch (action) {
        case 'close':
          this.closeTab(tabId);
          break;
        case 'close-others':
          this.closeOtherTabs(tabId);
          break;
        case 'close-left':
          this.closeTabsToLeft(tabId);
          break;
        case 'close-right':
          this.closeTabsToRight(tabId);
          break;
      }
      this.hideContextMenu();
    });

    document.body.appendChild(menu);
    this.contextMenu = menu;
  }

  private hideContextMenu(): void {
    if (this.contextMenu) {
      this.contextMenu.remove();
      this.contextMenu = null;
    }
  }

  private getTabOrder(): string[] {
    return Array.from(this.tabsContainer.children)
      .map(el => {
        const id = Array.from(this.tabs.entries())
          .find(([_, tab]) => tab.tabElement === el)?.[0];
        return id;
      })
      .filter((id): id is string => id !== undefined);
  }

  private activateTabByIndex(index: number): void {
    const order = this.getTabOrder();
    if (index >= 0 && index < order.length) {
      this.activateTab(order[index]);
    }
  }

  private activatePreviousTab(): void {
    if (!this.activeTabId) return;
    const order = this.getTabOrder();
    const currentIndex = order.indexOf(this.activeTabId);
    if (currentIndex > 0) {
      this.activateTab(order[currentIndex - 1]);
    }
  }

  private activateNextTab(): void {
    if (!this.activeTabId) return;
    const order = this.getTabOrder();
    const currentIndex = order.indexOf(this.activeTabId);
    if (currentIndex < order.length - 1) {
      this.activateTab(order[currentIndex + 1]);
    }
  }

  private updateTabNumbers(): void {
    const tabElements = Array.from(this.tabsContainer.children);
    tabElements.forEach((el, index) => {
      const titleEl = el.querySelector('.tab-title');
      if (titleEl) {
        // Find the matching tab
        const tab = Array.from(this.tabs.values()).find(t => t.tabElement === el);
        if (tab) {
          const prefix = index < 9 ? `[${index + 1}] ` : '';
          titleEl.textContent = prefix + this.formatTitle(tab.cwd);
        }
      }
    });
  }

  private closeOtherTabs(keepId: string): void {
    const order = this.getTabOrder();
    for (const id of order) {
      if (id !== keepId) {
        this.closeTab(id);
      }
    }
  }

  private closeTabsToLeft(targetId: string): void {
    const order = this.getTabOrder();
    const targetIndex = order.indexOf(targetId);
    for (let i = 0; i < targetIndex; i++) {
      this.closeTab(order[i]);
    }
  }

  private closeTabsToRight(targetId: string): void {
    const order = this.getTabOrder();
    const targetIndex = order.indexOf(targetId);
    for (let i = order.length - 1; i > targetIndex; i--) {
      this.closeTab(order[i]);
    }
  }

  activateTab(id: string): void {
    const tab = this.tabs.get(id);
    if (!tab) return;

    // Deactivate previous tab
    if (this.activeTabId) {
      const prevTab = this.tabs.get(this.activeTabId);
      if (prevTab) {
        prevTab.element.classList.remove('active');
        prevTab.tabElement.classList.remove('active');
      }
    }

    // Activate new tab
    tab.element.classList.add('active');
    tab.tabElement.classList.add('active');
    this.activeTabId = id;

    // Focus and fit
    setTimeout(() => {
      tab.fitAddon.fit();
      tab.terminal.focus();
    }, 10);
  }

  closeTab(id: string, force: boolean = false): void {
    const tab = this.tabs.get(id);
    if (!tab) return;

    // If this is the last tab, show confirmation (unless force=true)
    if (this.tabs.size === 1 && !force) {
      const confirmed = confirm('Close the last tab and quit the application?');
      if (!confirmed) return;
    }

    // Kill PTY
    ipcRenderer.send('pty:kill', tab.ptyId);

    // Remove elements
    tab.element.remove();
    tab.tabElement.remove();
    tab.terminal.dispose();

    // Remove from map
    this.tabs.delete(id);

    // Activate another tab if this was active
    if (this.activeTabId === id) {
      this.activeTabId = null;
      const remaining = Array.from(this.tabs.keys());
      if (remaining.length > 0) {
        this.activateTab(remaining[remaining.length - 1]);
      }
    }

    // Update tab numbers
    this.updateTabNumbers();

    // Close window if no tabs left
    if (this.tabs.size === 0) {
      window.close();
    }
  }

  closeActiveTab(): void {
    if (this.activeTabId) {
      this.closeTab(this.activeTabId);
    }
  }

  /**
   * Send command to the active terminal
   * @param command The command to send
   * @param execute If true, append newline to execute; if false, just paste
   */
  sendToActiveTerminal(command: string, execute: boolean): void {
    if (!this.activeTabId) return;

    const tab = this.tabs.get(this.activeTabId);
    if (!tab) return;

    // Send command to PTY
    const data = execute ? command + '\n' : command;
    ipcRenderer.send('pty:write', tab.ptyId, data);

    // Focus terminal if not executing (paste mode)
    if (!execute) {
      tab.terminal.focus();
    }
  }

  setupPtyDataHandler(): void {
    ipcRenderer.on('pty:data', (_event, ptyId: number, data: string) => {
      for (const tab of this.tabs.values()) {
        if (tab.ptyId === ptyId) {
          tab.terminal.write(data);
          
          // Try to detect cwd changes from OSC sequences or prompt
          this.detectCwdChange(tab, data);
          break;
        }
      }
    });

    ipcRenderer.on('pty:exit', (_event, ptyId: number, _exitCode: number) => {
      // Find and close the tab when process exits
      for (const [id, tab] of this.tabs.entries()) {
        if (tab.ptyId === ptyId) {
          this.closeTab(id);
          break;
        }
      }
    });
  }

  private detectCwdChange(tab: Tab, data: string): void {
    // Detect OSC 7 (current directory) or OSC 1337 (iTerm2 style)
    // Format: \x1b]7;file://hostname/path\x07 or \x1b]1337;CurrentDir=/path\x07
    const osc7Match = data.match(/\x1b\]7;file:\/\/[^\/]*([^\x07]+)\x07/);
    if (osc7Match) {
      const cwd = decodeURIComponent(osc7Match[1]);
      this.updateTabTitle(tab, cwd);
      return;
    }

    const iterm2Match = data.match(/\x1b\]1337;CurrentDir=([^\x07]+)\x07/);
    if (iterm2Match) {
      const cwd = iterm2Match[1];
      this.updateTabTitle(tab, cwd);
    }
  }
}
