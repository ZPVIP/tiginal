import React, { useState, useEffect, useMemo } from 'react';
import { clsx } from 'clsx';
import { Settings, Terminal, FolderOpen, Trash2, Star, StarOff, Search, Edit2, Save, X, Bot, ChevronDown, ArrowDown, Plus, Shield, ChevronLeft, ChevronRight, Clock } from 'lucide-react';
import { InfoIcon } from '../Shared/InfoIcon';

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
  { id: 'history', label: 'History', icon: <Clock size={14} /> },
];

const FONT_OPTIONS = [
  { value: 'monospace', label: 'System Monospace' },
  { value: '"Anonymous Pro", monospace', label: 'Anonymous Pro' },
  { value: '"Cascadia Code", monospace', label: 'Cascadia Code' },
  { value: '"Consolas", monospace', label: 'Consolas' },
  { value: '"Fira Code", monospace', label: 'Fira Code' },
  { value: '"Fira Code Nerd Font", monospace', label: 'Fira Code Nerd Font' },
  { value: '"Hack", monospace', label: 'Hack' },
  { value: '"Hack Nerd Font", monospace', label: 'Hack Nerd Font' },
  { value: '"IBM Plex Mono", monospace', label: 'IBM Plex Mono' },
  { value: '"Inconsolata", monospace', label: 'Inconsolata' },
  { value: '"JetBrains Mono", monospace', label: 'JetBrains Mono' },
  { value: '"Menlo", monospace', label: 'Menlo' },
  { value: '"MesloLGS NF", monospace', label: 'MesloLGS NF' },
  { value: '"Monaco", monospace', label: 'Monaco' },
  { value: '"Roboto Mono", monospace', label: 'Roboto Mono' },
  { value: '"SF Mono", monospace', label: 'SF Mono' },
  { value: '"Source Code Pro", monospace', label: 'Source Code Pro' },
  { value: '"Ubuntu Mono", monospace', label: 'Ubuntu Mono' },
];

