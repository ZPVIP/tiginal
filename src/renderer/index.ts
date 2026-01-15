import { TerminalManager } from './terminal';

async function init(): Promise<void> {
  const container = document.getElementById('terminal');
  if (!container) {
    console.error('Terminal container not found');
    return;
  }

  // Add platform class for CSS styling
  if (navigator.userAgent.includes('Mac')) {
    document.body.classList.add('darwin');
  }

  const terminalManager = new TerminalManager(container);
  await terminalManager.initialize();
}

document.addEventListener('DOMContentLoaded', init);
