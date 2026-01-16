import { app, BrowserWindow, Menu, MenuItemConstructorOptions } from 'electron';

// Polyfill global File object for undici (used by cheerio/fetch) in Node 18 environments
if (typeof global.File === 'undefined') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { File } = require('node:buffer');
    if (File) {
      (global as any).File = File;
    }
  } catch (e) {
    console.warn('Failed to polyfill global.File', e);
  }
}

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { setupIpcHandlers } from './ipc';
import { setupAIHandlers } from './ai-handlers';
import { setupSSHHandlers } from './ssh-handlers';
import { setupChatHandlers } from './chat-handlers';
import { setupSearchHandlers } from './services/search';
import { getDatabase } from '../services/database/database';
import { getCrypto } from '../services/ssh/CryptoService';

// Set app name for macOS menu bar
app.name = 'Tiginal';

// Override userData path to ~/.config/tiginal/support on macOS/Linux
if (process.platform !== 'win32') {
  const customUserDataPath = path.join(os.homedir(), '.config', 'tiginal', 'support');
  // Ensure directory exists
  if (!fs.existsSync(customUserDataPath)) {
    fs.mkdirSync(customUserDataPath, { recursive: true });
  }
  app.setPath('userData', customUserDataPath);
}

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 600,
    minWidth: 400,
    minHeight: 300,
    backgroundColor: '#1e1e2e',
    // Use default title bar for dragging
    titleBarStyle: 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  // In production (built with Vite), point to dist/renderer/index.html
  // __dirname is dist/main/main/
  mainWindow.loadFile(path.join(__dirname, '../../renderer/index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Only open DevTools in development mode
  // if (!app.isPackaged) {
  //   mainWindow.webContents.openDevTools();
  // }
}

function createMenu(): void {
  const isMac = process.platform === 'darwin';

  const template: MenuItemConstructorOptions[] = [
    // App menu (macOS only)
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' as const },
        { type: 'separator' as const },
        { role: 'services' as const },
        { type: 'separator' as const },
        { role: 'hide' as const },
        { role: 'hideOthers' as const },
        { role: 'unhide' as const },
        { type: 'separator' as const },
        { role: 'quit' as const },
      ],
    }] : []),
    // File menu
    {
      label: 'File',
      submenu: [
        {
          label: 'New Tab',
          accelerator: 'CmdOrCtrl+T',
          click: () => {
            mainWindow?.webContents.send('new-tab');
          },
        },
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+W',
          click: () => {
            mainWindow?.webContents.send('close-tab');
          },
        },
        { type: 'separator' },
        isMac ? { role: 'close' as const } : { role: 'quit' as const },
      ],
    },
    // Edit menu
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' as const },
        { role: 'redo' as const },
        { type: 'separator' as const },
        { role: 'cut' as const },
        { role: 'copy' as const },
        { role: 'paste' as const },
        { role: 'selectAll' as const },
      ],
    },
    // View menu
    {
      label: 'View',
      submenu: [
        { role: 'reload' as const },
        { role: 'forceReload' as const },
        { role: 'toggleDevTools' as const },
        { type: 'separator' as const },
        { role: 'resetZoom' as const },
        { role: 'zoomIn' as const },
        { role: 'zoomOut' as const },
        { type: 'separator' as const },
        { role: 'togglefullscreen' as const },
      ],
    },
    // Window menu
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' as const },
        { role: 'zoom' as const },
        ...(isMac ? [
          { type: 'separator' as const },
          { role: 'front' as const },
        ] : [
          { role: 'close' as const },
        ]),
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(() => {
  // Initialize database
  getDatabase();
  
  // Setup IPC handlers
  setupIpcHandlers();
  setupAIHandlers();
  setupSSHHandlers();
  setupChatHandlers();
  setupSearchHandlers();
  
  // Try to auto-unlock crypto using saved key
  const autoUnlocked = getCrypto().tryAutoUnlock();
  if (autoUnlocked) {
    console.log('[Crypto] Auto-unlocked using saved key');
  }
  
  createMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
