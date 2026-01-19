import React, { useRef, useEffect, useState, forwardRef, useImperativeHandle } from 'react';
import { 
  SendHorizontal, 
  Paperclip, 
  Globe, 
  Image as ImageIcon,
  X
} from 'lucide-react';
import { clsx } from 'clsx';

export interface ChatInputHandle {
    setText: (text: string) => void;
    focus: () => void;
}

interface ChatInputProps {
  onSend: (text: string, images: string[], useSearch: boolean) => void;
  disabled?: boolean;
}

export const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(({ onSend, disabled }, ref) => {
  const [text, setText] = useState('');
  const [useSearch, setUseSearch] = useState(false);
  const [images, setImages] = useState<string[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({
      setText: (newText: string) => {
          setText(newText);
          // Auto resize after setting text
          if (textareaRef.current) {
               // We need a slight delay or effect to ensure the value updates before calc
               // But usually state update triggers effect. 
               // Let's rely on the useEffect([text]) below.
          }
      },
      focus: () => {
          textareaRef.current?.focus();
      }
  }));

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px';
    }
  }, [text]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSend = () => {
    if ((!text.trim() && images.length === 0) || disabled) return;
    onSend(text, images, useSearch);
    setText('');
    setImages([]);
    // Reset height
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
     const files = e.target.files;
     if (files) {
         Array.from(files).forEach(file => {
             const reader = new FileReader();
             reader.onload = (e) => {
                 if (e.target?.result) {
                     setImages(prev => [...prev, e.target!.result as string]);
                 }
             };
             reader.readAsDataURL(file);
         });
     }
  };

  return (
    <div className="p-4 bg-background border-t border-border">
      <div className="max-w-3xl mx-auto bg-surface border border-border rounded-xl shadow-sm transition-all">
        
        {/* Image Previews */}
        {images.length > 0 && (
            <div className="flex gap-2 p-3 border-b border-border overflow-x-auto">
                {images.map((img, idx) => (
                    <div key={idx} className="relative group shrink-0">
                        <img src={img} alt="preview" className="h-16 w-16 object-cover rounded-lg border border-border" />
                        <button 
                           onClick={() => setImages(prev => prev.filter((_, i) => i !== idx))}
                           className="absolute -top-1.5 -right-1.5 bg-background border border-border rounded-full p-0.5 text-text-muted hover:text-red-400"
                        >
                            <X size={12} />
                        </button>
                    </div>
                ))}
            </div>
        )}

        {/* Text Area */}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask anything..."
          rows={1}
          disabled={disabled}
          className="w-full bg-transparent border-0 outline-none focus:ring-0 resize-none py-3 px-4 min-h-[50px] max-h-[200px] text-text-main placeholder-text-muted"
        />

        {/* Toolbar */}
        <div className="flex items-center justify-between px-2 pb-2">
            <div className="flex items-center gap-1">
                <button 
                   onClick={() => setUseSearch(!useSearch)}
                   className={clsx(
                       "p-2 rounded-lg transition-colors",
                       useSearch ? "bg-primary/10 text-primary" : "text-text-muted hover:text-text-main hover:bg-surface-light"
                   )}
                   title="Web Search"
                >
                    <Globe size={18} />
                </button>
                <div className="h-4 w-[1px] bg-border mx-1" />
                <button 
                   onClick={() => fileInputRef.current?.click()}
                   className="p-2 text-text-muted hover:text-text-main hover:bg-surface-light rounded-lg transition-colors"
                   title="Attach Image"
                >
                    <ImageIcon size={18} />
                </button>
                <input 
                   type="file" 
                   ref={fileInputRef} 
                   onChange={handleFileSelect} 
                   accept="image/*" 
                   multiple 
                   className="hidden" 
                />
            </div>

            <button
               onClick={handleSend}
               disabled={(!text.trim() && images.length === 0) || disabled}
               className={clsx(
                   "p-2 rounded-lg transition-colors flex items-center gap-2",
                   (!text.trim() && images.length === 0) || disabled
                      ? "bg-surface/50 text-text-muted cursor-not-allowed"
                      : "bg-primary text-white hover:opacity-90"
               )}
            >
                <SendHorizontal size={18} />
            </button>
        </div>
      </div>
    </div>
  );
});
