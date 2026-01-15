import { TabManager } from './tabs';

async function init(): Promise<void> {
  const tabManager = new TabManager();
  
  // Setup PTY data handlers
  tabManager.setupPtyDataHandler();
  
  // Create first tab
  await tabManager.createTab();
}

document.addEventListener('DOMContentLoaded', init);
