import { ipcRenderer } from 'electron';

export type ViewType = 'terminal' | 'servers' | 'settings';

export class Sidebar {
  private activeView: ViewType = 'terminal';
  private onViewChange: ((view: ViewType) => void) | null = null;

  constructor() {
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    const terminalBtn = document.getElementById('sidebar-terminal');
    const serversBtn = document.getElementById('sidebar-servers');
    const settingsBtn = document.getElementById('sidebar-settings');

    terminalBtn?.addEventListener('click', () => this.setActiveView('terminal'));
    serversBtn?.addEventListener('click', () => this.setActiveView('servers'));
    settingsBtn?.addEventListener('click', () => this.setActiveView('settings'));
  }

  setActiveView(view: ViewType): void {
    if (this.activeView === view) return;

    // Update button states
    document.querySelectorAll('.sidebar-icon').forEach(btn => {
      btn.classList.remove('active');
    });

    const activeBtn = document.getElementById(`sidebar-${view}`);
    activeBtn?.classList.add('active');

    this.activeView = view;

    // Notify listeners
    if (this.onViewChange) {
      this.onViewChange(view);
    }
  }

  getActiveView(): ViewType {
    return this.activeView;
  }

  onViewChangeListener(callback: (view: ViewType) => void): void {
    this.onViewChange = callback;
  }
}
