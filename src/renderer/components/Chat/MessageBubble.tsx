import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { clsx } from 'clsx';
import { User, Copy, Check, ChevronDown, ChevronRight, BrainCircuit } from 'lucide-react';
import { TigiCat } from '../icons/TigiCat';

interface MessageProps {
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string; // For DeepSeek reasoning block
  images?: string[];
}

export function MessageBubble({ role, content, reasoning, images }: MessageProps) {
  const [copied, setCopied] = useState(false);
  const [reasoningOpen, setReasoningOpen] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
           <div className={clsx("font-medium text-sm text-gray-400", isUser && "text-right")}>
               {isUser ? 'You' : 'Tigi'}
           </div>

           {/* Images */}
           {images && images.length > 0 && (
               <div className="flex flex-wrap gap-2">
                   {images.map((img, i) => (
                       <img key={i} src={img} alt="User upload" className="max-w-[200px] rounded-lg border border-border" />
                   ))}
               </div>
           )}

           <div className={clsx(
               "prose prose-invert max-w-none text-sm leading-relaxed break-words",
                isUser 
                  ? "bg-surface/50 px-4 py-3 rounded-2xl rounded-tr-sm border border-border" 
                  : "bg-transparent pl-0"
           )}>
               {/* DeepSeek Reasoning Block */}
               {reasoning && !isUser && (
                   <div className="mb-4 border-l-2 border-purple-500/30 pl-3">
                       <button 
                         onClick={() => setReasoningOpen(!reasoningOpen)}
                         className="flex items-center gap-2 text-xs font-medium text-purple-400 hover:text-purple-300 transition-colors mb-1"
                       >
                           <BrainCircuit size={12} />
                           {reasoningOpen ? 'Hide Reasoning' : 'Show Reasoning'}
                           {reasoningOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                       </button>
                       {reasoningOpen && (
                           <div className="text-gray-400 text-xs italic bg-surface/30 p-2 rounded animate-in fade-in slide-in-from-top-1">
                               {reasoning}
                           </div>
                       )}
                   </div>
               )}

               <ReactMarkdown 
                  remarkPlugins={[remarkGfm]}
                  components={{
                      code({node, inline, className, children, ...props}: any) {
                        const match = /language-(\w+)/.exec(className || '')
                        return !inline && match ? (
                          <div className="relative group/code my-4">
                              <div className="absolute right-2 top-2 opacity-0 group-hover/code:opacity-100 transition-opacity">
                                  <div className="text-xs text-gray-400">{match[1]}</div>
                              </div>
                              <pre className={clsx(className, "bg-[#0d1117] p-4 rounded-lg overflow-x-auto border border-border")} {...props}>
                                <code className={className} {...props}>
                                  {children}
                                </code>
                              </pre>
                          </div>
                        ) : (
                          <code className={clsx(className, "bg-white/10 px-1 py-0.5 rounded text-pink-300")} {...props}>
                            {children}
                          </code>
                        )
                      }
                  }}
               >
                 {content}
               </ReactMarkdown>
           </div>
           
           {/* Actions */}
           {!isUser && (
               <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                   <button 
                     onClick={handleCopy}
                     className="p-1.5 text-gray-500 hover:text-gray-300 transition-colors rounded hover:bg-surface"
                     title="Copy"
                   >
                       {copied ? <Check size={14} /> : <Copy size={14} />}
                   </button>
               </div>
           )}
       </div>
    </div>
  );
}