export function TerminalSettings() {
  const [activeTab, setActiveTab] = useState('general');
  
  // General settings
  const [fontFamily, setFontFamily] = useState('monospace');
  const [fontDropdownOpen, setFontDropdownOpen] = useState(false);
  const [fontSize, setFontSize] = useState(14);
  const [aiModel, setAiModel] = useState('');
  const [aiDropdownOpen, setAiDropdownOpen] = useState(false);
  const [cleanupInterval, setCleanupInterval] = useState(24);
  const [minScore, setMinScore] = useState(2);
  const [historyMaxCount, setHistoryMaxCount] = useState(10000);
  const [dateFormat, setDateFormat] = useState('toLocaleString');
  
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

  // History
  const [history, setHistory] = useState<{ id: number; command: string; executed_at: number }[]>([]);
  const [historyPage, setHistoryPage] = useState(0);
  const [historyBlacklist, setHistoryBlacklist] = useState<BlacklistRow[]>([]);
  const [historyBlPage, setHistoryBlPage] = useState(0);
  const [editingHistBl, setEditingHistBl] = useState<number | null>(null);
  const [editHistBlValue, setEditHistBlValue] = useState('');
  const [newHistBlPattern, setNewHistBlPattern] = useState('');
  const [historySearch, setHistorySearch] = useState('');

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

  // Load history when switching to history tab
  useEffect(() => {
    if (activeTab === 'history') {
      loadHistory();
      loadHistoryBlacklist();
    }
  }, [activeTab]);

  const loadSettings = async () => {
    const settings = await invoke('settings:get', 'terminal');
    if (settings) {
      const parsed = JSON.parse(settings);
      setFontFamily(parsed.fontFamily || 'monospace');
      setFontSize(parsed.fontSize || 14);
      setAiModel(parsed.aiModel || '');
      setCleanupInterval(parsed.cleanupInterval || 24);
      setMinScore(parsed.minScore || 2);
      setHistoryMaxCount(parsed.historyMaxCount || 10000);
    }
    
    // Load global date format
    try {
      const globalDateFormat = await invoke('settings:get', 'dateFormat');
      if (globalDateFormat) {
        setDateFormat(globalDateFormat);
      }
    } catch (err) {
      console.warn('Failed to load global date format', err);
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
      historyMaxCount,
      dateFormat,
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

  const loadHistory = async () => {
    const hist = await invoke('shell:get-all-history');
    setHistory(hist || []);
  };

  const loadHistoryBlacklist = async () => {
    const bl = await invoke('shell:get-history-blacklist');
    setHistoryBlacklist(bl || []);
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

  // History handlers
  const handleDeleteHistory = async (id: number) => {
    await invoke('shell:delete-history', id);
    loadHistory();
  };

  const handleClearAllHistory = async () => {
    if (confirm('Are you sure you want to clear all command history?')) {
      await invoke('shell:clear-all-history');
      loadHistory();
    }
  };

  const handleAddHistoryBlacklist = async () => {
    if (newHistBlPattern.trim()) {
      await invoke('shell:add-history-blacklist', newHistBlPattern.trim());
      setNewHistBlPattern('');
      loadHistoryBlacklist();
    }
  };

  const handleUpdateHistoryBlacklist = async (id: number) => {
    if (editHistBlValue.trim()) {
      await invoke('shell:update-history-blacklist', id, editHistBlValue.trim());
      setEditingHistBl(null);
      loadHistoryBlacklist();
    }
  };

  const handleRemoveHistoryBlacklist = async (id: number) => {
    await invoke('shell:remove-history-blacklist', id);
    loadHistoryBlacklist();
  };

  const handleHistoryMaxCountChange = (val: number) => {
    const clamped = Math.max(100, Math.min(50000, val));
    setHistoryMaxCount(clamped);
  };

  const handleTrimHistory = async () => {
    await invoke('shell:trim-history', historyMaxCount);
    loadHistory();
  };

  const filteredCommands = commands.filter(c => 
    c.command.toLowerCase().includes(cmdSearch.toLowerCase())
  );

  const filteredDirectories = directories.filter(d => 
    d.path.toLowerCase().includes(dirSearch.toLowerCase())
  );

  const filteredHistory = history.filter(h => 
    h.command.toLowerCase().includes(historySearch.toLowerCase())
  );

  // Pagination helpers
  const paginate = <T,>(items: T[], page: number) => items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = (total: number) => Math.ceil(total / PAGE_SIZE);

  const pagedCommands = paginate(filteredCommands, cmdPage);
  const pagedCmdBlacklist = paginate(cmdBlacklist, cmdBlPage);
  const pagedDirectories = paginate(filteredDirectories, dirPage);
  const pagedDirBlacklist = paginate(dirBlacklist, dirBlPage);
  const pagedHistory = paginate(filteredHistory, historyPage);
  const pagedHistoryBlacklist = paginate(historyBlacklist, historyBlPage);

  // Reset page when search changes
  useEffect(() => { setCmdPage(0); }, [cmdSearch]);
  useEffect(() => { setDirPage(0); }, [dirSearch]);
  useEffect(() => { setHistoryPage(0); }, [historySearch]);

  const currentModelLabel = allModels.find(m => m.value === aiModel)?.label || 'Select Model...';

  const formatTime = (ts: number) => {
    const date = new Date(ts);
    switch (dateFormat) {
      case 'iso': return date.toISOString().replace('T', ' ').substring(0, 16);
      case 'us': return date.toLocaleString('en-US'); 
      case 'uk': return date.toLocaleString('en-GB');
      case 'de': return date.toLocaleString('de-DE');
      case 'cn': return date.toLocaleString('zh-CN', { hour12: false });
      default: return date.toLocaleString();
    }
  };

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold text-text-main">Terminal Settings</h2>
      
      {/* Tabs */}
      <div className="flex space-x-1 bg-surface border border-border p-1 rounded-lg shrink-0">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={clsx(
              "flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-all",
              activeTab === tab.id
                ? "bg-primary text-white shadow-sm"
                : "text-text-sec hover:text-text-main hover:bg-surface-light"
            )}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* General Tab */}
      {/* General Tab */}
      {/* General Tab */}
      {activeTab === 'general' && (
        <div className="space-y-4">
          
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-text-main">Font Size</label>
            <input
              type="number"
              min={10}
              max={24}
              value={fontSize}
              onChange={(e) => setFontSize(Number(e.target.value))}
              onBlur={() => saveSettings()}
              className="w-32 bg-surface text-text-main text-sm rounded-lg py-2 px-3 border border-border focus:border-primary outline-none text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
          </div>

          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-text-main">Font Family</label>
            <div className="relative w-[60%]">
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
          </div>
          
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-text-main">
              Command AI Model
              <span className="text-text-muted text-xs ml-2">(optional)</span>
            </label>
            <div className="relative w-[60%]">
              <div
                tabIndex={0}
                onClick={() => setAiDropdownOpen(!aiDropdownOpen)}
                onBlur={() => setTimeout(() => setAiDropdownOpen(false), 150)}
                className={clsx(
                  "w-full bg-surface text-text-main text-sm rounded-lg py-2 px-3 pr-8 border border-border focus:border-primary outline-none cursor-pointer flex items-center",
                  aiDropdownOpen && "border-primary"
                )}
              >
                 <Bot size={16} className="shrink-0 text-text-muted mr-2" />
                 <span className={clsx("flex-1 truncate", !aiModel && "text-text-muted")}>
                   {currentModelLabel}
                 </span>
                 <ChevronDown 
                  size={14} 
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" 
                />
              </div>

              {aiDropdownOpen && (
                <div className="absolute z-50 mt-1 w-full max-h-60 overflow-y-auto bg-surface border border-border rounded-lg shadow-lg">
                   <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setAiModel('');
                        setAiDropdownOpen(false);
                        saveSettings({ aiModel: '' });
                      }}
                      className={clsx(
                        "w-full text-left px-3 py-2 text-sm hover:bg-primary/20 transition-colors",
                        aiModel === '' ? "bg-primary/10 text-primary" : "text-text-main"
                      )}
                    >
                      <span className="font-medium">None</span>
                    </button>
                  {allModels.map(m => (
                    <button
                      key={m.value}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setAiModel(m.value);
                        setAiDropdownOpen(false);
                        saveSettings({ aiModel: m.value });
                      }}
                      className={clsx(
                        "w-full text-left px-3 py-2 text-sm hover:bg-primary/20 transition-colors",
                        aiModel === m.value ? "bg-primary/10 text-primary" : "text-text-main"
                      )}
                    >
                      <span className="font-medium">{m.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <label className="flex items-center text-sm font-medium text-text-main">
              History Max Count
              <InfoIcon title="History Max Count (100 - 50000)" />
            </label>
            <div className="flex items-center gap-2">
              <button
                onClick={handleTrimHistory}
                className="w-28 px-3 py-2 text-sm bg-orange-500/20 text-orange-400 hover:bg-orange-500/30 rounded-lg transition-colors text-center"
              >
                Trim Now
              </button>
              <input
                type="number"
                min={100}
                max={50000}
                value={historyMaxCount}
                onChange={(e) => handleHistoryMaxCountChange(Number(e.target.value))}
                onBlur={() => saveSettings()}
                className="w-32 bg-surface text-text-main text-sm rounded-lg py-2 px-3 border border-border focus:border-primary outline-none text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>
          </div>

          <div>
             <div className="flex items-center justify-between">
               <label className="flex items-center text-sm font-medium text-text-main">
                  Auto Cleanup
                  <InfoIcon title="Removes commands and directories with usage count ≤ the threshold value. Favorite commands are preserved regardless of score." />
               </label>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCleanup}
                  className="w-28 px-3 py-2 text-sm bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded-lg transition-colors text-center"
                >
                  Cleanup Now
                </button>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={minScore}
                  onChange={(e) => setMinScore(Number(e.target.value))}
                  onBlur={() => saveSettings()}
                  className="w-32 bg-surface text-text-main text-sm rounded-lg py-2 px-3 border border-border focus:border-primary outline-none text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
              </div>
            </div>
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
              Blacklist (^pattern$)
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
              Blacklist (^pattern$)
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

      {/* History Tab */}
      {activeTab === 'history' && (
        <div className="space-y-4">
          {/* History List */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-text-main flex items-center gap-2">
                <Clock size={14} className="text-primary" />
                Command History ({history.length})
              </h3>
              <button
                onClick={handleClearAllHistory}
                className="px-3 py-1.5 text-sm bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded-lg transition-colors"
              >
                Clear All
              </button>
            </div>
            
            <div className="relative mb-2">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                type="text"
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
                className="w-full bg-surface text-text-main text-sm rounded-lg py-2 pl-10 pr-3 border border-border focus:border-primary outline-none"
                placeholder="Search history..."
              />
            </div>

            <div className="space-y-1">
              {filteredHistory.length === 0 ? (
                <div className="text-center py-4 text-text-muted text-sm">No history found</div>
              ) : (
                pagedHistory.map(h => (
                  <div key={h.id} className="group relative flex items-center px-3 py-1.5 bg-surface rounded-lg border border-border hover:border-primary/50 transition-colors overflow-hidden">
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-text-muted/40 pointer-events-none select-none z-0 group-hover:text-text-muted/60 transition-colors font-mono">
                      {formatTime(h.executed_at)}
                    </span>
                    <div className="relative z-10 flex-1 min-w-0 mr-2">
                        <span className="block text-sm font-mono text-text-main truncate" title={h.command}>{h.command}</span>
                    </div>
                    <div className="relative z-20 flex items-center">
                      <button
                        onClick={async () => {
                            await invoke('shell:add-history-blacklist', h.command);
                            const bl = await invoke<any[]>('shell:get-history-blacklist');
                            setHistoryBlacklist(bl);
                        }}
                        className="p-1.5 text-text-muted opacity-0 group-hover:opacity-100 hover:bg-surface-hover hover:text-text-main rounded transition-all"
                        title="Add to history blacklist"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 5v14"/>
                          <path d="m19 12-7 7-7-7"/>
                        </svg>
                      </button>
                      <button
                        onClick={() => handleDeleteHistory(h.id)}
                        className="p-1.5 text-text-muted opacity-0 group-hover:opacity-100 hover:bg-red-500/20 hover:text-red-400 rounded transition-all"
                        title="Delete"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
            
            {totalPages(filteredHistory.length) > 1 && (
              <div className="flex items-center justify-center gap-2 mt-2">
                <button onClick={() => setHistoryPage(p => Math.max(0, p - 1))} disabled={historyPage === 0} className="p-1 rounded hover:bg-surface-light disabled:opacity-30 disabled:cursor-not-allowed">
                  <ChevronLeft size={16} />
                </button>
                <span className="text-xs text-text-muted">{historyPage + 1} / {totalPages(filteredHistory.length)}</span>
                <button onClick={() => setHistoryPage(p => Math.min(totalPages(filteredHistory.length) - 1, p + 1))} disabled={historyPage >= totalPages(filteredHistory.length) - 1} className="p-1 rounded hover:bg-surface-light disabled:opacity-30 disabled:cursor-not-allowed">
                  <ChevronRight size={16} />
                </button>
              </div>
            )}
          </div>

          {/* History Blacklist */}
          <div className="border-t border-border pt-4">
            <h3 className="text-sm font-medium text-text-main mb-2 flex items-center gap-2">
              <Shield size={14} className="text-orange-400" />
              Blacklist (^pattern$)
            </h3>
            <div className="flex gap-2 mb-2">
              <input
                type="text"
                value={newHistBlPattern}
                onChange={(e) => setNewHistBlPattern(e.target.value)}
                className="flex-1 bg-surface text-text-main text-sm font-mono rounded-lg py-1.5 px-3 border border-border focus:border-primary outline-none"
                placeholder="ls"
              />
              <button onClick={handleAddHistoryBlacklist} className="px-3 py-1.5 bg-primary text-white text-sm rounded-lg hover:opacity-90">
                <Plus size={14} />
              </button>
            </div>
            <div className="space-y-1">
              {pagedHistoryBlacklist.map(bl => (
                <div key={bl.id} className="group flex items-center gap-2 px-3 py-1.5 bg-orange-500/10 rounded-lg border border-orange-500/30">
                  {editingHistBl === bl.id ? (
                    <>
                      <input
                        type="text"
                        value={editHistBlValue}
                        onChange={(e) => setEditHistBlValue(e.target.value)}
                        className="flex-1 bg-background text-text-main text-sm font-mono rounded py-1 px-2 border border-primary outline-none"
                        autoFocus
                      />
                      <button onClick={() => handleUpdateHistoryBlacklist(bl.id)} className="p-1 text-green-400 hover:bg-green-500/20 rounded">
                        <Save size={14} />
                      </button>
                      <button onClick={() => setEditingHistBl(null)} className="p-1 text-text-muted hover:bg-surface-light rounded">
                        <X size={14} />
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="flex-1 text-sm font-mono text-orange-300 truncate">{bl.pattern}</span>
                      <button onClick={() => { setEditingHistBl(bl.id); setEditHistBlValue(bl.pattern); }} className="p-1 text-text-muted opacity-0 group-hover:opacity-100 hover:text-primary rounded">
                        <Edit2 size={14} />
                      </button>
                      <button onClick={() => handleRemoveHistoryBlacklist(bl.id)} className="p-1 text-text-muted opacity-0 group-hover:opacity-100 hover:text-red-400 rounded">
                        <Trash2 size={14} />
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
            {totalPages(historyBlacklist.length) > 1 && (
              <div className="flex items-center justify-center gap-2 mt-2">
                <button onClick={() => setHistoryBlPage(p => Math.max(0, p - 1))} disabled={historyBlPage === 0} className="p-1 rounded hover:bg-surface-light disabled:opacity-30 disabled:cursor-not-allowed">
                  <ChevronLeft size={16} />
                </button>
                <span className="text-xs text-text-muted">{historyBlPage + 1} / {totalPages(historyBlacklist.length)}</span>
                <button onClick={() => setHistoryBlPage(p => Math.min(totalPages(historyBlacklist.length) - 1, p + 1))} disabled={historyBlPage >= totalPages(historyBlacklist.length) - 1} className="p-1 rounded hover:bg-surface-light disabled:opacity-30 disabled:cursor-not-allowed">
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
