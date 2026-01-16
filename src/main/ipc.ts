import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { createPty, getPty, writeToPty, resizePty, killPty, PtyOptions } from './pty';

/**
 * Setup all IPC handlers for PTY communication
 */
export function setupIpcHandlers(): void {
  // Create new PTY and auto-subscribe
  ipcMain.handle('pty:create', (event: IpcMainInvokeEvent, options?: PtyOptions): number => {
    const ptyId = createPty(options);
    const ptyProcess = getPty(ptyId);

    if (ptyProcess) {
      // Immediate subscription to avoid race condition
      const onData = (data: string) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('pty:data', ptyId, data);
        }
      };

      const onExit = (exitCode: number) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('pty:exit', ptyId, exitCode);
        }
      };

      ptyProcess.onData(onData);
      ptyProcess.onExit(({ exitCode }) => onExit(exitCode));
    }

    return ptyId;
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

  // Deprecated: Subscription is now handled in pty:create
  ipcMain.on('pty:subscribe', () => {
     // No-op
  });
}
