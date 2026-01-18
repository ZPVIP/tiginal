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
    <div className="border-t border-border bg-background p-2 flex gap-2 items-end">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
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
}
