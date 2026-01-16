import { TabManager } from './tabs';
import { Sidebar, ViewType } from './sidebar';
import { AIPanel } from './ai-panel';
import { CommandInput } from './command-input';

let tabManager: TabManager;
let sidebar: Sidebar;
let aiPanel: AIPanel;
let commandInput: CommandInput;

async function init(): Promise<void> {
  // Initialize components
  sidebar = new Sidebar();
  aiPanel = new AIPanel();
  commandInput = new CommandInput();
  tabManager = new TabManager();

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
}

function handleViewChange(view: ViewType): void {
  const terminalContainer = document.getElementById('terminal-container');
  const tabBar = document.getElementById('tab-bar');
  const commandInputContainer = document.getElementById('command-input-container');

  // TODO: Add settings and servers views
  // For now, just show/hide terminal view
  if (view === 'terminal') {
    terminalContainer?.style.setProperty('display', 'flex');
    tabBar?.style.setProperty('display', 'flex');
    commandInputContainer?.style.setProperty('display', 'flex');
  } else {
    // Hide terminal view - will show settings/servers views when implemented
    terminalContainer?.style.setProperty('display', 'none');
    tabBar?.style.setProperty('display', 'none');
    commandInputContainer?.style.setProperty('display', 'none');
  }
}

document.addEventListener('DOMContentLoaded', init);
