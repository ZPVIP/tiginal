import React, { useRef, useEffect, useState, forwardRef, useImperativeHandle } from 'react';
import {
  SendHorizontal, 
  Paperclip, 
  Image as ImageIcon,
  X,
  Wand2,
  MessageSquareText,
  Wrench,
  ShieldCheck,
  Square
} from 'lucide-react';
import { clsx } from 'clsx';
import { ToolsPopover } from './ToolsPopover';
import { McpPopover } from './McpPopover';
import { ContextRing } from './ContextRing';
import { SystemPromptsPopover } from './SystemPromptsPopover';
import { ModelSelectorPopover } from './ModelSelectorPopover';
import { Bot, ChevronUp } from 'lucide-react';
import { McpIcon } from '../icons/McpIcon';

export interface ChatInputHandle {
    setText: (text: string) => void;
    focus: () => void;
}

interface ChatInputProps {
  onSend: (text: string, images: string[], useSkills: boolean) => void;
  onStop?: () => void;
  disabled?: boolean;
  isStreaming?: boolean;
  autoApprove?: boolean;
  onAutoApproveChange?: (enabled: boolean) => void;
  
  // Model Selection Props
  models?: { providerId: string; modelId: string; label: string }[];
  selectedProviderId?: string;
  selectedModel?: string;
  onModelSelect?: (providerId: string, modelId: string) => void;

  /** Tokens the last turn occupied, for the context ring. */
  contextUsed?: number;
}

