import React, { useRef, useEffect, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import { SendHorizontal, Clipboard, Star } from 'lucide-react';
import { clsx } from 'clsx';
import { CommandSuggestion } from './CommandSuggestion';
import { CommandSuggestionList } from './CommandSuggestionList';
import { FavoriteCommandModal } from './FavoriteCommandModal';

interface CommandInputProps {
  onSend: (command: string, execute: boolean) => void;
  cwd: string;
}

export interface CommandInputHandle {
    focus: () => void;
}

interface DirectorySuggestions {
    local: string[];
    frequent: string[];
}

type SuggestionMode = 'none' | 'directory' | 'command';

export const CommandInput = forwardRef<CommandInputHandle, CommandInputProps>(({ onSend, cwd }, ref) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useImperativeHandle(ref, () => ({
      focus: () => {
          textareaRef.current?.focus();
      }
  }));

  const [value, setValue] = useState('');
  
  // Suggestion mode: directory (for cd), command (for others), or none
  const [suggestionMode, setSuggestionMode] = useState<SuggestionMode>('none');
  
  // Directory suggestions (for cd command)
  const [dirSuggestions, setDirSuggestions] = useState<DirectorySuggestions>({ local: [], frequent: [] });
  const [flatDirSuggestions, setFlatDirSuggestions] = useState<string[]>([]);
  
  // Command suggestions (for non-cd commands)
  const [cmdSuggestions, setCmdSuggestions] = useState<string[]>([]);
  
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [showSuggestions, setShowSuggestions] = useState(false);
  
  // Favorite modal
  const [showFavoriteModal, setShowFavoriteModal] = useState(false);

  const invoke = window.electron?.invoke || (async () => null);

  const adjustHeight = () => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      const newHeight = Math.min(Math.max(el.scrollHeight, 36), 120);
      el.style.height = `${newHeight}px`;
    }
  };

  useEffect(() => {
    adjustHeight();
  }, [value]);

  const fetchSuggestions = useCallback((input: string) => {
    const trimmed = input.trim();
    if (!trimmed) {
      setShowSuggestions(false);
      setSuggestionMode('none');
      return;
    }

    // Check if it's a cd command
    const isCd = trimmed === 'cd' || trimmed.startsWith('cd ');
    
    if (isCd) {
      setSuggestionMode('directory');
      const partial = trimmed === 'cd' ? '' : trimmed.substring(3);
      
      invoke('shell:get-directory-suggestions', partial, cwd)
        .then((res: unknown) => {
          const data = res as DirectorySuggestions;
          const flat = [...data.local, ...data.frequent];
          
          setDirSuggestions(data);
          setFlatDirSuggestions(flat);
          setShowSuggestions(flat.length > 0);
          
          // 不默认选中：cd/cd + 空格 或 以 / 结尾时
          if (!partial || partial.endsWith('/')) {
            setSelectedIndex(-1);
          } else if (flat.length > 0) {
            setSelectedIndex(0);
          } else {
            setSelectedIndex(-1);
          }
        })
        .catch(console.error);
    } else {
      // General command - use command history
      setSuggestionMode('command');
      
      invoke('shell:get-command-suggestions', trimmed)
        .then((res: unknown) => {
          const suggestions = res as string[];
          setCmdSuggestions(suggestions);
          setShowSuggestions(suggestions.length > 0);
          
          if (suggestions.length > 0) {
            setSelectedIndex(0);
          } else {
            setSelectedIndex(-1);
          }
        })
        .catch(console.error);
    }
  }, [cwd, invoke]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (value) {
        fetchSuggestions(value);
      } else {
        setShowSuggestions(false);
        setSuggestionMode('none');
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [value, fetchSuggestions]);

  const handleIgnoreDir = async (suggestion: string) => {
    await invoke('shell:ignore-visit', suggestion);
    fetchSuggestions(value);
  };

  const handleDeleteCmd = async (command: string) => {
    await invoke('shell:remove-command', command);
    fetchSuggestions(value);
  };

  // Get current flat suggestions based on mode
  const currentSuggestions = suggestionMode === 'directory' ? flatDirSuggestions : cmdSuggestions;

  // Apply directory suggestion (cd command)
  const applyDirSuggestion = (suggestion: string, execute: boolean = false) => {
    let newValue = '';
    const safeSuggestion = suggestion.replace(/ /g, '\\ ');

    if (value.trim() === 'cd' || value.trim() === 'cd ') {
      newValue = `cd ${safeSuggestion}`;
    } else if (value.startsWith('cd ')) {
      const prefix = value.substring(3);
      
      if (suggestion.startsWith('/')) {
        newValue = `cd ${safeSuggestion}`;
      } else {
        const lastSlash = prefix.lastIndexOf('/');
        let newPrefix = '';
        if (lastSlash !== -1) {
          newPrefix = prefix.substring(0, lastSlash + 1);
        }
        newValue = `cd ${newPrefix}${safeSuggestion}`;
      }
    }

    if (newValue) {
      if (execute) {
        onSend(newValue, true);
        setValue('');
        setShowSuggestions(false);
      } else {
        // Continue navigation - add /
        if (!newValue.endsWith('/')) {
          newValue += '/';
        }
        setValue(newValue);
        setSelectedIndex(-1);
        textareaRef.current?.focus();
      }
    }
  };

  // Apply command suggestion (non-cd) - always just fill, never execute
  const applyCmdSuggestion = (suggestion: string) => {
    setValue(suggestion);
    setShowSuggestions(false);
    setSelectedIndex(-1);
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Tab') e.preventDefault();

    if (showSuggestions && currentSuggestions.length > 0) {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        const newIndex = selectedIndex === -1 ? currentSuggestions.length - 1 : (selectedIndex - 1 + currentSuggestions.length) % currentSuggestions.length;
        setSelectedIndex(newIndex);
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const newIndex = selectedIndex === -1 ? 0 : (selectedIndex + 1) % currentSuggestions.length;
        setSelectedIndex(newIndex);
        return;
      }
      if (e.key === 'Tab') {
        // 目录模式：如果 local 列表只有一项，直接补全（忽略 frequent）
        if (suggestionMode === 'directory' && dirSuggestions.local.length === 1) {
          applyDirSuggestion(dirSuggestions.local[0], false);
        } else if (currentSuggestions.length === 1) {
          // 其他情况：总共只有一个选项时直接补全
          if (suggestionMode === 'directory') {
            applyDirSuggestion(currentSuggestions[0], false);
          } else {
            applyCmdSuggestion(currentSuggestions[0]);
          }
        } else if (e.shiftKey) {
          // Shift+Tab - previous
          const newIndex = selectedIndex <= 0 ? currentSuggestions.length - 1 : selectedIndex - 1;
          setSelectedIndex(newIndex);
        } else {
          // Tab - next
          const newIndex = selectedIndex === -1 ? 0 : (selectedIndex + 1) % currentSuggestions.length;
          setSelectedIndex(newIndex);
        }
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (selectedIndex !== -1) {
          if (suggestionMode === 'directory') {
            // cd: apply and continue
            applyDirSuggestion(currentSuggestions[selectedIndex], false);
          } else {
            // command: just fill
            applyCmdSuggestion(currentSuggestions[selectedIndex]);
          }
        } else {
          handleSend(true);
        }
        return;
      }
      if (e.key === 'Escape') {
        setShowSuggestions(false);
        setSelectedIndex(-1);
        return;
      }
    } else {
      if (e.key === 'Tab') {
        fetchSuggestions(value);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend(true);
    }
  };

  const handleSend = (execute: boolean) => {
    if (!value) return;
    
    // Record command to history (if executing and passes filters)
    if (execute) {
      const trimmed = value.trim();
      
      // Don't record:
      // - cd commands (use directory history)
      // - multi-line commands (contains \n)
      // - line continuation (ends with \)
      // - compound commands (&& or ||)
      const shouldRecord = 
        !trimmed.startsWith('cd ') && 
        trimmed !== 'cd' &&
        !trimmed.includes('\n') &&
        !trimmed.endsWith('\\') &&
        !/\s\\$/.test(trimmed) &&
        !trimmed.includes('&&') &&
        !trimmed.includes('||');
      
      if (shouldRecord) {
        invoke('shell:record-command', trimmed);
      }
    }
    
    onSend(value, execute);
    setValue('');
    setShowSuggestions(false);
    setTimeout(() => {
      textareaRef.current?.focus();
    }, 10);
  };

  const handleAddFavorite = async (command: string) => {
    await invoke('shell:add-favorite-command', command);
  };

  return (
    <div className="relative border-t border-border bg-background p-2 flex gap-2 items-end">
      
      {/* Directory suggestions for cd */}
      {suggestionMode === 'directory' && (
        <CommandSuggestion 
          suggestions={dirSuggestions}
          selectedIndex={selectedIndex}
          onSelect={(s) => applyDirSuggestion(s, false)} 
          onIgnore={handleIgnoreDir}
          visible={showSuggestions}
        />
      )}
      
      {/* Command suggestions for non-cd */}
      {suggestionMode === 'command' && (
        <CommandSuggestionList
          suggestions={cmdSuggestions}
          selectedIndex={selectedIndex}
          onSelect={applyCmdSuggestion}
          onDelete={handleDeleteCmd}
          visible={showSuggestions}
        />
      )}

      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        spellCheck={false}
        autoComplete="off"
        className="flex-1 w-full bg-surface text-text-main text-sm font-mono rounded-md py-2 px-2 outline-none resize-none border border-border placeholder-text-muted overflow-hidden min-h-[36px]"
        placeholder="Enter command..."
        rows={1}
      />
      
      {/* Add Favorite button */}
      <button 
        onClick={() => value.trim() && setShowFavoriteModal(true)}
        disabled={!value.trim()}
        className={clsx(
          "p-2 rounded-lg transition-colors",
          value.trim()
            ? "text-text-muted hover:text-yellow-400 hover:bg-surface-light"
            : "text-text-muted/30 cursor-not-allowed"
        )}
        title="Add to Favorites"
      >
        <Star size={18} />
      </button>
    
      <button 
        onClick={() => handleSend(false)}
        className="p-2 text-text-muted hover:text-text-main hover:bg-surface-light rounded-lg transition-colors"
        title="Paste to Terminal"
      >
        <Clipboard size={18} />
      </button>

      <button 
        onClick={() => handleSend(true)}
        disabled={!value}
        className={clsx(
            "p-2 rounded-lg transition-colors flex items-center justify-center gap-2",
            !value
               ? "bg-surface/50 text-text-muted cursor-not-allowed"
               : "bg-primary text-white hover:opacity-90"
        )}
        title="Send and Execute"
      >
        <SendHorizontal size={18} />
      </button>
      
      {/* Favorite Modal */}
      {showFavoriteModal && (
        <FavoriteCommandModal
          initialCommand={value}
          onSave={handleAddFavorite}
          onClose={() => setShowFavoriteModal(false)}
        />
      )}
    </div>
  );
});
