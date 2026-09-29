import { dialog, ipcMain } from 'electron';
import * as os from 'os';
import * as path from 'path';
import { getDatabase } from '../services/database/database';
import { scanDiscoveredDiarizeModels } from './audio/AlignmentEngine';

/**
 * Setup Settings IPC handlers for app_settings table
 */
export function setupSettingsHandlers(): void {
  // Get a setting value
  ipcMain.handle('settings:get', async (_event, key: string): Promise<string | null> => {
    return getDatabase().getSetting(key);
  });

  // Set a setting value
  ipcMain.handle('settings:set', async (_event, key: string, value: string): Promise<void> => {
    getDatabase().setSetting(key, value);
  });

  ipcMain.handle('dialog:open-directory', async (_event, defaultPath?: string): Promise<string | null> => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      defaultPath: defaultPath || path.join(os.homedir(), '.cache', 'tiginal', 'models'),
    });
    return (canceled || filePaths.length === 0) ? null : filePaths[0];
  });

  ipcMain.handle('dialog:open-file', async (_event, options?: { defaultPath?: string; extensions?: string[] }): Promise<string | null> => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile'],
      defaultPath: options?.defaultPath || path.join(os.homedir(), '.cache', 'tiginal', 'models'),
      filters: options?.extensions ? [{ name: 'Model Files', extensions: options.extensions }] : undefined,
    });
    return (canceled || filePaths.length === 0) ? null : filePaths[0];
  });

  ipcMain.handle('models:scan-diarize-models', async (_event, customRoot?: string) => {
    return scanDiscoveredDiarizeModels(customRoot);
  });
}
