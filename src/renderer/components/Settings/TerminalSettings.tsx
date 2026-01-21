import React, { useState, useEffect, useMemo } from 'react';
import { clsx } from 'clsx';
import { Settings, Terminal, FolderOpen, Trash2, Star, StarOff, Search, Edit2, Save, X, Bot, ChevronDown, ArrowDown, Plus, Shield, ChevronLeft, ChevronRight } from 'lucide-react';

interface CommandRow {
  id: number;
  command: string;
  score: number;
  last_used: number;
  is_favorite: number;
}

interface DirectoryRow {
  path: string;
  score: number;
  last_visited: number;
}

interface BlacklistRow {
  id: number;
  pattern: string;
}

interface AIProvider {
  id: string;
  name: string;
  model: string;
  isDefault?: boolean;
  availableModels?: Array<string | { id: string; name: string; enabled?: boolean }>;
}

const TABS = [
  { id: 'general', label: 'General', icon: <Settings size={14} /> },
  { id: 'commands', label: 'Commands', icon: <Terminal size={14} /> },
  { id: 'directories', label: 'Directories', icon: <FolderOpen size={14} /> },
];

const FONT_OPTIONS = [
  { value: 'monospace', label: 'System Monospace' },
  { value: '"SF Mono", monospace', label: 'SF Mono' },
  { value: '"Menlo", monospace', label: 'Menlo' },
  { value: '"Monaco", monospace', label: 'Monaco' },
  { value: '"Fira Code", monospace', label: 'Fira Code' },
  { value: '"JetBrains Mono", monospace', label: 'JetBrains Mono' },
  { value: '"Cascadia Code", monospace', label: 'Cascadia Code' },
  { value: '"Source Code Pro", monospace', label: 'Source Code Pro' },
  { value: '"IBM Plex Mono", monospace', label: 'IBM Plex Mono' },
  { value: '"Consolas", monospace', label: 'Consolas' },
  { value: '"Ubuntu Mono", monospace', label: 'Ubuntu Mono' },
  { value: '"Inconsolata", monospace', label: 'Inconsolata' },
  { value: '"Roboto Mono", monospace', label: 'Roboto Mono' },
  { value: '"Hack", monospace', label: 'Hack' },
  { value: '"Anonymous Pro", monospace', label: 'Anonymous Pro' },
];

