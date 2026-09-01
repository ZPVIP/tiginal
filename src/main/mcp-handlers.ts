import { ipcMain, dialog } from 'electron';
import * as fs from 'fs';
import { getMcpService } from './services/mcp/McpService';
import { BUILTIN_PROVIDERS } from './services/mcp/builtin';
import { McpServer } from './services/mcp/types';

/**
 * Setup MCP-related IPC handlers.
 *
 * Servers are stored as raw JSON, so the renderer sends config as text and this
 * layer owns parsing: a syntax error becomes a readable message instead of a
 * silently dropped edit.
 */
export function setupMcpHandlers(): void {
  const mcp = getMcpService();

  // Make sure fetch / python / ruby / filesystem exist before the UI asks.
  try {
    mcp.seedBuiltins();
  } catch (e) {
    console.error('[MCP] Failed to seed built-in servers', e);
  }

  const parseConfig = (text: string): any => {
    try {
      return JSON.parse(text);
    } catch (e: any) {
      throw new Error(`Invalid JSON: ${e.message}`);
    }
  };

  ipcMain.handle('mcp:get-servers', async (): Promise<McpServer[]> => mcp.listServers());

  ipcMain.handle('mcp:save-server', async (_event, input: { id?: string; name: string; configText: string }): Promise<McpServer> => {
    return mcp.saveServer({
      id: input.id,
      name: input.name,
      config: parseConfig(input.configText),
    });
  });

  ipcMain.handle('mcp:delete-server', async (_event, id: string): Promise<void> => {
    mcp.deleteServer(id);
  });

  ipcMain.handle('mcp:toggle-server', async (_event, id: string, enabled: boolean): Promise<McpServer[]> => {
    mcp.setEnabled(id, enabled);
    // Enabling is the natural moment to discover what the server offers.
    if (enabled) await mcp.refreshTools(id);
    return mcp.listServers();
  });

  ipcMain.handle('mcp:toggle-tool', async (_event, id: string, toolName: string, enabled: boolean): Promise<void> => {
    mcp.setToolEnabled(id, toolName, enabled);
  });

  ipcMain.handle('mcp:reorder', async (_event, orderedIds: string[]): Promise<void> => {
    mcp.reorder(orderedIds);
  });

  ipcMain.handle('mcp:refresh', async (_event, id: string): Promise<McpServer> => mcp.refreshTools(id));

  ipcMain.handle('mcp:refresh-all', async (): Promise<McpServer[]> => mcp.refreshAllEnabled());

  ipcMain.handle('mcp:import-json', async (_event, text: string) => mcp.importJson(text));

  ipcMain.handle('mcp:import-file', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Import MCP servers',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return mcp.importJson(fs.readFileSync(result.filePaths[0], 'utf-8'));
  });

  ipcMain.handle('mcp:get-global-enabled', async (): Promise<boolean> => mcp.isGlobalEnabled());

  ipcMain.handle('mcp:get-status', async () => mcp.getStatus());

  ipcMain.handle('mcp:set-global-enabled', async (_event, enabled: boolean): Promise<void> => {
    mcp.setGlobalEnabled(enabled);
  });

  ipcMain.handle('mcp:restore-builtins', async (): Promise<McpServer[]> => {
    mcp.seedBuiltins();
    return mcp.listServers();
  });

  // Templates for the "add server" editor.
  ipcMain.handle('mcp:get-templates', async () => ({
    builtin: Object.entries(BUILTIN_PROVIDERS).map(([provider, def]) => ({
      provider,
      description: def.description,
      config: def.defaults(),
    })),
    stdio: {
      type: 'stdio',
      description: 'Describe what this server does',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-everything'],
      env: {},
      timeout: 60,
    },
    streamableHttp: {
      type: 'streamableHttp',
      description: 'Describe what this server does',
      url: 'https://example.com/mcp',
      headers: {},
      timeout: 60,
    },
  }));
}
