import React, { useRef, useEffect } from 'react';
import { clsx } from 'clsx';
import { Terminal, Trash2, Star } from 'lucide-react';

export interface CommandSuggestionListProps {
  suggestions: string[];
  selectedIndex: number;
  onSelect: (suggestion: string) => void;
  onDelete: (suggestion: string) => void;
  visible: boolean;
}

export function CommandSuggestionList({ 
  suggestions, 
  selectedIndex, 
  onSelect, 
  onDelete, 
  visible 
}: CommandSuggestionListProps) {
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    if (selectedIndex >= 0 && itemRefs.current[selectedIndex]) {
      itemRefs.current[selectedIndex]?.scrollIntoView({
        block: 'nearest',
        behavior: 'smooth'
      });
    }
  }, [selectedIndex]);

  if (!visible || suggestions.length === 0) return null;

  return (
    <div className="absolute bottom-full left-0 mb-2 z-50 px-2 max-w-full">
      <div className="bg-surface/95 backdrop-blur-sm border border-border shadow-xl rounded-lg overflow-hidden max-h-[420px] overflow-y-auto w-auto min-w-[300px] max-w-full block">
        <div className="px-2 py-1 text-[10px] uppercase font-bold text-text-muted bg-surface-light/50">
          Command History
        </div>
        {suggestions.map((cmd, idx) => {
          const isSelected = idx === selectedIndex;
          return (
            <div
              key={cmd}
              ref={el => { itemRefs.current[idx] = el; }}
              className={clsx(
                "group px-3 py-1.5 cursor-pointer flex items-center justify-between gap-2 text-sm font-mono transition-colors whitespace-nowrap",
                isSelected
                  ? "bg-primary text-white"
                  : "text-text-main hover:bg-surface-light"
              )}
              onClick={() => onSelect(cmd)}
            >
              <div className="flex items-center gap-2 overflow-hidden">
                <Terminal size={14} className={clsx("shrink-0", isSelected ? "text-white/80" : "text-green-400")} />
                <span className="truncate">{cmd}</span>
              </div>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(cmd);
                }}
                className={clsx(
                  "opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-500/20 hover:text-red-400 transition-opacity",
                  isSelected ? "text-white/70" : "text-text-muted"
                )}
                title="Remove from history"
              >
                <Trash2 size={12} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
