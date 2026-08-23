import React, { useState, useEffect } from 'react';
import { clsx } from 'clsx';
import {
  Plus, Trash2, Edit2, RefreshCw, Download, Upload, Check, Save, X,
  ChevronUp, ChevronDown, AlertCircle, Server, Lock, FileJson
} from 'lucide-react';

interface McpTool {
  name: string;
  description: string;
  inputSchema: any;
}

interface McpServer {
  id: string;
  name: string;
  type: 'builtin' | 'stdio' | 'sse' | 'streamableHttp';
  description: string;
  config: Record<string, any>;
  isBuiltin: boolean;
  enabled: boolean;
  disabledTools: string[];
  tools: McpTool[];
  warnings: string[];
  lastError: string | null;
  rank: number;
}

const STDIO_TEMPLATE = {
  type: 'stdio',
  description: 'What this server does',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-everything'],
  env: {},
  timeout: 60,
};

const IMPORT_PLACEHOLDER = `{
  "mcpServers": {
    "context7": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp"]
    }
  }
}`;

/** Electron prefixes IPC rejections with "Error invoking remote method '...':" */
function cleanError(e: any): string {
  return String(e?.message || e || '')
    .replace(/^Error invoking remote method '[^']*':\s*(Error:\s*)?/, '')
    || 'Something went wrong';
}

const TYPE_LABELS: Record<string, string> = {
  builtin: 'Built-in',
  stdio: 'stdio',
  sse: 'SSE',
  streamableHttp: 'HTTP',
};

