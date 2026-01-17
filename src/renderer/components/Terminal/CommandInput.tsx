import React, { useRef, useEffect, useState } from 'react';
import { SendHorizontal, Clipboard } from 'lucide-react';
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
      const newHeight = Math.min(Math.max(el.scrollHeight, 36), 120);
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
    // Keep focus in textarea after sending
    textareaRef.current?.focus();
  };

  return (
    <div className="border-t border-border bg-[#1a1a1a] p-2 flex gap-2 items-end">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          className="flex-1 w-full bg-[#262626] text-gray-200 text-sm font-mono rounded-md py-2 px-2 outline-none resize-none border border-transparent overflow-hidden min-h-[36px]"
          placeholder="Enter command..."
          rows={1}
        />
      
      <button 
        onClick={() => handleSend(false)}
        className="h-[36px] w-[36px] flex items-center justify-center bg-white/5 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
        title="Paste to Terminal"
      >
        <Clipboard size={18} />
      </button>

      <button 
        onClick={() => handleSend(true)}
        className="h-[36px] w-[36px] flex items-center justify-center bg-primary/20 text-primary hover:bg-primary/30 rounded-lg transition-colors"
        title="Send and Execute"
      >
        <SendHorizontal size={18} />
      </button>
    </div>
  );
}