export function TerminalSettings() {
  const [activeTab, setActiveTab] = useState('general');
  
  // General settings
  const [fontFamily, setFontFamily] = useState('monospace');
  const [fontDropdownOpen, setFontDropdownOpen] = useState(false);
  const [fontSize, setFontSize] = useState(14);
  const [aiModel, setAiModel] = useState('');
  const [cleanupInterval, setCleanupInterval] = useState(24);
  const [minScore, setMinScore] = useState(2);
  
  // AI Providers
  const [providers, setProviders] = useState<AIProvider[]>([]);
  
  // Commands
  const [commands, setCommands] = useState<CommandRow[]>([]);
  const [cmdSearch, setCmdSearch] = useState('');
  const [editingCmd, setEditingCmd] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');
  const [cmdBlacklist, setCmdBlacklist] = useState<BlacklistRow[]>([]);
  const [editingCmdBl, setEditingCmdBl] = useState<number | null>(null);
  const [editCmdBlValue, setEditCmdBlValue] = useState('');
  const [newCmdBlPattern, setNewCmdBlPattern] = useState('');
  
  // Directories
  const [directories, setDirectories] = useState<DirectoryRow[]>([]);
  const [dirSearch, setDirSearch] = useState('');
  const [dirBlacklist, setDirBlacklist] = useState<BlacklistRow[]>([]);
  const [editingDirBl, setEditingDirBl] = useState<number | null>(null);
  const [editDirBlValue, setEditDirBlValue] = useState('');
  const [newDirBlPattern, setNewDirBlPattern] = useState('');

  // Pagination (10 items per page)
  const PAGE_SIZE = 10;
  const [cmdPage, setCmdPage] = useState(0);
  const [cmdBlPage, setCmdBlPage] = useState(0);
  const [dirPage, setDirPage] = useState(0);
  const [dirBlPage, setDirBlPage] = useState(0);

  const invoke = window.electron?.invoke || (async () => null);

  useEffect(() => {
    loadSettings();
    loadProviders();
    loadCommands();
    loadDirectories();
    loadBlacklists();

    const handleUpdate = () => loadProviders();
    window.addEventListener('ai-providers-updated', handleUpdate);
    return () => window.removeEventListener('ai-providers-updated', handleUpdate);
  }, []);

  const loadSettings = async () => {
    const settings = await invoke('settings:get', 'terminal');
    if (settings) {
      const parsed = JSON.parse(settings);
      setFontFamily(parsed.fontFamily || 'monospace');
      setFontSize(parsed.fontSize || 14);
      setAiModel(parsed.aiModel || '');
      setCleanupInterval(parsed.cleanupInterval || 24);
      setMinScore(parsed.minScore || 2);
    }
  };

  const loadProviders = async () => {
    const list = await invoke('ai:get-providers');
    setProviders(list || []);
  };

  const saveSettings = async (updates?: Record<string, any>) => {
    await invoke('settings:set', 'terminal', JSON.stringify({
      fontFamily,
      fontSize,
      aiModel,
      cleanupInterval,
      minScore,
      ...updates
    }));
    // Notify terminals to update font
    window.dispatchEvent(new CustomEvent('terminal-settings-changed'));
  };

  const loadCommands = async () => {
    const cmds = await invoke('shell:get-all-commands');
    setCommands(cmds || []);
  };

  const loadDirectories = async () => {
    const dirs = await invoke('shell:get-all-directories');
    setDirectories(dirs || []);
  };

  const loadBlacklists = async () => {
    const cmdBl = await invoke('shell:get-command-blacklist');
    setCmdBlacklist(cmdBl || []);
    const dirBl = await invoke('shell:get-directory-blacklist');
    setDirBlacklist(dirBl || []);
  };

  // Model list
  const allModels = useMemo(() => {
    const list: { value: string; label: string }[] = [];
    providers.forEach(p => {
      if (p.availableModels && p.availableModels.length > 0) {
        p.availableModels.forEach(m => {
          const mObj = typeof m === 'string' ? { id: m, name: m, enabled: true } : m;
          if (mObj.enabled !== false) {
            list.push({
              value: `${p.id}:${mObj.id}`,
              label: `${p.name} / ${mObj.name}`
            });
          }
        });
      }
    });
    return list;
  }, [providers]);

  useEffect(() => {
    if (aiModel && allModels.length > 0) {
      const isValid = allModels.some(m => m.value === aiModel);
      if (!isValid) {
        setAiModel('');
        saveSettings({ aiModel: '' });
      }
    }
  }, [allModels, aiModel]);

  // Command handlers
  const handleDeleteCommand = async (cmd: string) => {
    await invoke('shell:remove-command', cmd);
    loadCommands();
  };

  const handleToggleFavorite = async (id: number) => {
    await invoke('shell:toggle-favorite', id);
    loadCommands();
  };

  const handleUpdateCommand = async (id: number) => {
    if (editValue.trim()) {
      await invoke('shell:update-command', id, editValue.trim());
      setEditingCmd(null);
      loadCommands();
    }
  };

  const handleMoveToBlacklist = async (command: string) => {
    await invoke('shell:add-command-blacklist', command);
    await invoke('shell:remove-command', command);
    loadCommands();
    loadBlacklists();
  };

  const handleAddCmdBlacklist = async () => {
    if (newCmdBlPattern.trim()) {
      await invoke('shell:add-command-blacklist', newCmdBlPattern.trim());
      setNewCmdBlPattern('');
      loadBlacklists();
    }
  };

  const handleUpdateCmdBlacklist = async (id: number) => {
    if (editCmdBlValue.trim()) {
      await invoke('shell:update-command-blacklist', id, editCmdBlValue.trim());
      setEditingCmdBl(null);
      loadBlacklists();
    }
  };

  const handleRemoveCmdBlacklist = async (id: number) => {
    await invoke('shell:remove-command-blacklist', id);
    loadBlacklists();
  };

  // Directory handlers
  const handleDeleteDirectory = async (path: string) => {
    await invoke('shell:ignore-visit', path);
    loadDirectories();
  };

  const handleMoveDirToBlacklist = async (path: string) => {
    await invoke('shell:add-directory-blacklist', path);
    await invoke('shell:ignore-visit', path);
    loadDirectories();
    loadBlacklists();
  };

  const handleAddDirBlacklist = async () => {
    if (newDirBlPattern.trim()) {
      await invoke('shell:add-directory-blacklist', newDirBlPattern.trim());
      setNewDirBlPattern('');
      loadBlacklists();
    }
  };

  const handleUpdateDirBlacklist = async (id: number) => {
    if (editDirBlValue.trim()) {
      await invoke('shell:update-directory-blacklist', id, editDirBlValue.trim());
      setEditingDirBl(null);
      loadBlacklists();
    }
  };

  const handleRemoveDirBlacklist = async (id: number) => {
    await invoke('shell:remove-directory-blacklist', id);
    loadBlacklists();
  };

  // Cleanup
  const handleCleanup = async () => {
    const cmdDeleted = await invoke('shell:cleanup-commands', minScore);
    const dirDeleted = await invoke('shell:cleanup-directories', minScore);
    loadCommands();
    loadDirectories();
    alert(`Cleaned up ${cmdDeleted} commands and ${dirDeleted} directories.`);
  };

  const filteredCommands = commands.filter(c => 
    c.command.toLowerCase().includes(cmdSearch.toLowerCase())
  );

  const filteredDirectories = directories.filter(d => 
    d.path.toLowerCase().includes(dirSearch.toLowerCase())
  );

  // Pagination helpers
  const paginate = <T,>(items: T[], page: number) => items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = (total: number) => Math.ceil(total / PAGE_SIZE);

  const pagedCommands = paginate(filteredCommands, cmdPage);
  const pagedCmdBlacklist = paginate(cmdBlacklist, cmdBlPage);
  const pagedDirectories = paginate(filteredDirectories, dirPage);
  const pagedDirBlacklist = paginate(dirBlacklist, dirBlPage);

  // Reset page when search changes
  useEffect(() => { setCmdPage(0); }, [cmdSearch]);
  useEffect(() => { setDirPage(0); }, [dirSearch]);

  const currentModelLabel = allModels.find(m => m.value === aiModel)?.label || 'Select Model...';

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold text-text-main">Terminal Settings</h2>
      
      {/* Tabs */}
      <div className="flex gap-1 border-b border-border pb-2">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={clsx(
              "flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-t-lg transition-colors",
              activeTab === tab.id
                ? "bg-primary/20 text-primary border-b-2 border-primary"
                : "text-text-muted hover:text-text-main hover:bg-surface-light"
            )}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* General Tab */}
      {activeTab === 'general' && (
        <div className="space-y-4">
          <div className="relative">
            <label className="block text-sm font-medium text-text-main mb-2">Font Family</label>
            <div className="relative">
              <input
                type="text"
                value={fontFamily}
                onChange={(e) => setFontFamily(e.target.value)}
                onFocus={() => setFontDropdownOpen(true)}
                onBlur={() => {
                  setTimeout(() => setFontDropdownOpen(false), 150);
                  saveSettings();
                }}
                className="w-full bg-surface text-text-main text-sm rounded-lg py-2 px-3 pr-8 border border-border focus:border-primary outline-none"
                placeholder="Enter or select font..."
              />
              <ChevronDown 
                size={14} 
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" 
              />
            </div>
            {fontDropdownOpen && (() => {
              const isExactMatch = FONT_OPTIONS.some(f => f.value === fontFamily);
              const filtered = isExactMatch 
                ? FONT_OPTIONS 
                : FONT_OPTIONS.filter(f => 
                    f.label.toLowerCase().includes(fontFamily.toLowerCase()) || 
                    f.value.toLowerCase().includes(fontFamily.toLowerCase())
                  );
              return (
                <div className="absolute z-50 mt-1 w-full max-h-60 overflow-y-auto bg-surface border border-border rounded-lg shadow-lg">
                  {filtered.map(font => (
                    <button
                      key={font.value}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setFontFamily(font.value);
                        setFontDropdownOpen(false);
                        saveSettings({ fontFamily: font.value });
                      }}
                      className={clsx(
                        "w-full text-left px-3 py-2 text-sm hover:bg-primary/20 transition-colors",
                        fontFamily === font.value ? "bg-primary/10 text-primary" : "text-text-main"
                      )}
                    >
                      <span className="font-medium">{font.label}</span>
                      {font.label !== font.value && (
                        <span className="text-text-muted text-xs ml-2 truncate">{font.value}</span>
                      )}
                    </button>
                  ))}
                  {filtered.length === 0 && (
                    <div className="px-3 py-2 text-sm text-text-muted">Custom: {fontFamily}</div>
                  )}
                </div>
              );
            })()}
          </div>
          
          <div>
            <label className="block text-sm font-medium text-text-main mb-2">Font Size</label>
            <input
              type="number"
              min={10}
              max={24}
              value={fontSize}
              onChange={(e) => setFontSize(Number(e.target.value))}
              onBlur={() => saveSettings()}
              className="w-32 bg-surface text-text-main text-sm rounded-lg py-2 px-3 border border-border focus:border-primary outline-none"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-text-main mb-2">
              Command AI Model
              <span className="text-text-muted text-xs ml-2">(optional)</span>
            </label>
            <div className="relative max-w-md">
              <button className="w-full flex items-center gap-2 text-sm font-medium text-text-main bg-surface border border-border rounded-lg py-2 px-3 hover:border-primary transition-colors">
                <Bot size={16} className="shrink-0 text-text-muted" />
                <span className={clsx("flex-1 text-left truncate", !aiModel && "text-text-muted")}>
                  {currentModelLabel}
                </span>
                <ChevronDown size={14} className="opacity-50 shrink-0" />
              </button>
              <select
                value={aiModel}
                onChange={(e) => { setAiModel(e.target.value); saveSettings({ aiModel: e.target.value }); }}
                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
              >
                <option value="">None</option>
                {allModels.map(m => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="border-t border-border pt-4 mt-4">
            <h3 className="text-sm font-medium text-text-main mb-3">Auto Cleanup</h3>
            <div className="flex items-end gap-4 mb-3">
              <div>
                <label className="block text-xs text-text-muted mb-1">Min Score Threshold</label>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={minScore}
                  onChange={(e) => setMinScore(Number(e.target.value))}
                  onBlur={() => saveSettings()}
                  className="w-20 bg-surface text-text-main text-sm rounded-lg py-2 px-3 border border-border focus:border-primary outline-none"
                />
              </div>
              <button
                onClick={handleCleanup}
                className="px-4 py-2 text-sm bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded-lg transition-colors"
              >
                Cleanup Now
              </button>
            </div>
            <p className="text-xs text-text-muted leading-relaxed">
              Removes commands and directories with usage count ≤ the threshold value.<br />
              Favorite commands are preserved regardless of score.<br />
              This action cannot be undone.
            </p>
          </div>
        </div>
      )}

      {/* Commands Tab */}
      {activeTab === 'commands' && (
        <div className="space-y-4">
          {/* History */}
          <div>
            <h3 className="text-sm font-medium text-text-main mb-2">History</h3>
            <div className="relative mb-2">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                type="text"
                value={cmdSearch}
                onChange={(e) => setCmdSearch(e.target.value)}
                className="w-full bg-surface text-text-main text-sm rounded-lg py-2 pl-10 pr-3 border border-border focus:border-primary outline-none"
                placeholder="Search commands..."
              />
            </div>
            
            <div className="space-y-1">
              {filteredCommands.length === 0 ? (
                <div className="text-center py-4 text-text-muted text-sm">No commands</div>
              ) : (
                pagedCommands.map(cmd => (
                  <div 
                    key={cmd.id}
                    className="group flex items-center gap-2 px-3 py-1.5 bg-surface rounded-lg border border-border hover:border-primary/50 transition-colors"
                  >
                    {editingCmd === cmd.id ? (
                      <>
                        <input
                          type="text"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          className="flex-1 bg-background text-text-main text-sm font-mono rounded py-1 px-2 border border-primary outline-none"
                          autoFocus
                        />
                        <button onClick={() => handleUpdateCommand(cmd.id)} className="p-1 text-green-400 hover:bg-green-500/20 rounded">
                          <Save size={14} />
                        </button>
                        <button onClick={() => setEditingCmd(null)} className="p-1 text-text-muted hover:bg-surface-light rounded">
                          <X size={14} />
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="flex-1 text-sm font-mono text-text-main truncate">{cmd.command}</span>
                        <span className="text-xs text-text-muted">×{cmd.score}</span>
                        <button
                          onClick={() => handleToggleFavorite(cmd.id)}
                          className={clsx("p-1 rounded transition-colors", cmd.is_favorite ? "text-yellow-400" : "text-text-muted opacity-0 group-hover:opacity-100 hover:text-yellow-400")}
                        >
                          {cmd.is_favorite ? <Star size={14} /> : <StarOff size={14} />}
                        </button>
                        <button onClick={() => { setEditingCmd(cmd.id); setEditValue(cmd.command); }} className="p-1 text-text-muted opacity-0 group-hover:opacity-100 hover:text-primary rounded">
                          <Edit2 size={14} />
                        </button>
                        <button onClick={() => handleMoveToBlacklist(cmd.command)} className="p-1 text-text-muted opacity-0 group-hover:opacity-100 hover:text-orange-400 rounded" title="Move to blacklist">
                          <ArrowDown size={14} />
                        </button>
                        <button onClick={() => handleDeleteCommand(cmd.command)} className="p-1 text-text-muted opacity-0 group-hover:opacity-100 hover:text-red-400 rounded">
                          <Trash2 size={14} />
                        </button>
                      </>
                    )}
                  </div>
                ))
              )}
            </div>
            {/* Pagination */}
            {totalPages(filteredCommands.length) > 1 && (
              <div className="flex items-center justify-center gap-2 mt-2">
                <button
                  onClick={() => setCmdPage(p => Math.max(0, p - 1))}
                  disabled={cmdPage === 0}
                  className="p-1 rounded hover:bg-surface-light disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="text-xs text-text-muted">
                  {cmdPage + 1} / {totalPages(filteredCommands.length)}
                </span>
                <button
                  onClick={() => setCmdPage(p => Math.min(totalPages(filteredCommands.length) - 1, p + 1))}
                  disabled={cmdPage >= totalPages(filteredCommands.length) - 1}
                  className="p-1 rounded hover:bg-surface-light disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            )}
          </div>

          {/* Blacklist */}
          <div className="border-t border-border pt-4">
            <h3 className="text-sm font-medium text-text-main mb-2 flex items-center gap-2">
              <Shield size={14} className="text-orange-400" />
              Blacklist (regex patterns)
            </h3>
            <div className="flex gap-2 mb-2">
              <input
                type="text"
                value={newCmdBlPattern}
                onChange={(e) => setNewCmdBlPattern(e.target.value)}
                className="flex-1 bg-surface text-text-main text-sm font-mono rounded-lg py-1.5 px-3 border border-border focus:border-primary outline-none"
                placeholder="git commit -am(.*)"
              />
              <button onClick={handleAddCmdBlacklist} className="px-3 py-1.5 bg-primary text-white text-sm rounded-lg hover:opacity-90">
                <Plus size={14} />
              </button>
            </div>
            <div className="space-y-1">
              {pagedCmdBlacklist.map(bl => (
                <div key={bl.id} className="group flex items-center gap-2 px-3 py-1.5 bg-orange-500/10 rounded-lg border border-orange-500/30">
                  {editingCmdBl === bl.id ? (
                    <>
                      <input
                        type="text"
                        value={editCmdBlValue}
                        onChange={(e) => setEditCmdBlValue(e.target.value)}
                        className="flex-1 bg-background text-text-main text-sm font-mono rounded py-1 px-2 border border-primary outline-none"
                        autoFocus
                      />
                      <button onClick={() => handleUpdateCmdBlacklist(bl.id)} className="p-1 text-green-400 hover:bg-green-500/20 rounded">
                        <Save size={14} />
                      </button>
                      <button onClick={() => setEditingCmdBl(null)} className="p-1 text-text-muted hover:bg-surface-light rounded">
                        <X size={14} />
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="flex-1 text-sm font-mono text-orange-300 truncate">{bl.pattern}</span>
                      <button onClick={() => { setEditingCmdBl(bl.id); setEditCmdBlValue(bl.pattern); }} className="p-1 text-text-muted opacity-0 group-hover:opacity-100 hover:text-primary rounded">
                        <Edit2 size={14} />
                      </button>
                      <button onClick={() => handleRemoveCmdBlacklist(bl.id)} className="p-1 text-text-muted opacity-0 group-hover:opacity-100 hover:text-red-400 rounded">
                        <Trash2 size={14} />
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
            {totalPages(cmdBlacklist.length) > 1 && (
              <div className="flex items-center justify-center gap-2 mt-2">
                <button onClick={() => setCmdBlPage(p => Math.max(0, p - 1))} disabled={cmdBlPage === 0} className="p-1 rounded hover:bg-surface-light disabled:opacity-30 disabled:cursor-not-allowed">
                  <ChevronLeft size={16} />
                </button>
                <span className="text-xs text-text-muted">{cmdBlPage + 1} / {totalPages(cmdBlacklist.length)}</span>
                <button onClick={() => setCmdBlPage(p => Math.min(totalPages(cmdBlacklist.length) - 1, p + 1))} disabled={cmdBlPage >= totalPages(cmdBlacklist.length) - 1} className="p-1 rounded hover:bg-surface-light disabled:opacity-30 disabled:cursor-not-allowed">
                  <ChevronRight size={16} />
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Directories Tab */}
      {activeTab === 'directories' && (
        <div className="space-y-4">
          {/* History */}
          <div>
            <h3 className="text-sm font-medium text-text-main mb-2">History</h3>
            <div className="relative mb-2">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                type="text"
                value={dirSearch}
                onChange={(e) => setDirSearch(e.target.value)}
                className="w-full bg-surface text-text-main text-sm rounded-lg py-2 pl-10 pr-3 border border-border focus:border-primary outline-none"
                placeholder="Search directories..."
              />
            </div>
            
            <div className="space-y-1">
              {filteredDirectories.length === 0 ? (
                <div className="text-center py-4 text-text-muted text-sm">No directories</div>
              ) : (
                pagedDirectories.map(dir => (
                  <div 
                    key={dir.path}
                    className="group flex items-center gap-2 px-3 py-1.5 bg-surface rounded-lg border border-border hover:border-primary/50 transition-colors"
                  >
                    <FolderOpen size={14} className="text-blue-400 shrink-0" />
                    <span className="flex-1 text-sm font-mono text-text-main truncate">{dir.path}</span>
                    <span className="text-xs text-text-muted">×{dir.score}</span>
                    <button onClick={() => handleMoveDirToBlacklist(dir.path)} className="p-1 text-text-muted opacity-0 group-hover:opacity-100 hover:text-orange-400 rounded" title="Move to blacklist">
                      <ArrowDown size={14} />
                    </button>
                    <button onClick={() => handleDeleteDirectory(dir.path)} className="p-1 text-text-muted opacity-0 group-hover:opacity-100 hover:text-red-400 rounded">
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))
              )}
            </div>
            {totalPages(filteredDirectories.length) > 1 && (
              <div className="flex items-center justify-center gap-2 mt-2">
                <button onClick={() => setDirPage(p => Math.max(0, p - 1))} disabled={dirPage === 0} className="p-1 rounded hover:bg-surface-light disabled:opacity-30 disabled:cursor-not-allowed">
                  <ChevronLeft size={16} />
                </button>
                <span className="text-xs text-text-muted">{dirPage + 1} / {totalPages(filteredDirectories.length)}</span>
                <button onClick={() => setDirPage(p => Math.min(totalPages(filteredDirectories.length) - 1, p + 1))} disabled={dirPage >= totalPages(filteredDirectories.length) - 1} className="p-1 rounded hover:bg-surface-light disabled:opacity-30 disabled:cursor-not-allowed">
                  <ChevronRight size={16} />
                </button>
              </div>
            )}
          </div>

          {/* Blacklist */}
          <div className="border-t border-border pt-4">
            <h3 className="text-sm font-medium text-text-main mb-2 flex items-center gap-2">
              <Shield size={14} className="text-orange-400" />
              Blacklist (regex patterns)
            </h3>
            <div className="flex gap-2 mb-2">
              <input
                type="text"
                value={newDirBlPattern}
                onChange={(e) => setNewDirBlPattern(e.target.value)}
                className="flex-1 bg-surface text-text-main text-sm font-mono rounded-lg py-1.5 px-3 border border-border focus:border-primary outline-none"
                placeholder="/home/user/\.ssh"
              />
              <button onClick={handleAddDirBlacklist} className="px-3 py-1.5 bg-primary text-white text-sm rounded-lg hover:opacity-90">
                <Plus size={14} />
              </button>
            </div>
            <div className="space-y-1">
              {pagedDirBlacklist.map(bl => (
                <div key={bl.id} className="group flex items-center gap-2 px-3 py-1.5 bg-orange-500/10 rounded-lg border border-orange-500/30">
                  {editingDirBl === bl.id ? (
                    <>
                      <input
                        type="text"
                        value={editDirBlValue}
                        onChange={(e) => setEditDirBlValue(e.target.value)}
                        className="flex-1 bg-background text-text-main text-sm font-mono rounded py-1 px-2 border border-primary outline-none"
                        autoFocus
                      />
                      <button onClick={() => handleUpdateDirBlacklist(bl.id)} className="p-1 text-green-400 hover:bg-green-500/20 rounded">
                        <Save size={14} />
                      </button>
                      <button onClick={() => setEditingDirBl(null)} className="p-1 text-text-muted hover:bg-surface-light rounded">
                        <X size={14} />
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="flex-1 text-sm font-mono text-orange-300 truncate">{bl.pattern}</span>
                      <button onClick={() => { setEditingDirBl(bl.id); setEditDirBlValue(bl.pattern); }} className="p-1 text-text-muted opacity-0 group-hover:opacity-100 hover:text-primary rounded">
                        <Edit2 size={14} />
                      </button>
                      <button onClick={() => handleRemoveDirBlacklist(bl.id)} className="p-1 text-text-muted opacity-0 group-hover:opacity-100 hover:text-red-400 rounded">
                        <Trash2 size={14} />
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
            {totalPages(dirBlacklist.length) > 1 && (
              <div className="flex items-center justify-center gap-2 mt-2">
                <button onClick={() => setDirBlPage(p => Math.max(0, p - 1))} disabled={dirBlPage === 0} className="p-1 rounded hover:bg-surface-light disabled:opacity-30 disabled:cursor-not-allowed">
                  <ChevronLeft size={16} />
                </button>
                <span className="text-xs text-text-muted">{dirBlPage + 1} / {totalPages(dirBlacklist.length)}</span>
                <button onClick={() => setDirBlPage(p => Math.min(totalPages(dirBlacklist.length) - 1, p + 1))} disabled={dirBlPage >= totalPages(dirBlacklist.length) - 1} className="p-1 rounded hover:bg-surface-light disabled:opacity-30 disabled:cursor-not-allowed">
                  <ChevronRight size={16} />
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
