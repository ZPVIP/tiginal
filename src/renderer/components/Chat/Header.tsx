import React from 'react';
import { 
  Eraser, 
  History, 
  Settings, 
  ChevronDown, 
  Bot, 
  Zap 
} from 'lucide-react';

interface HeaderProps {
  model: string;
  onModelChange: (model: string) => void;
  onClear: () => void;
  onHistory: () => void;
  onSettings: () => void;
  models: string[];
}

export function Header({ model, onModelChange, onClear, onHistory, onSettings, models }: HeaderProps) {
  return (
    <div className="h-14 border-b border-border bg-background/50 backdrop-blur-sm flex items-center justify-between px-4 sticky top-0 z-30">
      <div className="flex items-center gap-2">
        <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
            <Zap size={18} fill="currentColor" />
        </div>
        <div className="font-semibold text-gray-100">Page Assist</div>
        
        <div className="h-4 w-[1px] bg-border mx-2" />
        
        {/* Model Selector */}
        <div className="relative group">
            <button className="flex items-center gap-1.5 text-sm font-medium text-gray-300 hover:text-white transition-colors px-2 py-1 rounded-md hover:bg-white/5">
                <Bot size={14} />
                <span>{model || 'Select Model...'}</span>
                <ChevronDown size={12} className="opacity-50" />
            </button>
            
            {/* Dropdown (Simple implementation) */}
            <select 
               value={model}
               onChange={(e) => onModelChange(e.target.value)}
               className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
            >
                <option value="" disabled>Select Model</option>
                {models.map(m => (
                    <option key={m} value={m}>{m}</option>
                ))}
            </select>
        </div>
      </div>

      <div className="flex items-center gap-1">
        <button 
          onClick={onClear}
          title="Clear Chat"
          className="p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
        >
            <Eraser size={18} />
        </button>
        <button 
          onClick={onHistory}
          title="History"
          className="p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
        >
            <History size={18} />
        </button>
        <button 
          onClick={onSettings}
          title="Settings"
          className="p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
        >
            <Settings size={18} />
        </button>
      </div>
    </div>
  );
}