export const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(({ 
    onSend, 
    onStop, 
    disabled, 
    isStreaming,
    autoApprove = false,
    onAutoApproveChange = () => {},
    models = [],
    selectedProviderId = '',
    selectedModel = '',
    onModelSelect = () => {},
    contextUsed = 0
}, ref) => {
  const [text, setText] = useState('');
  const [useSearch, setUseSearch] = useState(false);
  const [useSkills, setUseSkills] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const [showMcp, setShowMcp] = useState(false);
  const [showSystemPrompts, setShowSystemPrompts] = useState(false);
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [globalToolsEnabled, setGlobalToolsEnabled] = useState(false);
  const [globalMcpEnabled, setGlobalMcpEnabled] = useState(false);
  const [globalSystemPromptsEnabled, setGlobalSystemPromptsEnabled] = useState(true);
  const [images, setImages] = useState<string[]>([]);

  useEffect(() => {
    checkGlobalSettings();
  }, [showTools, showMcp, showSystemPrompts, showModelSelector]); // Re-check when popovers toggle (closed)

  useEffect(() => {
    const handleSettingsUpdate = () => checkGlobalSettings();
    window.addEventListener('tools-updated', handleSettingsUpdate);
    window.addEventListener('mcp-updated', handleSettingsUpdate);
    window.addEventListener('system-prompts-updated', handleSettingsUpdate);
    return () => {
      window.removeEventListener('tools-updated', handleSettingsUpdate);
      window.removeEventListener('mcp-updated', handleSettingsUpdate);
      window.removeEventListener('system-prompts-updated', handleSettingsUpdate);
    };
  }, []);

  const checkGlobalSettings = async () => {
    try {
      if ((window as any).electron?.invoke) {
        const [toolsEnabled, mcpEnabled, promptsEnabled] = await Promise.all([
          (window as any).electron.invoke('tools:get-global-enabled'),
          (window as any).electron.invoke('mcp:get-global-enabled'),
          (window as any).electron.invoke('system-prompts:get-global-enabled')
        ]);
        setGlobalToolsEnabled(toolsEnabled);
        setGlobalMcpEnabled(mcpEnabled);
        setGlobalSystemPromptsEnabled(promptsEnabled);
      }
    } catch (e) {
      console.error('Failed to check global settings:', e);
    }
  };
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
    onSend(text, images, useSkills);
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
    <div className="p-2 bg-background border-t border-border relative">


      <div className="max-w-3xl mx-auto bg-surface border border-border rounded-xl shadow-sm transition-all relative z-50">
        
        {/* Tools Popover */}
        {showTools && (
            <>
                <ToolsPopover onClose={() => setShowTools(false)} />
                <div 
                  className="fixed inset-0 z-40 bg-transparent" 
                  onClick={() => setShowTools(false)}
                />
            </>
        )}

        {/* MCP Servers Popover */}
        {showMcp && (
            <>
                <McpPopover onClose={() => setShowMcp(false)} />
                <div 
                  className="fixed inset-0 z-40 bg-transparent" 
                  onClick={() => setShowMcp(false)}
                />
            </>
        )}

        {/* System Prompts Popover */}
        {showSystemPrompts && (
            <>
                <SystemPromptsPopover onClose={() => setShowSystemPrompts(false)} />
                <div 
                  className="fixed inset-0 z-40 bg-transparent" 
                  onClick={() => setShowSystemPrompts(false)}
                />
            </>
        )}

        {/* Model Selector Popover */}
        {showModelSelector && (
            <>
                <ModelSelectorPopover 
                    onClose={() => setShowModelSelector(false)}
                    models={models}
                    selectedProviderId={selectedProviderId}
                    selectedModel={selectedModel}
                    onSelect={onModelSelect}
                />
                <div 
                  className="fixed inset-0 z-40 bg-transparent" 
                  onClick={() => setShowModelSelector(false)}
                />
            </>
        )}

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
                   onClick={() => setShowSystemPrompts(!showSystemPrompts)}
                   className={clsx(
                       "p-2 rounded-lg transition-colors",
                       (showSystemPrompts || globalSystemPromptsEnabled) ? "bg-primary/10 text-primary" : "text-text-muted hover:text-text-main hover:bg-surface-light"
                   )}
                   title="System Prompts"
                >
                    <MessageSquareText size={18} />
                </button>
                <button 
                   onClick={() => setShowTools(!showTools)}
                   className={clsx(
                       "p-2 rounded-lg transition-colors",
                       (showTools || globalToolsEnabled) ? "bg-primary/10 text-primary" : "text-text-muted hover:text-text-main hover:bg-surface-light"
                   )}
                   title="Tools"
                >
                    <Wrench size={18} />
                </button>
                <button 
                   onClick={() => setShowMcp(!showMcp)}
                   className={clsx(
                       "p-2 rounded-lg transition-colors",
                       (showMcp || globalMcpEnabled) ? "bg-primary/10 text-primary" : "text-text-muted hover:text-text-main hover:bg-surface-light"
                   )}
                   title="MCP Servers"
                >
                    <McpIcon size={18} />
                </button>
                <button 
                   onClick={() => setUseSkills(!useSkills)}
                   className={clsx(
                       "p-2 rounded-lg transition-colors",
                       useSkills ? "bg-primary/10 text-primary" : "text-text-muted hover:text-text-main hover:bg-surface-light"
                   )}
                   title="Skills"
                >
                    <Wand2 size={18} />
                </button>
                <button
                   onClick={() => onAutoApproveChange(!autoApprove)}
                   className={clsx(
                       "p-2 rounded-lg transition-colors",
                       autoApprove ? "bg-primary/10 text-primary" : "text-text-muted hover:text-text-main hover:bg-surface-light"
                   )}
                   title={autoApprove
                       ? "AUTO-APPROVE enabled for low and medium risk operations"
                       : "AUTO-APPROVE low and medium risk operations"}
                   aria-label="Toggle AUTO-APPROVE for low and medium risk operations"
                   aria-pressed={autoApprove}
                >
                    <ShieldCheck size={18} />
                </button>
                <div className="h-4 w-[1px] bg-border mx-1" />
                <button 
                   onClick={() => fileInputRef.current?.click()}
                   className="p-2 text-text-muted hover:text-text-main hover:bg-surface-light rounded-lg transition-colors"
                   title="Images"
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
                <div className="h-4 w-[1px] bg-border mx-1" />
                {/* Model Selector Button */}
                <button
                    onClick={() => setShowModelSelector(!showModelSelector)}
                    className={clsx(
                        "flex items-center gap-1.5 px-2 py-1.5 rounded-lg transition-colors text-xs font-medium max-w-[150px]",
                        showModelSelector ? "bg-primary/10 text-primary" : "bg-surface-light text-text-sec hover:text-text-main hover:bg-surface-hover"
                    )}
                    title="Model"
                >
                    <Bot size={14} className="shrink-0" />
                    <span className="truncate">
                        {models.find(m => m.providerId === selectedProviderId && m.modelId === selectedModel)?.label.split(' / ')[1] || selectedModel || 'Select Model'}
                    </span>
                    <ChevronUp size={12} className="opacity-50 shrink-0" />
                </button>
            </div>



            {/* Right side: Context Ring + Send Button */}
            <div className="flex items-center gap-2">

                <ContextRing
                    providerId={selectedProviderId}
                    modelId={selectedModel}
                    used={contextUsed}
                />

                {isStreaming ? (
                <button
                    onClick={onStop}
                    className="p-2 rounded-lg transition-colors flex items-center gap-2 bg-red-800/70 text-white hover:bg-red-700"
                    title="Stop generating"
                >
                    <Square size={14} fill="currentColor" />
                </button>
                ) : (
                <button
                    onClick={handleSend}
                    disabled={(!text.trim() && images.length === 0) || disabled}
                    className={clsx(
                        "p-2 rounded-lg transition-colors flex items-center gap-2",
                        (!text.trim() && images.length === 0) || disabled
                        ? "bg-surface/50 text-text-muted cursor-not-allowed"
                        : "bg-primary text-primary-foreground hover:opacity-90"
                    )}
                >
                    <SendHorizontal size={18} />
                </button>
                )}
            </div>
        </div>
      </div>
    </div>
  );
});
