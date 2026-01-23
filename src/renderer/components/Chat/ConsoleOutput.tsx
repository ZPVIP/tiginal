import React from 'react';
import { clsx } from 'clsx';

interface ConsoleOutputProps {
  content: string;
  className?: string;
}

export function ConsoleOutput({ content, className }: ConsoleOutputProps) {
  return (
    <div className={clsx(
      "font-mono text-[10px] leading-tight",
      "bg-[#1e1e1e] text-gray-300", 
      "p-2 rounded-md my-2",
      "h-[150px] overflow-y-auto custom-scrollbar",
      "whitespace-pre-wrap break-all", // Ensure wrap
      "shadow-inner border border-white/10",
      className
    )}>
      {content}
    </div>
  );
}
