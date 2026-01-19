import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { clsx } from 'clsx';
import { User, Copy, Check, ChevronDown, ChevronRight, BrainCircuit, Maximize2, Minimize2, Pencil, FileText, Monitor, Smartphone } from 'lucide-react';
import { TigiCat } from '../icons/TigiCat';
import { useEffect, useRef } from 'react';

interface MessageProps {
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string; // For DeepSeek reasoning block
  images?: string[];
  onEdit?: (content: string) => void;
}

function ReasoningBlock({ content }: { content: string }) {
    const [isExpanded, setIsExpanded] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);
    const [userScrolled, setUserScrolled] = useState(false);

    // Auto-scroll to bottom if not expanded and not paused by user scroll
    useEffect(() => {
        if (!isExpanded && !userScrolled && scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [content, isExpanded, userScrolled]);

    const handleScroll = () => {
        if (scrollRef.current) {
            const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
            const isAtBottom = Math.abs(scrollHeight - scrollTop - clientHeight) < 10;
            if (!isAtBottom) {
                setUserScrolled(true);
            } else {
                setUserScrolled(false);
            }
        }
    };

    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 text-xs font-medium text-purple-400 mb-1">
                <BrainCircuit size={12} />
                <span>Thinking Process</span>
            </div>
            
            <div 
                ref={scrollRef}
                onScroll={handleScroll}
                className={clsx(
                    "bg-surface/30 p-3 rounded-lg text-gray-400 text-xs custom-scrollbar transition-all duration-300",
                    isExpanded ? "h-auto max-h-none" : "h-32 overflow-y-auto"
                )}
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
        </div>
    );
}


export function MessageBubble({ role, content, reasoning, images, onEdit }: MessageProps) {
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
           <div className={clsx("font-medium text-sm text-gray-400 flex items-center gap-2", isUser && "flex-row-reverse text-right")}>
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
               "prose prose-invert max-w-none text-sm leading-relaxed break-words",
                isUser 
                  ? "bg-surface/50 px-4 py-3 rounded-2xl rounded-tr-sm border border-border" 
                  : "bg-transparent pl-0"
           )}>
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
                                   <div className="text-xs text-gray-400">{match[1]}</div>
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
           </div>
           
           {/* Actions */}
           <div className={clsx(
               "flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity",
               isUser && "justify-end"
           )}>
               {/* Copy Markdown (Original) */}
               <button 
                 onClick={handleCopy}
                 className="p-1.5 text-gray-500 hover:text-gray-300 transition-colors rounded hover:bg-surface flex items-center gap-1"
                 title="Copy Markdown"
               >
                   {copied ? <Check size={14} /> : <Copy size={14} />}
                   <span className="text-[10px]">MD</span>
               </button>

               {/* Copy Plain Text */}
               <button 
                 onClick={handleCopyPlain}
                 className="p-1.5 text-gray-500 hover:text-gray-300 transition-colors rounded hover:bg-surface flex items-center gap-1"
                 title="Copy Plain Text"
               >
                   {copiedPlain ? <Check size={14} /> : <FileText size={14} />}
                   <span className="text-[10px]">TXT</span>
               </button>

               {/* Copy Rendered */}
               <button 
                 onClick={handleCopyRendered}
                 className="p-1.5 text-gray-500 hover:text-gray-300 transition-colors rounded hover:bg-surface flex items-center gap-1"
                 title="Copy Rich Text (for Word/Docs)"
               >
                   {copiedRendered ? <Check size={14} /> : <Monitor size={14} />}
                   <span className="text-[10px]">Rich</span>
               </button>

               {/* Edit Button */}
               {isUser && onEdit && (
                   <button 
                       onClick={() => onEdit(content)}
                       className="p-1.5 text-gray-500 hover:text-primary transition-colors rounded hover:bg-surface flex items-center gap-1"
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
