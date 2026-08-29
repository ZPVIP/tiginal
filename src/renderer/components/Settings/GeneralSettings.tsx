import React, { useEffect, useState } from 'react';
import { Lock, Unlock, Globe, KeyRound, Calendar, Clock3, ArrowUpDown, FolderOpen } from 'lucide-react';
import { FancySelect } from '../ui/FancySelect';
import { Modal } from '../ui/Modal';
import { InfoIcon } from '../Shared/InfoIcon';
import {
  getSupportedTimeZones,
  parseDateFormat,
  parseTimeZonePreference,
  resolveTimeZone,
  serializeTimeZonePreference,
  type DateFormat,
  type TimeZonePreference,
} from '../../../shared/date-time';

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

const SYSTEM_TIME_ZONE = resolveTimeZone({ kind: 'system' });
const TIME_ZONE_OPTIONS = getSupportedTimeZones();

export function GeneralSettings() {
  // Crypto State
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [hasMasterPassword, setHasMasterPassword] = useState(false);
  const [hasSavedKey, setHasSavedKey] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [isLoadingCrypto, setIsLoadingCrypto] = useState(false);
  const [showMasterKeyInput, setShowMasterKeyInput] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changePasswordError, setChangePasswordError] = useState('');

  // Search State
  const [searchProvider, setSearchProvider] = useState('duckduckgo');
  
  // Date/Sort State
  const [dateFormat, setDateFormat] = useState<DateFormat>('iso');
  const [timeZone, setTimeZone] = useState<TimeZonePreference>({ kind: 'system' });
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
      const savedTimeZone = await invoke('settings:get', 'timeZone');
      const savedHistorySort = await invoke('settings:get', 'historySort');
      const savedSearchProvider = await invoke('settings:get', 'searchProvider');
      const savedWorkspace = await invoke('workspace:get-path');

      setIsUnlocked(unlocked);
      setHasMasterPassword(hasPwd);
      setHasSavedKey(hasKey);
      
      setDateFormat(parseDateFormat(savedDateFormat));
      setTimeZone(parseTimeZonePreference(savedTimeZone));
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

  const closeChangePassword = () => {
    if (isLoadingCrypto) return;
    setShowChangePassword(false);
    setNewPassword('');
    setConfirmPassword('');
    setChangePasswordError('');
  };

  const handleChangePassword = async () => {
    setChangePasswordError('');
    if (!newPassword) {
      setChangePasswordError('New password is required.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setChangePasswordError('Passwords do not match.');
      return;
    }

    setIsLoadingCrypto(true);
    try {
      const result = await invoke('crypto:change-password', newPassword);
      if (!result.success) {
        setChangePasswordError(result.error || 'Failed to change password.');
        return;
      }

      setHasMasterPassword(true);
      setHasSavedKey(result.autoUnlockSaved === true);
      setShowChangePassword(false);
      setNewPassword('');
      setConfirmPassword('');
      setChangePasswordError('');
      if (result.autoUnlockSaved === false) {
        alert('Password changed. Automatic unlock is unavailable, so the new password will be required after restart.');
      }
    } finally {
      setIsLoadingCrypto(false);
    }
  };

  const handleSearchChange = async (val: string) => {
    setSearchProvider(val);
    await invoke('settings:set', 'searchProvider', val);
    window.dispatchEvent(new CustomEvent('settings-general-updated', { detail: { key: 'searchProvider', value: val } }));
  };

  const handleDateFormatChange = async (val: string) => {
    const format = parseDateFormat(val);
    setDateFormat(format);
    await invoke('settings:set', 'dateFormat', format);
    window.dispatchEvent(new CustomEvent('settings-general-updated', { detail: { key: 'dateFormat', value: format } }));
  };

  const handleTimeZoneChange = async (val: string) => {
    const preference = parseTimeZonePreference(val);
    const storedValue = serializeTimeZonePreference(preference);
    setTimeZone(preference);
    await invoke('settings:set', 'timeZone', storedValue);
    window.dispatchEvent(new CustomEvent('settings-general-updated', { detail: { key: 'timeZone', value: storedValue } }));
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
            <div className="flex items-center gap-2">
              <button
                onClick={handleLock}
                className="h-9 px-3 bg-surface text-text-main text-sm rounded-lg border border-border hover:bg-surface-light transition-colors flex items-center gap-2"
                title="Lock master key"
              >
                <Lock size={14} />
                Lock
              </button>
              <button
                onClick={() => setShowChangePassword(true)}
                className="h-9 px-3 bg-surface text-text-main text-sm rounded-lg border border-border hover:bg-surface-light transition-colors flex items-center gap-2"
                title="Change master password"
              >
                <KeyRound size={14} />
                Change
              </button>
            </div>
          ) : !showMasterKeyInput ? (
            <button
              onClick={() => setShowMasterKeyInput(true)}
              className="h-9 px-3 bg-primary text-primary-foreground text-sm rounded-lg hover:opacity-90 transition-colors flex items-center gap-2 disabled:opacity-50"
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
                className="h-9 w-10 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-colors flex items-center justify-center disabled:opacity-50"
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
          <Clock3 className="w-4 h-4 text-cyan-400" />
          Time Zone
          <InfoIcon title={`Timestamps are stored as UTC and displayed in this time zone.\nSystem time zone: ${SYSTEM_TIME_ZONE}`} />
        </label>
        <div className="w-[60%]">
          <select
            value={serializeTimeZonePreference(timeZone)}
            onChange={(event) => handleTimeZoneChange(event.target.value)}
            className="w-full h-9 bg-surface text-text-main text-sm rounded-lg px-3 border border-border outline-none focus:border-primary"
            aria-label="Time Zone"
          >
            <option value="system">System default ({SYSTEM_TIME_ZONE})</option>
            {TIME_ZONE_OPTIONS.map(zone => (
              <option key={zone} value={zone}>{zone}</option>
            ))}
          </select>
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

      <Modal
        isOpen={showChangePassword}
        onClose={closeChangePassword}
        title="Change Master Password"
      >
        <div className="p-4 space-y-4">
          <p className="text-xs text-text-muted">
            Existing API keys and SSH credentials will be re-encrypted with the new password.
          </p>

          {changePasswordError && (
            <div className="px-3 py-2 rounded-lg border border-accent-danger/40 bg-accent-danger/10 text-sm text-accent-danger">
              {changePasswordError}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-text-sec mb-1.5">New password</label>
            <input
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              autoFocus
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-text-main focus:border-primary"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-text-sec mb-1.5">Confirm new password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void handleChangePassword();
              }}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-text-main focus:border-primary"
            />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={closeChangePassword}
              disabled={isLoadingCrypto}
              className="px-4 py-2 text-sm bg-background border border-border rounded-lg hover:bg-surface-light disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={() => void handleChangePassword()}
              disabled={isLoadingCrypto}
              className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50"
            >
              {isLoadingCrypto ? 'Changing...' : 'Change Password'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
