import { ipcMain } from 'electron';
import { getDatabase } from '../services/database/database';

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
}
