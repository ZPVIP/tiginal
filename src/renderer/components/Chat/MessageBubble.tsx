import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { clsx } from 'clsx';
import { User, Copy, Check, ChevronDown, ChevronRight, Brain, Maximize2, Minimize2, Pencil, FileText, Monitor, Smartphone, Activity } from 'lucide-react';
import { TigiCat } from '../icons/TigiCat';
import { useEffect, useLayoutEffect, useRef } from 'react';

import { ConsoleOutput } from './ConsoleOutput';

interface MessageProps {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  reasoning?: string;
  images?: string[];
  tool_call_id?: string; // Optional: to link back to call
  onEdit?: (content: string) => void;
  promptTokens?: number;
  completionTokens?: number;
  reasoningTokens?: number;
  cachedTokens?: number;
  totalTokens?: number;
}

function formatTokenTooltip(props: { promptTokens?: number; completionTokens?: number; reasoningTokens?: number; cachedTokens?: number; totalTokens?: number }): string {
  const parts: string[] = [];

  let promptPart = `Prompt: ${props.promptTokens || 0}`;
  if (props.cachedTokens) {
    promptPart += ` (Cached: ${props.cachedTokens})`;
  }
  parts.push(promptPart);

  let completionPart = `Completion: ${props.completionTokens || 0}`;
  if (props.reasoningTokens) {
    completionPart += ` (Reasoning: ${props.reasoningTokens})`;
  }
  parts.push(completionPart);

  parts.push(`Total: ${props.totalTokens || 0}`);

  return parts.join(' | ');
}


/** Rendered lines of reasoning shown before the box stops growing and scrolls. */
const REASONING_COLLAPSED_LINES = 7;

function ReasoningBlock({ content }: { content: string }) {
    const [isExpanded, setIsExpanded] = useState(false);
    const [collapsedMaxHeight, setCollapsedMaxHeight] = useState<number | null>(null);
    const [canExpand, setCanExpand] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);
    const [userScrolled, setUserScrolled] = useState(false);

    // Measure the cap rather than hard-coding it, so it follows the type scale.
    useLayoutEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        const styles = getComputedStyle(el);
        const lineHeight = parseFloat(styles.lineHeight);
        if (!Number.isFinite(lineHeight)) return;
        // max-height covers the content box unless border-box is in effect
        const padding = styles.boxSizing === 'border-box'
            ? parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom)
            : 0;
        setCollapsedMaxHeight(Math.round(lineHeight * REASONING_COLLAPSED_LINES + padding));
    }, []);

    // Reasoning streams in, so re-check on every change whether it still fits.
    // Only meaningful while collapsed -- expanded, nothing ever overflows, so
    // the previous answer is kept and the Collapse button stays put.
    useEffect(() => {
        const el = scrollRef.current;
        if (!el || collapsedMaxHeight === null || isExpanded) return;
        setCanExpand(el.scrollHeight > el.clientHeight + 1);
    }, [content, collapsedMaxHeight, isExpanded]);

    // Follow the tail while collapsed, unless the user scrolled away from it
    useEffect(() => {
        if (!isExpanded && !userScrolled && scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [content, isExpanded, userScrolled]);

    const handleScroll = () => {
        if (scrollRef.current) {
            const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
            const isAtBottom = Math.abs(scrollHeight - scrollTop - clientHeight) < 10;
            setUserScrolled(!isAtBottom);
        }
    };

    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 text-xs font-medium text-purple-400 mb-1">
                <Brain size={13} />
                <span>Thinking Process</span>
            </div>

            <div
                ref={scrollRef}
                onScroll={handleScroll}
                // No fixed height: the box grows with the text and only caps once
                // it passes REASONING_COLLAPSED_LINES.
                style={{ maxHeight: isExpanded || collapsedMaxHeight === null ? undefined : collapsedMaxHeight }}
                className="bg-surface/30 p-3 rounded-lg text-text-muted text-xs custom-scrollbar overflow-y-auto"
            >
                <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkBreaks]}
                    components={{
                        code({node, inline, className, children, ...props}: any) {
                            const match = /language-(\w+)/.exec(className || '')
                            return !inline && match ? (
                            <div className="relative group/code my-2">
                                <pre className={clsx(className, "bg-elevated p-2 rounded-lg overflow-x-auto border border-border text-text-main")} {...props}>
                                    <code className={className} {...props}>
                                    {children}
                                    </code>
                                </pre>
                            </div>
                            ) : (
                            <code className={clsx(className, "bg-elevated px-1 py-0.5 rounded text-pink-300")} {...props}>
                                {children}
                            </code>
                            )
                        }
                    }}
                >
                    {content}
                </ReactMarkdown>
            </div>

            {canExpand && (
                <button
                    onClick={() => setIsExpanded(!isExpanded)}
                    className="self-start flex items-center gap-1.5 text-[10px] uppercase font-bold tracking-wider text-purple-400/70 hover:text-purple-400 transition-colors mt-1 px-1 py-0.5 rounded hover:bg-purple-500/10"
                >
                    {isExpanded ? (
                        <>
                            <Minimize2 size={10} />
                            Collapse
                        </>
                    ) : (
                        <>
                            <Maximize2 size={10} />
                            Expand
                        </>
                    )}
                </button>
            )}
        </div>
    );
}


