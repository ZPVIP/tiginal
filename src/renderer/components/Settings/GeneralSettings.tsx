import React, { useEffect, useState } from 'react';
import { Lock, Unlock, Globe, KeyRound, Calendar, ArrowUpDown } from 'lucide-react';
import { clsx } from 'clsx';

// Interface for IPC calls
declare global {
  interface Window {
    electron?: {
      invoke(channel: string, ...args: any[]): Promise<any>;
    };
  }
}
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

      setIsUnlocked(unlocked);
      setHasMasterPassword(hasPwd);
      setHasSavedKey(hasKey);
      
      if (savedDateFormat) setDateFormat(savedDateFormat);
      if (savedHistorySort) setHistorySort(savedHistorySort);
      if (savedSearchProvider) setSearchProvider(savedSearchProvider);
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

  const isLockedState = !isUnlocked && (hasMasterPassword || hasSavedKey);
  const isSetupState = !isUnlocked && !hasMasterPassword && !hasSavedKey;

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      
      {/* Security Settings - FIRST */}
      <section className="space-y-4">
        <h3 className="text-xl font-semibold flex items-center gap-2">
          <KeyRound className="w-5 h-5 text-yellow-500" />
          Security (Master Key)
        </h3>
        <p className="text-sm text-gray-400">
          Manage encryption for your API keys and sensitive data.
        </p>

        <div className="bg-surface border border-border rounded-lg p-6">
            <div className="flex items-center justify-between mb-6">
                <span className="text-sm font-medium text-gray-300">Current Status</span>
                <span className={clsx(
                    "px-2.5 py-0.5 rounded-full text-xs font-medium",
                    isUnlocked ? "bg-green-900 text-green-300" : (isSetupState ? "bg-red-900 text-red-300" : "bg-yellow-900 text-yellow-300")
                )}>
                    {isUnlocked ? "Unlocked" : (isSetupState ? "Not Configured" : "Locked")}
                </span>
            </div>

            {isUnlocked && (
                <div className="flex items-center justify-between">
                    <p className="text-sm text-gray-400">Your keys are decrypted and accessible.</p>
                    <button 
                       onClick={handleLock}
                       className="flex items-center gap-2 px-4 py-2 bg-surface hover:bg-white/5 border border-border rounded-lg transition-colors text-sm"
                    >
                        <Lock size={14} /> Lock Now
                    </button>
                </div>
            )}

            {isLockedState && (
                <div className="flex items-end gap-3">
                    <div className="flex-1">
                        <label className="block mb-2 text-sm font-medium text-gray-300">Enter Master Password</label>
                        <input 
                           type="password" 
                           value={passwordInput}
                           onChange={(e) => setPasswordInput(e.target.value)}
                           onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
                           className="bg-background border border-border text-gray-100 text-sm rounded-lg focus:ring-primary focus:border-primary block w-full p-2.5"
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
                        <label className="block mb-2 text-sm font-medium text-gray-300">Create Master Password</label>
                        <input 
                           type="password" 
                           value={passwordInput}
                           onChange={(e) => setPasswordInput(e.target.value)}
                           onKeyDown={(e) => e.key === 'Enter' && handleSetPassword()}
                           className="bg-background border border-border text-gray-100 text-sm rounded-lg focus:ring-primary focus:border-primary block w-full p-2.5"
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
        <h3 className="text-xl font-semibold flex items-center gap-2">
          <Globe className="w-5 h-5 text-blue-400" />
          Web Search
        </h3>
        <p className="text-sm text-gray-400">
          Configure the default search engine used by AI for internet access.
        </p>

        <div className="bg-surface border border-border rounded-lg p-6">
           <div className="flex flex-col gap-2 max-w-sm">
             <label className="text-sm font-medium text-gray-300">Search Engine</label>
             <select 
               value={searchProvider}
               onChange={(e) => handleSearchChange(e.target.value)}
               className="bg-background border border-border text-gray-100 text-sm rounded-lg focus:ring-primary focus:border-primary block w-full p-2.5"
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
        <h3 className="text-xl font-semibold flex items-center gap-2">
          <Calendar className="w-5 h-5 text-green-400" />
          Date & Time Format
        </h3>
        <p className="text-sm text-gray-400">
          Choose how dates and times are displayed throughout the application.
        </p>

        <div className="bg-surface border border-border rounded-lg p-6">
           <div className="flex flex-col gap-2 max-w-md">
             <label className="text-sm font-medium text-gray-300">Display Format</label>
             <select 
               value={dateFormat}
               onChange={(e) => handleDateFormatChange(e.target.value)}
               className="bg-background border border-border text-gray-100 text-sm rounded-lg focus:ring-primary focus:border-primary block w-full p-2.5"
             >
               {DATE_FORMATS.map(fmt => (
                   <option key={fmt.value} value={fmt.value}>{fmt.label}</option>
               ))}
             </select>
             <p className="text-xs text-gray-500 mt-1">
                Example: {DATE_FORMATS.find(f => f.value === dateFormat)?.example}
             </p>
           </div>
        </div>
      </section>

      {/* History Sort Settings - FOURTH */}
      <section className="space-y-4">
        <h3 className="text-xl font-semibold flex items-center gap-2">
          <ArrowUpDown className="w-5 h-5 text-purple-400" />
          Chat History Order
        </h3>
        <p className="text-sm text-gray-400">
          Choose how chat history is sorted by default.
        </p>

        <div className="bg-surface border border-border rounded-lg p-6">
           <div className="flex flex-col gap-2 max-w-sm">
             <label className="text-sm font-medium text-gray-300">Sort By</label>
             <select 
               value={historySort}
               onChange={(e) => handleHistorySortChange(e.target.value)}
               className="bg-background border border-border text-gray-100 text-sm rounded-lg focus:ring-primary focus:border-primary block w-full p-2.5"
             >
               {SORT_OPTIONS.map(opt => (
                   <option key={opt.value} value={opt.value}>{opt.label}</option>
               ))}
             </select>
           </div>
        </div>
      </section>

    </div>
  );
}
