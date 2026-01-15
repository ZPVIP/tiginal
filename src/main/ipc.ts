import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { createPty, getPty, writeToPty, resizePty, killPty, PtyOptions } from './pty';

/**
 * Setup all IPC handlers for PTY communication
 */
export function setupIpcHandlers(): void {
  // Create new PTY
  ipcMain.handle('pty:create', (_event: IpcMainInvokeEvent, options?: PtyOptions): number => {
    return createPty(options);
  });

  // Write to PTY
  ipcMain.on('pty:write', (_event, id: number, data: string) => {
    writeToPty(id, data);
  });

  // Resize PTY
  ipcMain.on('pty:resize', (_event, id: number, cols: number, rows: number) => {
    resizePty(id, cols, rows);
  });

  // Kill PTY
  ipcMain.on('pty:kill', (_event, id: number) => {
    killPty(id);
  });

  // Subscribe to PTY data
  ipcMain.on('pty:subscribe', (event, id: number) => {
    const ptyProcess = getPty(id);
    if (ptyProcess) {
      const onData = (data: string) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('pty:data', id, data);
        }
      };

      const onExit = (exitCode: number) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('pty:exit', id, exitCode);
        }
      };

      ptyProcess.onData(onData);
      ptyProcess.onExit(({ exitCode }) => onExit(exitCode));
    }
  });
}