export function MessageBubble({ role, content, reasoning, images, onEdit, promptTokens, completionTokens, reasoningTokens, cachedTokens, totalTokens }: MessageProps) {
  const [copied, setCopied] = useState(false);
  const [copiedPlain, setCopiedPlain] = useState(false);
  const [copiedRendered, setCopiedRendered] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyPlain = () => {
      if (contentRef.current) {
          navigator.clipboard.writeText(contentRef.current.innerText);
          setCopiedPlain(true);
          setTimeout(() => setCopiedPlain(false), 2000);
      }
  };

  const handleCopyRendered = async () => {
      if (contentRef.current) {
          try {
              const html = contentRef.current.innerHTML;
              const text = contentRef.current.innerText;
              
              const blobHtml = new Blob([html], { type: 'text/html' });
              const blobText = new Blob([text], { type: 'text/plain' });
              
              const data = [new ClipboardItem({ 
                  'text/html': blobHtml, 
                  'text/plain': blobText 
              })];
              await navigator.clipboard.write(data);
              
              setCopiedRendered(true);
              setTimeout(() => setCopiedRendered(false), 2000);
          } catch (err) {
              console.error('Failed to copy rendered:', err);
          }
      }
  };

  const isUser = role === 'user';

  return (
    <div className={clsx(
       "group flex gap-4 max-w-3xl mx-auto py-6 px-4",
       isUser ? "flex-row-reverse" : "flex-row"
    )}>
       {/* Avatar */}
       <div className={clsx(
           "w-8 h-8 flex items-center justify-center shrink-0 mt-1",
           isUser ? "bg-primary/20 text-primary rounded-full" : ""
       )}>
           {isUser ? <User size={16} /> : <TigiCat size={32} />}
       </div>

       {/* Content */}
       <div className={clsx("flex-1 min-w-0 space-y-2", isUser && "flex flex-col items-end")}>
           <div className={clsx("font-medium text-sm text-text-sec flex items-center gap-2", isUser && "flex-row-reverse text-right")}>
               <span>{isUser ? 'You' : 'Tigi'}</span>
           </div>

           {/* Images */}
           {images && images.length > 0 && (
               <div className="flex flex-wrap gap-2">
                   {images.map((img, i) => (
                       <img key={i} src={img} alt="User upload" className="max-w-[200px] rounded-lg border border-border" />
                   ))}
               </div>
           )}

           <div ref={contentRef} className={clsx(
               "prose prose-invert max-w-none text-sm leading-relaxed break-words text-text-main",
                isUser 
                  ? "bg-surface/50 px-4 py-3 rounded-2xl rounded-tr-sm border border-border" 
                  : "bg-transparent pl-0"
           )}>
                {/* Tool Output (Console Style) */}
                {role === 'tool' ? (
                    <ConsoleOutput content={content} />
                ) : (
                    <>
                    {/* DeepSeek Reasoning Block */}
                    {reasoning && !isUser && (
                        <div className="mb-4 border-l-2 border-purple-500/30 pl-3">
                            <ReasoningBlock content={reasoning} />
                        </div>
                    )}
                    
                    <ReactMarkdown 
                       remarkPlugins={[remarkGfm, remarkBreaks]}
                       components={{
                       code({node, inline, className, children, ...props}: any) {
                         const match = /language-(\w+)/.exec(className || '')
                         return !inline && match ? (
                           <div className="relative group/code my-4">
                               <div className="absolute right-2 top-2 opacity-0 group-hover/code:opacity-100 transition-opacity">
                                   <div className="text-xs text-text-muted">{match[1]}</div>
                               </div>
                               <pre className={clsx(className, "bg-elevated p-4 rounded-lg overflow-x-auto border border-border text-text-main")} {...props}>
                                 <code className={className} {...props}>
                                   {children}
                                 </code>
                               </pre>
                           </div>
                         ) : (
                           <code className={clsx(className, "bg-elevated px-1 py-0.5 rounded text-pink-300")} {...props}>
                             {children}
                           </code>
                         )
                       },
                       ul({node, className, children, ...props}: any) {
                         return <ul className={clsx(className, "list-disc pl-5 my-2 space-y-1")} {...props}>{children}</ul>
                       },
                       ol({node, className, children, ...props}: any) {
                         return <ol className={clsx(className, "list-decimal pl-5 my-2 space-y-1")} {...props}>{children}</ol>
                       },
                       li({node, className, children, ...props}: any) {
                         return <li className={clsx(className, "leading-relaxed")} {...props}>{children}</li>
                       },
                       p({node, className, children, ...props}: any) {
                         return <p className={clsx(className, "mb-4 last:mb-0")} {...props}>{children}</p>
                       },
                       a({node, className, children, ...props}: any) {
                         return (
                           <a 
                             className={clsx(className, "text-blue-500 hover:text-blue-400 underline")} 
                             target="_blank" 
                             rel="noopener noreferrer" 
                             {...props}
                           >
                             {children}
                           </a>
                         )
                       }
                   }}
                >
                  {content}
                </ReactMarkdown>
                </>
               )}
           </div>
           
           {/* Actions */}
           <div className={clsx(
               "flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity",
               isUser && "justify-end"
           )}>
               {/* Copy Markdown (Original) */}
               <button 
                 onClick={handleCopy}
                 className="p-1.5 text-text-muted hover:text-text-main transition-colors rounded hover:bg-surface flex items-center gap-1"
                 title="Copy Markdown"
               >
                   {copied ? <Check size={14} /> : <Copy size={14} />}
                   <span className="text-[10px]">MD</span>
               </button>

               {/* Copy Plain Text */}
               <button 
                 onClick={handleCopyPlain}
                 className="p-1.5 text-text-muted hover:text-text-main transition-colors rounded hover:bg-surface flex items-center gap-1"
                 title="Copy Plain Text"
               >
                   {copiedPlain ? <Check size={14} /> : <FileText size={14} />}
                   <span className="text-[10px]">TXT</span>
               </button>

               {/* Copy Rendered */}
               <button 
                 onClick={handleCopyRendered}
                 className="p-1.5 text-text-muted hover:text-text-main transition-colors rounded hover:bg-surface flex items-center gap-1"
                 title="Copy Rich Text (for Word/Docs)"
               >
                   {copiedRendered ? <Check size={14} /> : <Monitor size={14} />}
                   <span className="text-[10px]">Rich</span>
               </button>

               {/* Token Stats */}
               {!isUser && (totalTokens ?? 0) > 0 && (
                   <div
                     className="p-1.5 text-text-muted hover:text-text-main transition-colors rounded hover:bg-surface flex items-center gap-1 cursor-default"
                     title={formatTokenTooltip({ promptTokens, completionTokens, reasoningTokens, cachedTokens, totalTokens })}
                   >
                       <Activity size={14} />
                       <span className="text-[10px]">Token</span>
                   </div>
               )}

               {/* Edit Button */}
               {isUser && onEdit && (
                   <button 
                       onClick={() => onEdit(content)}
                       className="p-1.5 text-text-muted hover:text-primary transition-colors rounded hover:bg-surface flex items-center gap-1"
                       title="Edit"
                   >
                       <Pencil size={14} />
                       <span className="text-[10px]">Edit</span>
                   </button>
               )}
           </div>
       </div>
    </div>
  );
}
