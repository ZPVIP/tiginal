import React from 'react';
import { 
  ChevronDown, 
  Bot,
  EyeOff,
  MessageSquarePlus,
  History
} from 'lucide-react';
import { clsx } from 'clsx';
import { TigiCat } from '../icons/TigiCat';

interface HeaderProps {
  currentValue: string;
  onModelChange: (val: string) => void;
  onNewChat: () => void;
  onHistory: () => void;
  onIncognitoToggle: () => void;
  isIncognito: boolean;
  models: { value: string, label: string }[];
}

export function Header({ 
  currentValue, 
  onModelChange, 
  onNewChat, 
  onHistory, 
  onIncognitoToggle, 
  isIncognito,
  models 
}: HeaderProps) {
  
  const currentLabel = models.find(m => m.value === currentValue)?.label || currentValue || 'Select Model...';
  // Use a shorter display label if possible, or just the full one. 
  // User asked for "Provider / Model" in dropdown. 
  // In the button, maybe "Model (Provider)" or just keep the same? 
  // Requirement: "providers 的 models 也要出现在 AI chat 窗口，并以 Provider / Model 的格式显示在下拉列表中"
  // It implies the dropdown options. The button text isn't explicitly constrained but typical to match.

  return (
    <div className="border-b border-border bg-background/50 backdrop-blur-sm flex items-center justify-between px-4 sticky top-0 z-30 shrink-0" style={{ height: '40px' }}>
      <div className="flex items-center gap-2">
        {/* Tigi Branding */}
        <TigiCat size={28} />
        <div className="font-semibold text-gray-100">Tigi</div>
        
        <div className="h-4 w-[1px] bg-border mx-2" />
        
        {/* Model Selector */}
        <div className="relative group max-w-[300px]">
            <button className="flex items-center gap-1.5 text-sm font-medium text-gray-300 hover:text-white transition-colors px-2 py-1 rounded-md hover:bg-white/5 w-full">
                <Bot size={14} className="shrink-0" />
                <span className="truncate">{currentLabel}</span>
                <ChevronDown size={12} className="opacity-50 shrink-0" />
            </button>
            
            {/* Dropdown (Simple implementation) */}
            <select 
               value={currentValue}
               onChange={(e) => onModelChange(e.target.value)}
               className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
            >
                <option value="" disabled>Select Model</option>
                {models.map(m => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                ))}
            </select>
        </div>
      </div>

      <div className="flex items-center gap-1">
        {/* Incognito Mode */}
        <button 
          onClick={onIncognitoToggle}
          title="Incognito Mode"
          className={clsx(
              "p-2 rounded-lg transition-colors",
              isIncognito 
                  ? "bg-purple-500/20 text-purple-400" 
                  : "text-gray-400 hover:text-white hover:bg-white/10"
          )}
        >
            <EyeOff size={18} />
        </button>
        
        {/* New Chat */}
        <button 
          onClick={onNewChat}
          title="New Chat"
          className="p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
        >
            <MessageSquarePlus size={18} />
        </button>
        
        {/* History */}
        <button 
          onClick={onHistory}
          title="Chat History"
          className="p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
        >
            <History size={18} />
        </button>
      </div>
    </div>
  );
}
