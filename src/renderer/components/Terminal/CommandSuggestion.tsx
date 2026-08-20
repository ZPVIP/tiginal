import React, { useRef, useEffect } from 'react';
import { clsx } from 'clsx';
import { Folder, Trash2, History } from 'lucide-react';

export interface CommandSuggestionProps {
  suggestions: {
      local: string[];
      frequent: string[];
  };
  selectedIndex: number;
  onSelect: (suggestion: string) => void;
  onIgnore: (suggestion: string) => void;
  visible: boolean;
}

export function CommandSuggestion({ suggestions, selectedIndex, onSelect, onIgnore, visible }: CommandSuggestionProps) {
  const { local, frequent } = suggestions;
  const hasLocal = local.length > 0;
  const hasFrequent = frequent.length > 0;
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  
  // 选中项变化时滚动到可视区域
  useEffect(() => {
      if (selectedIndex >= 0 && itemRefs.current[selectedIndex]) {
          itemRefs.current[selectedIndex]?.scrollIntoView({
              block: 'nearest',
              behavior: 'smooth'
          });
      }
  }, [selectedIndex]);
  
  if (!visible || (!hasLocal && !hasFrequent)) return null;

  // Helper to map flat index to suggestion
  // Index 0..local.length-1 -> local
  // Index local.length..local.length+frequent.length-1 -> frequent

  const renderItem = (suggestion: string, idx: number, isFrequent: boolean = false) => {
      const isSelected = idx === selectedIndex;
      return (
          <div
            key={`${isFrequent ? 'freq' : 'loc'}-${suggestion}`}
            ref={el => { itemRefs.current[idx] = el; }}
            className={clsx(
              "group px-3 py-1.5 cursor-pointer flex items-center justify-between gap-2 text-sm font-mono transition-colors whitespace-nowrap",
              isSelected
                ? "bg-primary text-primary-foreground" 
                : "text-text-main hover:bg-surface-light"
            )}
            onClick={() => onSelect(suggestion)}
          >
             <div className="flex items-center gap-2 overflow-hidden">
                {isFrequent ? (
                    <History size={14} className={clsx("shrink-0", isSelected ? "text-white/80" : "text-purple-400")} />
                ) : (
                    <Folder size={14} className={clsx("shrink-0", isSelected ? "text-white/80" : "text-blue-400")} />
                )}
                <span className="truncate">{suggestion}</span>
             </div>

             {/* Delete Button for Frequent items */}
             {isFrequent && (
                 <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onIgnore(suggestion);
                    }}
                    className={clsx(
                        "opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-500/20 hover:text-red-400 transition-opacity",
                        isSelected ? "text-white/70" : "text-text-muted"
                    )}
                    title="Remove from history"
                 >
                     <Trash2 size={12} />
                 </button>
             )}
          </div>
      );
  };

  return (
    <div className="absolute bottom-full left-0 mb-2 z-50 px-2 max-w-full">
      <div className="bg-surface/95 backdrop-blur-sm border border-border shadow-xl rounded-lg overflow-hidden max-h-[420px] overflow-y-auto w-auto min-w-[200px] max-w-full block">
        
        {/* Local Section */}
        {hasLocal && (
            <div className="flex flex-col">
                <div className="px-2 py-1 text-[10px] uppercase font-bold text-text-muted bg-surface-light/50">
                    Current Directory
                </div>
                {local.map((s, i) => renderItem(s, i, false))}
            </div>
        )}

        {/* Divider */}
        {hasLocal && hasFrequent && (
            <div className="h-[1px] bg-border my-1" />
        )}

        {/* Frequent Section */}
        {hasFrequent && (
             <div className="flex flex-col">
                <div className="px-2 py-1 text-[10px] uppercase font-bold text-text-muted bg-surface-light/50">
                    Frequent
                </div>
                {frequent.map((s, i) => renderItem(s, i + local.length, true))}
            </div>
        )}

      </div>
    </div>
  );
}
