import React, { useRef, useEffect, useState } from 'react';
import { Send, Clipboard } from 'lucide-react';
import { clsx } from 'clsx';

interface CommandInputProps {
  onSend: (command: string, execute: boolean) => void;
}

export function CommandInput({ onSend }: CommandInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState('');

  const adjustHeight = () => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto'; // Reset to calculate scrollHeight
      const newHeight = Math.min(Math.max(el.scrollHeight, 32), 120);
      el.style.height = `${newHeight}px`;
    }
  };

  useEffect(() => {
    adjustHeight();
  }, [value]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend(true);
    }
  };

  const handleSend = (execute: boolean) => {
    if (!value) return;
    onSend(value, execute);
    setValue('');
  };

  const handlePaste = async () => {
      try {
          const text = await navigator.clipboard.readText();
          setValue(prev => prev + text);
          textareaRef.current?.focus();
      } catch (err) {
          console.error('Failed to read clipboard', err);
      }
  };

  return (
    <div className="border-t border-border bg-[#1a1a1a] p-2 flex gap-2 items-end">
      <div className="flex-1 relative">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          className="w-full bg-[#262626] text-gray-200 text-sm font-mono rounded-md p-2 outline-none resize-none border border-transparent focus:border-primary overflow-hidden min-h-[36px]"
          placeholder="Enter command..."
          rows={1}
        />
      </div>
      
      <button 
        onClick={handlePaste}
        className="p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors mb-0.5"
        title="Paste (without executing)"
      >
        <Clipboard size={18} />
      </button>

      <button 
        onClick={() => handleSend(true)}
        className="p-2 bg-primary/20 text-primary hover:bg-primary/30 rounded-lg transition-colors mb-0.5"
        title="Send and Execute"
      >
        <Send size={18} />
      </button>
    </div>
  );
}
