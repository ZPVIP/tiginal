import React, { useEffect, useState } from 'react';
import { Lock, Unlock, Globe, KeyRound, Calendar, ArrowUpDown, FolderOpen } from 'lucide-react';
import { clsx } from 'clsx';
import { FancySelect } from '../ui/FancySelect';
import { InfoIcon } from '../Shared/InfoIcon';

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
  const [showMasterKeyInput, setShowMasterKeyInput] = useState(false);

  // Search State
  const [searchProvider, setSearchProvider] = useState('duckduckgo');
  
  // Date/Sort State
  const [dateFormat, setDateFormat] = useState('iso');
  const [historySort, setHistorySort] = useState('updatedAt');
  
  // Workspace State
  const [workspacePath, setWorkspacePath] = useState('');

  
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
      const savedWorkspace = await invoke('workspace:get-path');

      setIsUnlocked(unlocked);
      setHasMasterPassword(hasPwd);
      setHasSavedKey(hasKey);
      
      if (savedDateFormat) setDateFormat(savedDateFormat);
      if (savedHistorySort) setHistorySort(savedHistorySort);
      if (savedSearchProvider) setSearchProvider(savedSearchProvider);
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
    window.dispatchEvent(new CustomEvent('settings-general-updated', { detail: { key: 'searchProvider', value: val } }));
  };

  const handleDateFormatChange = async (val: string) => {
    setDateFormat(val);
    await invoke('settings:set', 'dateFormat', val);
    window.dispatchEvent(new CustomEvent('settings-general-updated', { detail: { key: 'dateFormat', value: val } }));
  };

  const handleHistorySortChange = async (val: string) => {
    setHistorySort(val);
    await invoke('settings:set', 'historySort', val);
    window.dispatchEvent(new CustomEvent('settings-general-updated', { detail: { key: 'historySort', value: val } }));
  };

  const handleSelectWorkspace = async () => {
    const selected = await invoke('workspace:open-dialog');
    if (selected) {
      await invoke('workspace:set-path', selected);
      setWorkspacePath(selected);
    }
  };

  const isLockedState = !isUnlocked && (hasMasterPassword || hasSavedKey);
  const isSetupState = !isUnlocked && !hasMasterPassword && !hasSavedKey;

  return (
    <div className="space-y-3 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-text-main flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-yellow-500" />
          Security (Master Key)
          <InfoIcon
            title={
              `Encrypt/decrypt sensitive data (API keys).\n` +
              `Status: ${isUnlocked ? 'Unlocked' : (isSetupState ? 'Not Configured' : 'Locked')}`
            }
          />
        </label>

        <div className="w-[60%] flex justify-end">
          {isUnlocked ? (
            <button
              onClick={handleLock}
              className="h-9 px-3 bg-surface text-text-main text-sm rounded-lg border border-border hover:bg-surface-light transition-colors flex items-center gap-2"
              title="Lock master key"
            >
              <Lock size={14} />
              Lock
            </button>
          ) : !showMasterKeyInput ? (
            <button
              onClick={() => setShowMasterKeyInput(true)}
              className="h-9 px-3 bg-primary text-white text-sm rounded-lg hover:bg-blue-600 transition-colors flex items-center gap-2 disabled:opacity-50"
              title={isSetupState ? 'Set master password' : 'Unlock master key'}
              disabled={isLoadingCrypto}
            >
              {isSetupState ? <KeyRound size={14} /> : <Unlock size={14} />}
              {isSetupState ? 'Set' : 'Unlock'}
            </button>
          ) : (
            <div className="w-full flex items-center justify-end gap-2">
              <button
                onClick={async () => {
                  if (isSetupState) await handleSetPassword();
                  else await handleUnlock();
                }}
                disabled={isLoadingCrypto}
                className="h-9 w-10 bg-primary text-white rounded-lg hover:bg-blue-600 transition-colors flex items-center justify-center disabled:opacity-50"
                title={isSetupState ? 'Set master password' : 'Unlock'}
              >
                {isSetupState ? <KeyRound size={16} /> : <Unlock size={16} />}
              </button>
              <input
                type="password"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  if (isSetupState) handleSetPassword();
                  else handleUnlock();
                }}
                onBlur={() => setTimeout(() => setShowMasterKeyInput(false), 150)}
                className="flex-1 bg-surface text-text-main text-sm rounded-lg py-2 px-3 border border-border focus:border-primary outline-none"
                placeholder={isSetupState ? 'Create password…' : 'Enter password…'}
              />
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-text-main flex items-center gap-2">
          <Globe className="w-4 h-4 text-blue-400" />
          Web Search
          <InfoIcon title="Default search engine used when AI performs web search." />
        </label>
        <div className="w-[60%]">
          <FancySelect
            value={searchProvider}
            onChange={handleSearchChange}
            options={[
              { value: 'duckduckgo', label: 'DuckDuckGo' },
              { value: 'google', label: 'Google' },
              { value: 'bing', label: 'Bing' },
            ]}
          />
        </div>
      </div>

      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-text-main flex items-center gap-2">
          <Calendar className="w-4 h-4 text-green-400" />
          Date & Time Format
          <InfoIcon title={`Applies across the app (e.g. chat history).\nExample: ${DATE_FORMATS.find(f => f.value === dateFormat)?.example || ''}`} />
        </label>
        <div className="w-[60%]">
          <FancySelect
            value={dateFormat}
            onChange={handleDateFormatChange}
            options={DATE_FORMATS.map(fmt => ({ value: fmt.value, label: fmt.label }))}
          />
        </div>
      </div>

      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-text-main flex items-center gap-2">
          <ArrowUpDown className="w-4 h-4 text-purple-400" />
          Chat History Order
          <InfoIcon title="Default sort order in chat history panel." />
        </label>
        <div className="w-[60%]">
          <FancySelect
            value={historySort}
            onChange={handleHistorySortChange}
            options={SORT_OPTIONS.map(opt => ({ value: opt.value, label: opt.label }))}
          />
        </div>
      </div>

      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-text-main flex items-center gap-2">
          <FolderOpen className="w-4 h-4 text-orange-400" />
          Workspace Directory
          <InfoIcon title="Working directory for AI file operations. Downloaded files and script outputs are saved here." />
        </label>
        <div className="w-[60%] flex justify-end">
          <div className="flex w-full items-center gap-2">
            <button
              onClick={handleSelectWorkspace}
              className="h-9 w-10 bg-surface text-text-main rounded-lg border border-border hover:bg-surface-light transition-colors flex items-center justify-center"
              title="Choose workspace directory"
            >
              <FolderOpen size={16} />
            </button>
            <input
              type="text"
              value={workspacePath}
              readOnly
              className="flex-1 bg-surface text-text-main text-sm rounded-lg py-2 px-3 border border-border outline-none font-mono text-right"
              title={workspacePath}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
