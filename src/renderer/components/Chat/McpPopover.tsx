import React, { useState, useEffect } from 'react';
import { X, Search, RefreshCw, AlertCircle, Lock } from 'lucide-react';
import { clsx } from 'clsx';

interface McpTool {
  name: string;
  description: string;
}

interface McpServer {
  id: string;
  name: string;
  type: string;
  description: string;
  isBuiltin: boolean;
  enabled: boolean;
  disabledTools: string[];
  tools: McpTool[];
  warnings: string[];
  lastError: string | null;
}

interface McpPopoverProps {
  onClose: () => void;
}

const TYPE_LABELS: Record<string, string> = {
  builtin: 'Built-in',
  stdio: 'stdio',
  sse: 'SSE',
  streamableHttp: 'HTTP',
};

export const McpPopover: React.FC<McpPopoverProps> = ({ onClose }) => {
  const [globalEnabled, setGlobalEnabled] = useState(true);
  const [servers, setServers] = useState<McpServer[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const invoke = (channel: string, ...args: any[]) =>
    (window as any).electron.invoke(channel, ...args);

  useEffect(() => {
    void load();
    const handleUpdate = () => void load();
    window.addEventListener('mcp-updated', handleUpdate);
    return () => window.removeEventListener('mcp-updated', handleUpdate);
  }, []);

  const load = async () => {
    try {
      const [list, enabled] = await Promise.all([
        invoke('mcp:get-servers'),
        invoke('mcp:get-global-enabled'),
      ]);
      setServers(list || []);
      setGlobalEnabled(enabled);
      setExpanded(new Set((list || []).filter((s: McpServer) => s.enabled).map((s: McpServer) => s.id)));
    } catch (error) {
      console.error('Failed to load MCP servers:', error);
    } finally {
      setLoading(false);
    }
  };

  const notifyUpdated = () => window.dispatchEvent(new Event('mcp-updated'));

  const toggleGlobal = async () => {
    const next = !globalEnabled;
    setGlobalEnabled(next);
    await invoke('mcp:set-global-enabled', next);
    notifyUpdated();
  };

  const toggleServer = async (server: McpServer) => {
    if (!globalEnabled) return;
    const next = !server.enabled;
    setServers(prev => prev.map(s => (s.id === server.id ? { ...s, enabled: next } : s)));
    setBusyId(server.id);
    try {
      // Enabling connects to the server, so the reply carries the fresh tool list.
      setServers(await invoke('mcp:toggle-server', server.id, next));
      if (next) setExpanded(prev => new Set(prev).add(server.id));
    } finally {
      setBusyId(null);
    }
  };

  const toggleTool = async (server: McpServer, toolName: string) => {
    if (!globalEnabled || !server.enabled) return;
    const enabled = server.disabledTools.includes(toolName);
    setServers(prev => prev.map(s => s.id !== server.id ? s : {
      ...s,
      disabledTools: enabled
        ? s.disabledTools.filter(t => t !== toolName)
        : [...s.disabledTools, toolName],
    }));
    await invoke('mcp:toggle-tool', server.id, toolName, enabled);
  };

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // A search narrows the tool rows too, not just which servers are listed --
  // a server with a hundred tools is unreadable otherwise.
  const query = searchQuery.trim().toLowerCase();
  const filtered = servers
    .map(server => {
      if (!query) return server;
      const serverMatches =
        server.name.toLowerCase().includes(query) || server.description.toLowerCase().includes(query);
      const matchingTools = server.tools.filter(t =>
        t.name.toLowerCase().includes(query) || t.description.toLowerCase().includes(query)
      );
      if (!serverMatches && matchingTools.length === 0) return null;
      return serverMatches ? server : { ...server, tools: matchingTools };
    })
    .filter((s): s is McpServer => s !== null);

  return (
    <div className="absolute bottom-full left-0 right-0 mb-4 md:w-96 bg-surface border border-border rounded-xl shadow-xl z-50 flex flex-col max-h-[500px] animate-in fade-in slide-in-from-bottom-2">
      {/* Header */}
      <div className="flex items-center justify-between p-4 bg-surface-light/50 rounded-t-xl backdrop-blur-sm shrink-0">
        <h3 className="font-medium text-text-main">MCP Servers</h3>
        <div className="flex items-center gap-3">
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
          <button
            onClick={onClose}
            className="p-1 hover:bg-surface-hover rounded-md text-text-muted hover:text-text-main transition-colors"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="p-3 shrink-0">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            placeholder="Search servers and tools..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-surface-light border border-border rounded-lg pl-9 pr-3 py-1.5 text-sm text-text-main placeholder-text-muted focus:outline-none focus:border-primary/50 transition-colors"
          />
        </div>
      </div>

      {/* Content */}
      <div className={clsx(
        'overflow-y-auto p-2 flex flex-col gap-2 transition-opacity duration-200 flex-1 min-h-0',
        !globalEnabled && 'pointer-events-none'
      )}>
        {loading ? (
          <div className="p-4 text-center text-text-muted text-sm shrink-0">Loading MCP servers...</div>
        ) : filtered.length === 0 ? (
          <div className="p-4 text-center text-text-muted text-sm shrink-0">
            {servers.length === 0 ? 'No MCP servers configured' : 'No matches'}
          </div>
        ) : (
          filtered.map((server, idx) => {
            const isExpanded = expanded.has(server.id) || query !== '';
            return (
              <React.Fragment key={server.id}>
                {idx > 0 && <div className="h-px bg-border mx-[2px] my-0.5 shrink-0" />}
                <div className="rounded-lg overflow-hidden bg-surface-light/30 shrink-0">
                  <div className="flex items-center p-2 gap-2 hover:bg-surface-hover/50 transition-colors rounded">
                    <button
                      onClick={() => toggleServer(server)}
                      disabled={busyId === server.id}
                      className={clsx(
                        'relative inline-flex h-3.5 w-6 shrink-0 items-center rounded-full transition-colors focus:outline-none disabled:opacity-50',
                        server.enabled ? 'bg-primary' : 'bg-toggle-off border border-toggle-off-border'
                      )}
                    >
                      <span className={clsx(
                        'inline-block h-2.5 w-2.5 transform rounded-full transition-transform shadow-sm',
                        server.enabled ? 'bg-primary-foreground' : 'bg-toggle-off-thumb',
                        server.enabled ? 'translate-x-3' : 'translate-x-0.5'
                      )} />
                    </button>

                    <button onClick={() => toggleExpand(server.id)} className="flex-1 flex items-center justify-between text-left min-w-0 gap-2">
                      <span className="text-xs font-semibold text-text-main pl-1 truncate flex items-center gap-1.5">
                        {server.name}
                        {server.isBuiltin && <Lock size={9} className="text-text-muted shrink-0" />}
                      </span>
                      <span className="flex items-center gap-1 shrink-0">
                        {busyId === server.id && <RefreshCw size={10} className="animate-spin text-text-muted" />}
                        <span className="text-[10px] text-text-muted bg-surface border border-border px-1.5 rounded">
                          {TYPE_LABELS[server.type] || server.type}
                        </span>
                        <span className="text-[10px] text-text-muted bg-surface border border-border px-1.5 rounded">
                          {server.tools.length}
                        </span>
                      </span>
                    </button>
                  </div>

                  {server.lastError && (
                    <div className="px-2 pb-2 text-[10px] text-red-400 flex items-start gap-1" title={server.lastError}>
                      <AlertCircle size={11} className="mt-px shrink-0" />
                      <span className="truncate">{server.lastError}</span>
                    </div>
                  )}

                  {!server.lastError && server.warnings?.length > 0 && (
                    <div className="px-2 pb-2 text-[10px] text-amber-400 flex items-start gap-1" title={server.warnings.join('\n')}>
                      <AlertCircle size={11} className="mt-px shrink-0" />
                      <span className="truncate">{server.warnings[0]}</span>
                    </div>
                  )}

                  {isExpanded && server.tools.length > 0 && (
                    <div className={clsx('p-1 space-y-1', !server.enabled && 'opacity-50 pointer-events-none')}>
                      {server.tools.map(tool => {
                        const toolEnabled = !server.disabledTools.includes(tool.name);
                        return (
                          <div key={tool.name} className="flex items-center justify-between p-2 rounded hover:bg-surface-hover transition-colors ml-7 pl-2">
                            <div className="flex-1 mr-3 min-w-0">
                              <span className="font-medium text-xs text-text-main truncate block">{tool.name}</span>
                              {tool.description && (
                                <p className="text-[10px] text-text-muted truncate" title={tool.description}>{tool.description}</p>
                              )}
                            </div>
                            <button
                              onClick={() => toggleTool(server, tool.name)}
                              className={clsx(
                                'relative inline-flex h-3.5 w-6 shrink-0 items-center rounded-full transition-colors focus:outline-none',
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
                      })}
                    </div>
                  )}
                </div>
              </React.Fragment>
            );
          })
        )}
      </div>

      {!globalEnabled && (
        <div className="p-2 border-t border-border bg-surface-light/30 shrink-0">
          <div className="text-[10px] text-text-muted text-center">MCP servers are disabled.</div>
        </div>
      )}
    </div>
  );
};