export function McpSettings() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [globalEnabled, setGlobalEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Editor state (also used for "add new")
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftJson, setDraftJson] = useState('');
  const [draftError, setDraftError] = useState<string | null>(null);

  // Import state
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState<string | null>(null);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const invoke = (channel: string, ...args: any[]) =>
    (window as any).electron.invoke(channel, ...args);

  useEffect(() => {
    void load();
  }, []);

  const notifyUpdated = () => window.dispatchEvent(new Event('mcp-updated'));

  const load = async () => {
    try {
      const [list, enabled] = await Promise.all([
        invoke('mcp:get-servers'),
        invoke('mcp:get-global-enabled'),
      ]);
      setServers(list || []);
      setGlobalEnabled(enabled);
    } catch (e) {
      console.error('Failed to load MCP servers:', e);
    }
  };

  const toggleGlobal = async () => {
    const next = !globalEnabled;
    setGlobalEnabled(next);
    await invoke('mcp:set-global-enabled', next);
    notifyUpdated();
  };

  const toggleServer = async (server: McpServer) => {
    const next = !server.enabled;
    // Optimistic: connecting to a stdio server can take a second or two.
    setServers(prev => prev.map(s => (s.id === server.id ? { ...s, enabled: next } : s)));
    setBusy(true);
    try {
      setServers(await invoke('mcp:toggle-server', server.id, next));
      notifyUpdated();
    } finally {
      setBusy(false);
    }
  };

  const toggleTool = async (server: McpServer, toolName: string) => {
    const enabled = server.disabledTools.includes(toolName);
    setServers(prev => prev.map(s => s.id !== server.id ? s : {
      ...s,
      disabledTools: enabled
        ? s.disabledTools.filter(t => t !== toolName)
        : [...s.disabledTools, toolName],
    }));
    await invoke('mcp:toggle-tool', server.id, toolName, enabled);
    notifyUpdated();
  };

  const refresh = async (id: string) => {
    setBusy(true);
    try {
      const updated: McpServer = await invoke('mcp:refresh', id);
      setServers(prev => prev.map(s => (s.id === id ? updated : s)));
      const warnings = updated.warnings?.length ? `, ${updated.warnings.length} warning(s)` : '';
      setNotice(updated.lastError ? null : `${updated.name}: ${updated.tools.length} tool(s)${warnings}`);
      notifyUpdated();
    } finally {
      setBusy(false);
    }
  };

  const move = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= servers.length) return;
    const next = [...servers];
    [next[index], next[target]] = [next[target], next[index]];
    setServers(next);
    await invoke('mcp:reorder', next.map(s => s.id));
  };

  const remove = async (server: McpServer) => {
    if (!confirm(`Delete the MCP server "${server.name}"?`)) return;
    await invoke('mcp:delete-server', server.id);
    if (editingId === server.id) closeEditor();
    void load();
    notifyUpdated();
  };

  const openEditor = (server: McpServer) => {
    setIsNew(false);
    setEditingId(server.id);
    setDraftName(server.name);
    setDraftJson(JSON.stringify(server.config, null, 2));
    setDraftError(null);
    setShowImport(false);
  };

  const openNew = () => {
    setIsNew(true);
    setEditingId(null);
    setDraftName('');
    setDraftJson(JSON.stringify(STDIO_TEMPLATE, null, 2));
    setDraftError(null);
    setShowImport(false);
  };

  const closeEditor = () => {
    setIsNew(false);
    setEditingId(null);
    setDraftError(null);
  };

  const editingServer = editingId ? servers.find(s => s.id === editingId) : undefined;
  const isEditorOpen = isNew || editingId !== null;

  const save = async () => {
    setDraftError(null);
    try {
      await invoke('mcp:save-server', {
        id: isNew ? undefined : editingId,
        name: draftName.trim(),
        configText: draftJson,
      });
      closeEditor();
      await load();
      notifyUpdated();
    } catch (e) {
      setDraftError(cleanError(e));
    }
  };

  const reportImport = (result: { added: number; updated: number; skipped: Array<{ name: string; reason: string }> } | null) => {
    if (!result) return;
    const parts = [`${result.added} added`, `${result.updated} updated`];
    if (result.skipped.length) {
      parts.push(`${result.skipped.length} skipped (${result.skipped.map(s => `${s.name}: ${s.reason}`).join('; ')})`);
    }
    setNotice(parts.join(', '));
    setShowImport(false);
    setImportText('');
    void load();
    notifyUpdated();
  };

  const openImport = () => {
    closeEditor();
    setImportError(null);
    setShowImport(true);
  };

  const closeImport = () => {
    setShowImport(false);
    setImportText('');
    setImportError(null);
  };

  const runImport = async () => {
    setImportError(null);
    try {
      reportImport(await invoke('mcp:import-json', importText));
    } catch (e) {
      setImportError(cleanError(e));
    }
  };

  const importFile = async () => {
    setImportError(null);
    try {
      reportImport(await invoke('mcp:import-file'));
    } catch (e) {
      setImportError(cleanError(e));
    }
  };

  const restoreBuiltins = async () => {
    setServers(await invoke('mcp:restore-builtins'));
    setNotice('Missing built-in servers restored');
    notifyUpdated();
  };

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-text-main">MCP Servers</h2>
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-muted font-medium">Global</span>
          <button
            onClick={toggleGlobal}
            className={clsx(
              'relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none',
              globalEnabled ? 'bg-primary' : 'bg-toggle-off border border-toggle-off-border'
            )}
          >
            <span className={clsx(
              'inline-block h-3.5 w-3.5 transform rounded-full transition-transform shadow-sm',
              globalEnabled ? 'bg-primary-foreground' : 'bg-toggle-off-thumb',
              globalEnabled ? 'translate-x-5' : 'translate-x-0.5'
            )} />
          </button>
        </div>
      </div>

      <p className="text-sm text-text-muted -mt-4">
        Model Context Protocol servers add tools to the chat. Built-in servers run inside Tiginal;
        others are launched as a command or reached over HTTP. Every server is stored as plain JSON.
      </p>

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={openNew}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm rounded-lg hover:opacity-90 transition-colors"
        >
          <Plus size={14} /> Add Server
        </button>
        <button
          onClick={openImport}
          className="flex items-center gap-2 px-4 py-2 bg-surface border border-border text-text-main text-sm rounded-lg hover:border-primary hover:bg-surface-light transition-colors"
        >
          <Upload size={14} /> Import JSON
        </button>
        <button
          onClick={() => invoke('mcp:refresh-all').then(setServers).then(notifyUpdated)}
          disabled={busy}
          className="flex items-center gap-2 px-4 py-2 bg-surface border border-border text-text-main text-sm rounded-lg hover:border-primary hover:bg-surface-light transition-colors disabled:opacity-50"
        >
          <RefreshCw size={14} className={busy ? 'animate-spin' : ''} /> Refresh All
        </button>
        <button
          onClick={restoreBuiltins}
          className="flex items-center gap-2 px-4 py-2 bg-surface border border-border text-text-main text-sm rounded-lg hover:border-primary hover:bg-surface-light transition-colors"
        >
          <Download size={14} /> Restore Built-ins
        </button>
      </div>

      {notice && (
        <div className="px-4 py-2 rounded-lg bg-primary/10 border border-primary/30 text-xs text-text-main flex items-center justify-between gap-3">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-text-muted hover:text-text-main">Dismiss</button>
        </div>
      )}

      {/* Server list */}
      <div className="space-y-2">
        {servers.length === 0 ? (
          <div className="text-center py-8 text-text-muted text-sm">No MCP servers configured</div>
        ) : (
          servers.map((server, index) => {
            const isExpanded = expanded.has(server.id);
            return (
              <div key={server.id} className="bg-surface rounded-lg border border-border hover:border-primary/50 transition-colors">
                <div className="flex items-center gap-3 px-4 py-3">
                  <button
                    onClick={() => toggleServer(server)}
                    className={clsx(
                      'w-5 h-5 rounded border flex items-center justify-center transition-colors shrink-0',
                      server.enabled
                        ? 'bg-primary border-primary text-primary-foreground'
                        : 'bg-toggle-off border-toggle-off-border hover:border-primary'
                    )}
                    title={server.enabled ? 'Disable' : 'Enable'}
                  >
                    {server.enabled && <Check size={12} />}
                  </button>

                  <button onClick={() => toggleExpand(server.id)} className="flex-1 min-w-0 text-left">
                    <div className="flex items-center gap-2">
                      <Server size={13} className="text-text-muted shrink-0" />
                      <span className="text-sm font-medium text-text-main truncate">{server.name}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-light border border-border text-text-muted shrink-0">
                        {TYPE_LABELS[server.type] || server.type}
                      </span>
                      {server.isBuiltin && (
                        <Lock size={10} className="text-text-muted shrink-0" aria-label="Built-in" />
                      )}
                      {server.tools.length > 0 && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-light border border-border text-text-muted shrink-0">
                          {server.tools.length} tools
                        </span>
                      )}
                    </div>
                    {server.description && (
                      <p className="text-[11px] text-text-muted truncate mt-0.5">{server.description}</p>
                    )}
                    {server.lastError && (
                      <p className="text-[11px] text-red-400 truncate mt-0.5" title={server.lastError}>
                        {server.lastError}
                      </p>
                    )}
                    {!server.lastError && server.warnings?.length > 0 && (
                      <p className="text-[11px] text-amber-400 truncate mt-0.5" title={server.warnings.join('\n')}>
                        {server.warnings[0]}
                      </p>
                    )}
                  </button>

                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => move(index, -1)} disabled={index === 0}
                      className="p-1.5 text-text-muted hover:text-text-main disabled:opacity-30" title="Move up">
                      <ChevronUp size={14} />
                    </button>
                    <button onClick={() => move(index, 1)} disabled={index === servers.length - 1}
                      className="p-1.5 text-text-muted hover:text-text-main disabled:opacity-30" title="Move down">
                      <ChevronDown size={14} />
                    </button>
                    <button onClick={() => refresh(server.id)} disabled={busy}
                      className="p-1.5 text-text-muted hover:text-text-main disabled:opacity-30" title="Reload tool list">
                      <RefreshCw size={14} />
                    </button>
                    <button onClick={() => openEditor(server)}
                      className="p-1.5 text-text-muted hover:text-text-main" title="Edit JSON">
                      <Edit2 size={14} />
                    </button>
                    <button onClick={() => remove(server)}
                      className="p-1.5 text-text-muted hover:text-red-400" title="Delete">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-border px-4 py-3 space-y-2">
                    {server.tools.length === 0 ? (
                      <p className="text-xs text-text-muted">
                        No tools discovered yet — enable the server or press reload.
                      </p>
                    ) : (
                      server.tools.map(tool => {
                        const toolEnabled = !server.disabledTools.includes(tool.name);
                        return (
                          <div key={tool.name} className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-xs font-medium text-text-main truncate">{tool.name}</div>
                              {tool.description && (
                                <p className="text-[11px] text-text-muted line-clamp-2">{tool.description}</p>
                              )}
                            </div>
                            <button
                              onClick={() => toggleTool(server, tool.name)}
                              className={clsx(
                                'relative inline-flex h-3.5 w-6 shrink-0 items-center rounded-full transition-colors mt-0.5',
                                toolEnabled ? 'bg-primary' : 'bg-toggle-off border border-toggle-off-border'
                              )}
                            >
                              <span className={clsx(
                                'inline-block h-2.5 w-2.5 transform rounded-full transition-transform shadow-sm',
                                toolEnabled ? 'bg-primary-foreground' : 'bg-toggle-off-thumb',
                                toolEnabled ? 'translate-x-3' : 'translate-x-0.5'
                              )} />
                            </button>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Import modal */}
      {showImport && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface border border-border rounded-xl w-full max-w-2xl shadow-xl flex flex-col max-h-full">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
              <div className="flex items-center gap-2">
                <Upload className="text-primary" size={20} />
                <h3 className="text-lg font-semibold text-text-main">Import MCP Servers</h3>
              </div>
              <button onClick={closeImport} className="text-text-muted hover:text-text-main">
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {importError && (
                <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm flex items-center gap-2">
                  <AlertCircle size={16} /> {importError}
                </div>
              )}

              <div className="flex flex-col min-h-[280px]">
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-medium text-text-sec">Configuration (JSON)</label>
                  <button onClick={importFile} className="text-xs text-primary hover:underline flex items-center gap-1">
                    <FileJson size={12} /> Choose a file…
                  </button>
                </div>
                <textarea
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  placeholder={IMPORT_PLACEHOLDER}
                  spellCheck={false}
                  className="flex-1 w-full bg-background border border-border rounded-lg p-4 text-sm font-mono text-text-main focus:ring-primary focus:border-primary resize-none leading-relaxed"
                />
              </div>

              <p className="text-[11px] text-text-muted">
                Accepts <code>{'{ "mcpServers": { … } }'}</code>, a bare name → config map, or an array of
                <code> {'{ "name": …, … }'}</code> objects. Servers with an existing name are updated; built-ins are never overwritten.
              </p>
            </div>

            <div className="px-6 py-4 border-t border-border flex justify-end gap-3 shrink-0">
              <button
                onClick={closeImport}
                className="px-4 py-2 text-sm bg-background hover:bg-surface-light border border-border rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={runImport}
                disabled={!importText.trim()}
                className="flex items-center gap-1.5 px-4 py-2 text-sm bg-primary hover:opacity-90 text-primary-foreground rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Upload size={16} /> Import
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Server editor modal */}
      {isEditorOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface border border-border rounded-xl w-full max-w-2xl shadow-xl flex flex-col max-h-full">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
              <div className="flex items-center gap-2">
                <FileJson className="text-primary" size={20} />
                <h3 className="text-lg font-semibold text-text-main">
                  {isNew ? 'Add MCP Server' : draftName}
                </h3>
                {editingServer?.isBuiltin && (
                  <span className="text-xs bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded border border-blue-500/20">Built-in</span>
                )}
              </div>
              <button onClick={closeEditor} className="text-text-muted hover:text-text-main">
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {draftError && (
                <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm flex items-center gap-2">
                  <AlertCircle size={16} /> {draftError}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-text-sec mb-1.5">
                  Name {editingServer?.isBuiltin && '(a built-in server cannot be renamed)'}
                </label>
                <input
                  type="text"
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  disabled={editingServer?.isBuiltin}
                  placeholder="e.g. context7"
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-text-main disabled:opacity-50 disabled:cursor-not-allowed"
                />
              </div>

              <div className="flex-1 min-h-[300px] flex flex-col">
                <label className="block text-xs font-medium text-text-sec mb-1.5">Configuration (JSON)</label>
                <textarea
                  value={draftJson}
                  onChange={(e) => setDraftJson(e.target.value)}
                  spellCheck={false}
                  className="flex-1 w-full bg-background border border-border rounded-lg p-4 text-sm font-mono text-text-main focus:ring-primary focus:border-primary resize-none leading-relaxed"
                />
              </div>
            </div>

            <div className="px-6 py-4 border-t border-border flex justify-end gap-3 shrink-0">
              <button
                onClick={closeEditor}
                className="px-4 py-2 text-sm bg-background hover:bg-surface-light border border-border rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={save}
                className="flex items-center gap-1.5 px-4 py-2 text-sm bg-primary hover:opacity-90 text-primary-foreground rounded-lg transition-colors"
              >
                <Save size={16} /> Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
