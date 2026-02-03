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
import { setupSettingsHandlers } from './settings-handlers';
import { setupShellHandlers } from './shell-handlers';
import { setupSkillHandlers } from './skill-handlers';
import { setupToolHandlers } from './tool-handlers';
import { getDatabase } from '../services/database/database';
import { getCrypto } from '../services/ssh/CryptoService';
import * as crypto from 'crypto';

// Default configuration for first run
import defaults from './defaults.json';

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

function initializeDefaults(): void {
  const db = getDatabase();
  const dbConn = db.getDb();
  
  // Insert default tools if tools table is empty
  const toolCount = dbConn.prepare('SELECT COUNT(*) as count FROM tools').get() as { count: number };
  if (toolCount.count === 0 && defaults.defaultTools) {
    const now = Date.now();
    const insertStmt = dbConn.prepare(`
      INSERT INTO tools (id, name, description, input_schema, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    
    for (const tool of defaults.defaultTools) {
      insertStmt.run(
        crypto.randomUUID(),
        tool.name,
        tool.description,
        JSON.stringify(tool.input_schema),
        1, // enabled
        now,
        now
      );
    }
    console.log(`[Init] Inserted ${defaults.defaultTools.length} default tools`);
  }
}

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  // Load window state
  const statePath = path.join(app.getPath('userData'), 'window-state.json');
  let windowState = { width: 900, height: 600, x: undefined, y: undefined };
  
  try {
    if (fs.existsSync(statePath)) {
      windowState = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    }
  } catch (e) {
    console.error('Failed to load window state:', e);
  }

  mainWindow = new BrowserWindow({
    width: windowState.width,
    height: windowState.height,
    x: windowState.x,
    y: windowState.y,
    minWidth: 400,
    minHeight: 300,
    backgroundColor: '#1e1e2e',
    // Custom title bar for immersive feel
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 12, y: 9 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true,
      contextIsolation: false,
      // Disable DevTools in production for security
      devTools: !app.isPackaged,
    },
  });

  // Save window state
  const saveState = () => {
    if (!mainWindow) return;
    const bounds = mainWindow.getBounds();
    try {
      fs.writeFileSync(statePath, JSON.stringify(bounds));
    } catch (e) {
      console.error('Failed to save window state:', e);
    }
  };

  ['resize', 'move', 'close'].forEach(event => {
    mainWindow?.on(event as any, saveState);
  });

  // In production (built with Vite), point to dist/renderer/index.html
  // __dirname is dist/main/main/
  mainWindow.loadFile(path.join(__dirname, '../../renderer/index.html'));

  // Open external links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Check if it's http/https
    if (url.startsWith('http:') || url.startsWith('https:')) {
      require('electron').shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

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
        // Only show DevTools menu item in development
        ...(!app.isPackaged ? [{ role: 'toggleDevTools' as const }] : []),
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
  setupSettingsHandlers();
  setupShellHandlers();
  setupSkillHandlers();
  setupToolHandlers();
  
  // Initialize default skills directory
  getDatabase().getDb().prepare(
    'INSERT OR IGNORE INTO skill_directories (id, name, path, enabled) VALUES (?, ?, ?, ?)'
  ).run(
    require('crypto').randomUUID(),
    'Tiginal',
    process.platform === 'win32'
      ? require('path').join(process.env.APPDATA || require('os').homedir(), 'Tiginal', 'skills')
      : require('path').join(require('os').homedir(), '.config', 'tiginal', 'skills'),
    1
  );
  
  // Initialize default system prompt and tools (only on first run)
  initializeDefaults();
  
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
