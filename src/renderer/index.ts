import { TabManager } from './tabs';
import { Sidebar, ViewType } from './sidebar';
import { AIPanel } from './ai-panel';
import { CommandInput } from './command-input';
import { SettingsPage } from './settings/settings-page';

let tabManager: TabManager;
let sidebar: Sidebar;
let aiPanel: AIPanel;
let commandInput: CommandInput;
let settingsPage: SettingsPage;

async function init(): Promise<void> {
  // Initialize components
  sidebar = new Sidebar();
  aiPanel = new AIPanel();
  commandInput = new CommandInput();
  tabManager = new TabManager();
  settingsPage = new SettingsPage();

  // Setup view switching
  sidebar.onViewChangeListener((view: ViewType) => {
    handleViewChange(view);
  });

  // Connect command input to terminal
  commandInput.onSendCommand((command: string, execute: boolean) => {
    tabManager.sendToActiveTerminal(command, execute);
  });

  // Setup PTY data handlers
  tabManager.setupPtyDataHandler();

  // Create first tab
  await tabManager.createTab();

  // Setup tab scroll buttons
  const tabsContainer = document.getElementById('tabs');
  const scrollAmount = 100;

  document.getElementById('scroll-tabs-left')?.addEventListener('click', () => {
    if (tabsContainer) {
      tabsContainer.scrollLeft -= scrollAmount;
    }
  });

  document.getElementById('scroll-tabs-right')?.addEventListener('click', () => {
    if (tabsContainer) {
      tabsContainer.scrollLeft += scrollAmount;
    }
  });
}

function handleViewChange(view: ViewType): void {
  const terminalContainer = document.getElementById('terminal-container');
  const tabBar = document.getElementById('tab-bar');
  const commandInputContainer = document.getElementById('command-input-container');

  // Get or create settings container
  let settingsContainer = document.getElementById('settings-container');
  if (!settingsContainer) {
    settingsContainer = document.createElement('div');
    settingsContainer.id = 'settings-container';
    settingsContainer.className = 'view-container';
    document.getElementById('main-content')?.appendChild(settingsContainer);
  }

  // Get or create servers container
  let serversContainer = document.getElementById('servers-container');
  if (!serversContainer) {
    serversContainer = document.createElement('div');
    serversContainer.id = 'servers-container';
    serversContainer.className = 'view-container';
    document.getElementById('main-content')?.appendChild(serversContainer);
  }

  // Hide all views
  terminalContainer?.style.setProperty('display', 'none');
  tabBar?.style.setProperty('display', 'none');
  commandInputContainer?.style.setProperty('display', 'none');
  settingsContainer.style.display = 'none';
  serversContainer.style.display = 'none';

  // Show selected view
  switch (view) {
    case 'terminal':
      terminalContainer?.style.setProperty('display', 'flex');
      tabBar?.style.setProperty('display', 'flex');
      commandInputContainer?.style.setProperty('display', 'flex');
      break;
    case 'settings':
      settingsContainer.style.display = 'block';
      settingsPage.render(settingsContainer);
      break;
    case 'servers':
      serversContainer.style.display = 'block';
      // TODO: Render servers page
      serversContainer.innerHTML = '<div class="settings-page"><div class="settings-main"><h2 class="settings-title">SSH Servers</h2><p class="coming-soon">Coming in Phase 4</p></div></div>';
      break;
  }
}

document.addEventListener('DOMContentLoaded', init);
