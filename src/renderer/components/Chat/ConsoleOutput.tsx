import React, { useMemo } from 'react';
import { clsx } from 'clsx';

interface ConsoleOutputProps {
  content: string;
  className?: string;
}

export function ConsoleOutput({ content, className }: ConsoleOutputProps) {
  // Process content to handle carriage returns (\r)
  // This mimics terminal behavior where \r overwrites the current line
  const processedContent = useMemo(() => {
    return content.split('\n').map(line => {
      // Split by \r and take the last non-empty segment if possible, 
      // or just the last segment. 
      // For progress bars (yt-dlp), usually we want the last state.
      const parts = line.split('\r');
      return parts[parts.length - 1];
    }).join('\n');
  }, [content]);

  return (
    <div className={clsx(
      "font-mono text-[10px] leading-tight",
      "bg-[#1e1e1e] text-gray-300", 
      "p-2 rounded-md my-2",
      // Adaptive height: max-height roughly 15 lines (15 * 1.25em + padding)
      "max-h-[205px] overflow-y-auto custom-scrollbar",
      "whitespace-pre-wrap break-all", // Ensure wrap
      "shadow-inner border border-white/10",
      className
    )}>
      {processedContent}
    </div>
  );
}
