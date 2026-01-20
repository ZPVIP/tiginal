import { ipcMain } from 'electron';
import { getPathCompletions } from './shellHistory';
import { directoryService } from './DirectoryService';

export function setupShellHandlers() {
  ipcMain.handle('shell:get-directory-suggestions', async (_, partial: string, cwd: string) => {
    // 1. Local Completions (Current Directory subdirs)
    // We reuse getPathCompletions but want specifically direct subdirectories for "Local"
    // getPathCompletions returns formatted strings "subdir/"
    const local = getPathCompletions(partial, cwd);

    // 2. Frequent Directories (Global history)
    const frequent = directoryService.getFrequentDirectories(partial);
    
    // Filter frequent to exclude items already in local to avoid duplicates?
    // Or just distinct sections.
    // Let's keep them distinct. UI will render separate sections.

    return {
        local,
        frequent
    };
  });

  ipcMain.handle('shell:record-visit', async (_, path: string) => {
    directoryService.recordVisit(path);
  });

  ipcMain.handle('shell:ignore-visit', async (_, path: string) => {
    directoryService.ignoreDirectory(path);
  });
}
