import React, { useEffect, useState } from 'react';
import { Lock, Unlock, Globe, KeyRound, Calendar, ArrowUpDown, MessageSquare, FolderOpen, RotateCcw } from 'lucide-react';
import { clsx } from 'clsx';

// Interface for IPC calls
// Interface for IPC calls
const invoke = window.electron?.invoke || (async () => {}); 

// Date format options
const DATE_FORMATS = [
  { value: 'iso', label: 'ISO (YYYY-MM-DD HH:mm)', example: '2026-01-16 14:30' },
  { value: 'us', label: 'US (MM/DD/YYYY h:mm A)', example: '01/16/2026 2:30 PM' },
  { value: 'uk', label: 'UK (DD/MM/YYYY HH:mm)', example: '16/01/2026 14:30' },
  { value: 'de', label: 'German (DD.MM.YYYY HH:mm)', example: '16.01.2026 14:30' },
  { value: 'cn', label: 'Chinese (YYYY年MM月DD日 HH:mm)', example: '2026年01月16日 14:30' },
];

const SORT_OPTIONS = [
  { value: 'updatedAt', label: 'Last Updated' },
  { value: 'createdAt', label: 'Created Date' },
];

export function GeneralSettings() {
  // Crypto State
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [hasMasterPassword, setHasMasterPassword] = useState(false);
  const [hasSavedKey, setHasSavedKey] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [isLoadingCrypto, setIsLoadingCrypto] = useState(false);

  // Search State
  const [searchProvider, setSearchProvider] = useState('duckduckgo');
  
  // Date/Sort State
  const [dateFormat, setDateFormat] = useState('iso');
  const [historySort, setHistorySort] = useState('updatedAt');
  
  // System Prompt State
  const [systemPrompt, setSystemPrompt] = useState('');
  const [promptSaveStatus, setPromptSaveStatus] = useState<'saved' | 'saving' | 'idle'>('idle');
  
  // Workspace State
  const [workspacePath, setWorkspacePath] = useState('');
  
  // Reset prompt confirmation modal
  const [showResetModal, setShowResetModal] = useState(false);
  
  useEffect(() => {
    loadStatus();
  }, []);

  const loadStatus = async () => {
    try {
      const unlocked = await invoke('crypto:is-unlocked');
      const hasPwd = await invoke('crypto:has-master-password');
      const hasKey = await invoke('crypto:has-saved-key');
      
      // Load settings from database
      const savedDateFormat = await invoke('settings:get', 'dateFormat');
      const savedHistorySort = await invoke('settings:get', 'historySort');
      const savedSearchProvider = await invoke('settings:get', 'searchProvider');
      const savedSystemPrompt = await invoke('settings:get', 'systemPrompt');
      const savedWorkspace = await invoke('workspace:get-path');

      setIsUnlocked(unlocked);
      setHasMasterPassword(hasPwd);
      setHasSavedKey(hasKey);
      
      if (savedDateFormat) setDateFormat(savedDateFormat);
      if (savedHistorySort) setHistorySort(savedHistorySort);
      if (savedSearchProvider) setSearchProvider(savedSearchProvider);
      if (savedSystemPrompt) setSystemPrompt(savedSystemPrompt);
      if (savedWorkspace) setWorkspacePath(savedWorkspace);
    } catch (err) {
      console.error("Failed to load settings status", err);
    }
  };

  const handleUnlock = async () => {
    setIsLoadingCrypto(true);
    try {
      const res = await invoke('crypto:unlock', passwordInput);
      if (res.success) {
        setIsUnlocked(true);
        setPasswordInput('');
      } else {
        alert('Failed to unlock: ' + res.error);
      }
    } finally {
      setIsLoadingCrypto(false);
    }
  };

  const handleSetPassword = async () => {
    handleUnlock(); 
  };

  const handleLock = async () => {
    await invoke('crypto:lock');
    setIsUnlocked(false);
  };

  const handleSearchChange = async (val: string) => {
    setSearchProvider(val);
    await invoke('settings:set', 'searchProvider', val);
  };

  const handleDateFormatChange = async (val: string) => {
    setDateFormat(val);
    await invoke('settings:set', 'dateFormat', val);
  };

  const handleHistorySortChange = async (val: string) => {
    setHistorySort(val);
    await invoke('settings:set', 'historySort', val);
  };

  // Debounced save for system prompt
  const savePromptTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  
  const handleSystemPromptChange = (val: string) => {
    setSystemPrompt(val);
    setPromptSaveStatus('saving');
    
    if (savePromptTimeoutRef.current) {
      clearTimeout(savePromptTimeoutRef.current);
    }
    
    savePromptTimeoutRef.current = setTimeout(async () => {
      await invoke('settings:set', 'systemPrompt', val);
      setPromptSaveStatus('saved');
      setTimeout(() => setPromptSaveStatus('idle'), 1500);
    }, 500);
  };

  const handleSelectWorkspace = async () => {
    const selected = await invoke('workspace:open-dialog');
    if (selected) {
      await invoke('workspace:set-path', selected);
      setWorkspacePath(selected);
    }
  };

  const handleResetPrompt = async () => {
    try {
      const newPrompt = await invoke('settings:reset-system-prompt') as string;
      setSystemPrompt(newPrompt);
      setShowResetModal(false);
    } catch (err) {
      console.error('Failed to reset system prompt', err);
    }
  };

  const isLockedState = !isUnlocked && (hasMasterPassword || hasSavedKey);
  const isSetupState = !isUnlocked && !hasMasterPassword && !hasSavedKey;

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      
      {/* Security Settings - FIRST */}
      <section className="space-y-4">
        <h3 className="text-xl font-semibold flex items-center gap-2 text-text-main">
          <KeyRound className="w-5 h-5 text-yellow-500" />
          Security (Master Key)
        </h3>
        <p className="text-sm text-text-muted">
          Manage encryption for your API keys and sensitive data.
        </p>

        <div className="bg-surface border border-border rounded-lg p-6">
            <div className="flex items-center justify-between mb-6">
                <span className="text-sm font-medium text-text-sec">Current Status</span>
                <span className={clsx(
                    "px-2.5 py-0.5 rounded-full text-xs font-medium",
                    isUnlocked ? "bg-green-900 text-green-300" : (isSetupState ? "bg-red-900 text-red-300" : "bg-yellow-900 text-yellow-300")
                )}>
                    {isUnlocked ? "Unlocked" : (isSetupState ? "Not Configured" : "Locked")}
                </span>
            </div>

            {isUnlocked && (
                <div className="flex items-center justify-between">
                    <p className="text-sm text-text-muted">Your keys are decrypted and accessible.</p>
                    <button 
                       onClick={handleLock}
                       className="flex items-center gap-2 px-4 py-2 bg-background hover:bg-[var(--tab-hover)] border border-border rounded-lg transition-colors text-sm text-text-main"
                    >
                        <Lock size={14} /> Lock Now
                    </button>
                </div>
            )}

            {isLockedState && (
                <div className="flex items-end gap-3">
                    <div className="flex-1">
                        <label className="block mb-2 text-sm font-medium text-text-sec">Enter Master Password</label>
                        <input 
                           type="password" 
                           value={passwordInput}
                           onChange={(e) => setPasswordInput(e.target.value)}
                           onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
                           className="bg-background border border-border text-text-main text-sm rounded-lg focus:ring-primary focus:border-primary block w-full p-2.5"
                           placeholder="••••••••"
                        />
                    </div>
                    <button 
                       onClick={handleUnlock}
                       disabled={isLoadingCrypto}
                       className="px-4 py-2.5 bg-primary hover:bg-blue-600 text-white font-medium rounded-lg text-sm transition-colors flex items-center gap-2 disabled:opacity-50"
                    >
                        {isLoadingCrypto ? 'Unlocking...' : <><Unlock size={16} /> Unlock</>}
                    </button>
                </div>
            )}

            {isSetupState && (
                 <div className="flex items-end gap-3">
                    <div className="flex-1">
                        <label className="block mb-2 text-sm font-medium text-text-sec">Create Master Password</label>
                        <input 
                           type="password" 
                           value={passwordInput}
                           onChange={(e) => setPasswordInput(e.target.value)}
                           onKeyDown={(e) => e.key === 'Enter' && handleSetPassword()}
                           className="bg-background border border-border text-text-main text-sm rounded-lg focus:ring-primary focus:border-primary block w-full p-2.5"
                           placeholder="Minimum 8 characters..."
                        />
                    </div>
                    <button 
                       onClick={handleSetPassword}
                       disabled={isLoadingCrypto}
                       className="px-4 py-2.5 bg-primary hover:bg-blue-600 text-white font-medium rounded-lg text-sm transition-colors flex items-center gap-2 disabled:opacity-50"
                    >
                        {isLoadingCrypto ? 'Setting...' : <><KeyRound size={16} /> Set Password</>}
                    </button>
                 </div>
            )}
        </div>
      </section>

      {/* Search Settings - SECOND */}
      <section className="space-y-4">
        <h3 className="text-xl font-semibold flex items-center gap-2 text-text-main">
          <Globe className="w-5 h-5 text-blue-400" />
          Web Search
        </h3>
        <p className="text-sm text-text-muted">
          Configure the default search engine used by AI for internet access.
        </p>

        <div className="bg-surface border border-border rounded-lg p-6">
           <div className="flex flex-col gap-2 max-w-sm">
             <label className="text-sm font-medium text-text-sec">Search Engine</label>
             <select 
               value={searchProvider}
               onChange={(e) => handleSearchChange(e.target.value)}
               className="bg-background border border-border text-text-main text-sm rounded-lg focus:ring-primary focus:border-primary block w-full p-2.5"
             >
               <option value="duckduckgo">DuckDuckGo (Privacy Focused)</option>
               <option value="google">Google</option>
               <option value="bing">Bing</option>
             </select>
           </div>
        </div>
      </section>

      {/* Date Format Settings - THIRD */}
      <section className="space-y-4">
        <h3 className="text-xl font-semibold flex items-center gap-2 text-text-main">
          <Calendar className="w-5 h-5 text-green-400" />
          Date & Time Format
        </h3>
        <p className="text-sm text-text-muted">
          Choose how dates and times are displayed throughout the application.
        </p>

        <div className="bg-surface border border-border rounded-lg p-6">
           <div className="flex flex-col gap-2 max-w-md">
             <label className="text-sm font-medium text-text-sec">Display Format</label>
             <select 
               value={dateFormat}
               onChange={(e) => handleDateFormatChange(e.target.value)}
               className="bg-background border border-border text-text-main text-sm rounded-lg focus:ring-primary focus:border-primary block w-full p-2.5"
             >
               {DATE_FORMATS.map(fmt => (
                   <option key={fmt.value} value={fmt.value}>{fmt.label}</option>
               ))}
             </select>
             <p className="text-xs text-text-muted mt-1">
                Example: {DATE_FORMATS.find(f => f.value === dateFormat)?.example}
             </p>
           </div>
        </div>
      </section>

      {/* History Sort Settings - FOURTH */}
      <section className="space-y-4">
        <h3 className="text-xl font-semibold flex items-center gap-2 text-text-main">
          <ArrowUpDown className="w-5 h-5 text-purple-400" />
          Chat History Order
        </h3>
        <p className="text-sm text-text-muted">
          Choose how chat history is sorted by default.
        </p>

        <div className="bg-surface border border-border rounded-lg p-6">
           <div className="flex flex-col gap-2 max-w-sm">
             <label className="text-sm font-medium text-text-sec">Sort By</label>
             <select 
               value={historySort}
               onChange={(e) => handleHistorySortChange(e.target.value)}
               className="bg-background border border-border text-text-main text-sm rounded-lg focus:ring-primary focus:border-primary block w-full p-2.5"
             >
               {SORT_OPTIONS.map(opt => (
                   <option key={opt.value} value={opt.value}>{opt.label}</option>
               ))}
             </select>
           </div>
        </div>
      </section>

      {/* System Prompt Settings */}
      <section className="space-y-4">
        <h3 className="text-xl font-semibold flex items-center gap-2 text-text-main">
          <MessageSquare className="w-5 h-5 text-cyan-400" />
          System Prompt
        </h3>
        <p className="text-sm text-text-muted">
          Customize the system prompt for AI. This text is prepended to every conversation.
        </p>

        <div className="bg-surface border border-border rounded-lg p-6">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-text-sec">System Message</label>
              <div className="flex items-center gap-2">
                <span className={clsx(
                  "text-xs transition-opacity",
                  promptSaveStatus === 'saving' && "text-yellow-400",
                  promptSaveStatus === 'saved' && "text-green-400",
                  promptSaveStatus === 'idle' && "opacity-0"
                )}>
                  {promptSaveStatus === 'saving' ? 'Saving...' : promptSaveStatus === 'saved' ? 'Saved' : ''}
                </span>
                <button
                  onClick={() => setShowResetModal(true)}
                  className="flex items-center gap-1 px-2 py-1 text-xs bg-surface hover:bg-surface-light border border-border rounded transition-colors text-text-muted hover:text-text-main"
                >
                  <RotateCcw size={12} />
                  Reset
                </button>
              </div>
            </div>
            <textarea
              value={systemPrompt}
              onChange={(e) => handleSystemPromptChange(e.target.value)}
              placeholder="You are a helpful AI assistant..."
              rows={6}
              className="w-full bg-background border border-border text-text-main text-sm rounded-lg focus:ring-primary focus:border-primary p-3 resize-y min-h-[100px]"
            />
            <p className="text-xs text-text-muted">
              Supports Markdown format. Leave empty to use model default.
            </p>
          </div>
        </div>
      </section>

      {/* Workspace Directory Settings */}
      <section className="space-y-4">
        <h3 className="text-xl font-semibold flex items-center gap-2 text-text-main">
          <FolderOpen className="w-5 h-5 text-orange-400" />
          Workspace Directory
        </h3>
        <p className="text-sm text-text-muted">
          The working directory for AI file operations. Downloaded files, script outputs, etc. are saved here.
        </p>

        <div className="bg-surface border border-border rounded-lg p-6">
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={workspacePath}
              readOnly
              className="flex-1 bg-background border border-border text-text-main text-sm rounded-lg p-2.5 font-mono"
            />
            <button
              onClick={handleSelectWorkspace}
              className="px-4 py-2.5 bg-primary hover:bg-blue-600 text-white font-medium rounded-lg text-sm transition-colors flex items-center gap-2"
            >
              <FolderOpen size={16} />
              Select Directory
            </button>
          </div>
          <p className="text-xs text-text-muted mt-2">
            Default: ~/.config/tiginal/workspaces
          </p>
        </div>
      </section>

      {/* Reset System Prompt Confirmation Modal */}
      {showResetModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-surface border border-border rounded-xl w-full max-w-md mx-4 shadow-xl">
            <div className="px-6 py-4 border-b border-border">
              <h3 className="text-lg font-semibold text-text-main">Reset System Prompt</h3>
            </div>
            <div className="p-6">
              <p className="text-text-muted">
                This will overwrite your current system prompt with the default. This action cannot be undone.
              </p>
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-border">
              <button
                onClick={() => setShowResetModal(false)}
                className="px-4 py-2 text-sm bg-background hover:bg-surface-light border border-border rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleResetPrompt}
                className="px-4 py-2 text-sm bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors"
              >
                Reset to Default
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
