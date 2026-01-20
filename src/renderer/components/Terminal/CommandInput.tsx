import React, { useRef, useEffect, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import { SendHorizontal, Clipboard } from 'lucide-react';
import { clsx } from 'clsx';
import { CommandSuggestion } from './CommandSuggestion';

interface CommandInputProps {
  onSend: (command: string, execute: boolean) => void;
  cwd: string;
}

export interface CommandInputHandle {
    focus: () => void;
}

interface SuggestionsData {
    local: string[];
    frequent: string[];
}

export const CommandInput = forwardRef<CommandInputHandle, CommandInputProps>(({ onSend, cwd }, ref) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useImperativeHandle(ref, () => ({
      focus: () => {
          textareaRef.current?.focus();
      }
  }));

  const [value, setValue] = useState('');
  
  // Suggestion State
  // Flattened list for index calc: [...local, ...frequent]
  const [flatSuggestions, setFlatSuggestions] = useState<string[]>([]);
  const [suggestionsData, setSuggestionsData] = useState<SuggestionsData>({ local: [], frequent: [] });
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const invoke = window.electron?.invoke || (async () => null);

  const adjustHeight = () => {
    // ... existing height logic
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto'; // Reset to calculate scrollHeight
      const newHeight = Math.min(Math.max(el.scrollHeight, 36), 120);
      el.style.height = `${newHeight}px`;
    }
  };

  useEffect(() => {
    adjustHeight();
  }, [value]);

  const updateSuggestions = useCallback((data: SuggestionsData) => {
      const flat = [...data.local, ...data.frequent];
      setSuggestionsData(data);
      setFlatSuggestions(flat);
      setShowSuggestions(flat.length > 0);
  }, []);

  const fetchSuggestions = useCallback((input: string) => {
      const trimmed = input;
      let partial = '';
      let isCd = false;

      if (trimmed === 'cd' || trimmed === 'cd ') {
          partial = ''; // Fetch all frequent, and local subdirs of CWD?
          isCd = true;
      } else if (trimmed.startsWith('cd ')) {
          partial = trimmed.substring(3);
          isCd = true;
      }

      if (isCd) {
          invoke('shell:get-directory-suggestions', partial, cwd)
             .then((res: unknown) => {
                  const data = res as SuggestionsData;
                  const flat = [...data.local, ...data.frequent];
                  
                  setSuggestionsData(data);
                  setFlatSuggestions(flat);
                  setShowSuggestions(flat.length > 0);

                  // Interact logic
                  // If input ends with / (exact dir match), don't select
                  if (partial.endsWith('/')) {
                      setSelectedIndex(-1);
                  } else {
                      // If just 'cd', select first? Or -1?
                      // If 'cd ', maybe user wants to see frequent list first?
                      // Let's select 0 by default for quick access unless it's a finished path.
                      if (flat.length > 0) setSelectedIndex(0);
                      else setSelectedIndex(-1);
                  }
             })
             .catch(console.error);
      } else {
          setShowSuggestions(false);
      }
  }, [cwd, invoke]);

  useEffect(() => {
      const timer = setTimeout(() => {
          if (value) {
              fetchSuggestions(value);
          } else {
              setShowSuggestions(false);
          }
      }, 100);
      return () => clearTimeout(timer);
  }, [value, fetchSuggestions]);

  const handleIgnore = async (suggestion: string) => {
      await invoke('shell:ignore-visit', suggestion);
      // Refresh suggestions
      fetchSuggestions(value);
  };

  const applySuggestion = (suggestion: string, execute: boolean = false) => {
      let newValue = '';
      const safeSuggestion = suggestion.replace(/ /g, '\\ ');

      if (value === 'cd' || value === 'cd ') {
          newValue = `cd ${safeSuggestion}`;
      } else if (value.startsWith('cd ')) {
          const prefix = value.substring(3);
          // If the suggestion is absolute (from frequent list), just use it full?
          // BUT frequent list returns FULL ABSOLUTE PATHS.
          // Local list returns RELATIVE "subdir/".
          
          if (suggestion.startsWith('/')) {
              // Absolute path from frequent list
              newValue = `cd ${safeSuggestion}`;
          } else {
              // Relative path logic
              const lastSlash = prefix.lastIndexOf('/');
              let newPrefix = '';
              if (lastSlash !== -1) {
                 newPrefix = prefix.substring(0, lastSlash + 1);
              }
              newValue = `cd ${newPrefix}${safeSuggestion}`;
          }
      }

      if (newValue) {
          setValue(newValue);
          textareaRef.current?.focus();
          
          if (execute) {
              onSend(newValue, true);
              setValue(''); 
              setShowSuggestions(false);
          }
      }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Tab') e.preventDefault();

    if (showSuggestions && flatSuggestions.length > 0) {
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            const newIndex = selectedIndex === -1 ? flatSuggestions.length - 1 : (selectedIndex - 1 + flatSuggestions.length) % flatSuggestions.length;
            setSelectedIndex(newIndex);
            return;
        }
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            const newIndex = selectedIndex === -1 ? 0 : (selectedIndex + 1) % flatSuggestions.length;
            setSelectedIndex(newIndex);
            return;
        }
        if (e.key === 'Tab') {
            if (selectedIndex !== -1) {
                applySuggestion(flatSuggestions[selectedIndex], false);
            } else {
                setSelectedIndex(0); // If nothing selected, TAB selects first
            }
            return;
        }
        if (e.key === 'Enter' && !e.shiftKey) {
             e.preventDefault();
             if (selectedIndex !== -1) {
                  applySuggestion(flatSuggestions[selectedIndex], true);
             } else {
                  handleSend(true);
             }
             return; 
        }
        if (e.key === 'Escape') {
            setShowSuggestions(false);
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
    onSend(value, execute);
    setValue('');
    setShowSuggestions(false);
    setTimeout(() => {
        textareaRef.current?.focus();
    }, 10);
  };

  return (
    <div className="relative border-t border-border bg-background p-2 flex gap-2 items-end">
        
        <CommandSuggestion 
            suggestions={suggestionsData}
            selectedIndex={selectedIndex}
            onSelect={(s) => applySuggestion(s, false)} 
            onIgnore={handleIgnore}
            visible={showSuggestions}
        />

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
    </div>
  );
});
