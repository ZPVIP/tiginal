import { SettingsAI } from './settings-ai';

type SettingsSection = 'ai' | 'servers' | 'shortcuts' | 'themes';

export class SettingsPage {
  private container: HTMLElement | null = null;
  private activeSection: SettingsSection = 'ai';
  private settingsAI: SettingsAI;

  constructor() {
    this.settingsAI = new SettingsAI();
  }

  render(container: HTMLElement): void {
    this.container = container;
    
    container.innerHTML = `
      <div class="settings-page">
        <div class="settings-sidebar">
          <div class="settings-nav">
            <button class="settings-nav-item active" data-section="ai">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z"></path>
              </svg>
              AI Providers
            </button>
            <button class="settings-nav-item" data-section="servers">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                <line x1="8" y1="21" x2="16" y2="21"></line>
                <line x1="12" y1="17" x2="12" y2="21"></line>
              </svg>
              SSH Servers
            </button>
            <button class="settings-nav-item" data-section="shortcuts">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="2" y="4" width="20" height="16" rx="2" ry="2"></rect>
                <line x1="6" y1="8" x2="6.01" y2="8"></line>
                <line x1="10" y1="8" x2="10.01" y2="8"></line>
                <line x1="14" y1="8" x2="14.01" y2="8"></line>
              </svg>
              Keyboard Shortcuts
            </button>
            <button class="settings-nav-item" data-section="themes">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="5"></circle>
                <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"></path>
              </svg>
              Themes
            </button>
          </div>
        </div>
        <div class="settings-main" id="settings-content">
          <!-- Content loaded dynamically -->
        </div>
      </div>
    `;

    this.setupNavigation();
    this.loadSection('ai');
  }

  private setupNavigation(): void {
    document.querySelectorAll('.settings-nav-item').forEach(item => {
      item.addEventListener('click', () => {
        const section = item.getAttribute('data-section') as SettingsSection;
        if (section) {
          this.loadSection(section);
        }
      });
    });
  }

  private loadSection(section: SettingsSection): void {
    this.activeSection = section;

    // Update nav active state
    document.querySelectorAll('.settings-nav-item').forEach(item => {
      item.classList.toggle('active', item.getAttribute('data-section') === section);
    });

    // Load content
    const content = document.getElementById('settings-content');
    if (!content) return;

    switch (section) {
      case 'ai':
        this.settingsAI.render(content);
        break;
      case 'servers':
        content.innerHTML = '<div class="settings-section"><h2>SSH Servers</h2><p class="coming-soon">Coming in Phase 4</p></div>';
        break;
      case 'shortcuts':
        content.innerHTML = '<div class="settings-section"><h2>Keyboard Shortcuts</h2><p class="coming-soon">Coming soon</p></div>';
        break;
      case 'themes':
        content.innerHTML = '<div class="settings-section"><h2>Themes</h2><p class="coming-soon">Coming soon</p></div>';
        break;
    }
  }
}
