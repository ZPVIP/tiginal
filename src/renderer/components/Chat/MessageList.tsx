import React, { useRef, useEffect } from 'react';
import { MessageBubble } from './MessageBubble';
import { ToolApprovalRequest } from './ToolApprovalRequest';
import { Folder } from 'lucide-react';

interface Message {
    id: string;
    role: 'user' | 'assistant' | 'tool' | 'tool-request';
    content: string;
    reasoning?: string;
    images?: string[];
    tool_call_id?: string;
    approvalData?: {
        id: string;
        name: string;
        command: string;
        description?: string;
        riskLevel?: 'safe' | 'low' | 'medium' | 'high';
        status: 'pending' | 'approved' | 'denied' | 'auto-approved';
        skillPath?: string;
    };
}

interface MessageListProps {
    messages: Message[];
    isStreaming?: boolean;
    onEdit?: (content: string) => void;
    onApproval?: (id: string, decision: 'approved' | 'denied' | 'always') => void;
}

export function MessageList({ messages, isStreaming, onEdit, onApproval }: MessageListProps) {
    const bottomRef = useRef<HTMLDivElement>(null);
    // Helper to open folder
    const handleOpenFolder = (path: string) => {
        (window as any).electron?.invoke('shell:show-item-in-folder', path);
    };

    useEffect(() => {
        // Use 'auto' behavior during streaming for instant updates, 'smooth' otherwise
        bottomRef.current?.scrollIntoView({ behavior: 'auto' });
    }, [messages, isStreaming]);

    if (messages.length === 0) return null;

    return (
        <div className="flex-1 overflow-y-auto custom-scrollbar">
            {messages.map(msg => {
                if (msg.role === 'tool-request' && msg.approvalData) {
                    if (msg.approvalData.status === 'pending') {
                        return (
                            <div key={msg.id} className="mx-auto max-w-3xl px-4 py-2 flex gap-4">
                                <div className="w-8 shrink-0" /> {/* Spacer for Avatar alignment */}
                                <div className="flex-1 min-w-0">
                                    <ToolApprovalRequest 
                                        name={msg.approvalData.name}
                                        command={msg.approvalData.command}
                                        description={msg.approvalData.description}
                                        riskLevel={msg.approvalData.riskLevel}
                                        onAllow={() => onApproval?.(msg.id, 'approved')}
                                        onAllowAll={() => onApproval?.(msg.id, 'always')}
                                        onDeny={() => onApproval?.(msg.id, 'denied')}
                                    />
                                </div>
                            </div>
                        );
                     } else {
                         return (
                            <div key={msg.id} className="mx-auto max-w-3xl px-4 py-2 flex gap-4">
                                <div className="w-8 shrink-0" /> {/* Spacer for Avatar alignment */}
                                <div className="flex-1 min-w-0">
                                    <div className="rounded-lg bg-[#1e1e1e] border border-white/10 overflow-hidden">
                                        {/* Status Header */}
                                        <div className="flex items-center justify-between p-2 pl-3 bg-white/5 border-b border-white/5">
                                            <div className="flex items-center gap-2 text-xs text-text-muted">
                                                <span>Tool Execution:</span>
                                                <span className="font-mono text-text-main">{msg.approvalData.name}</span>
                                            </div>
                                            <span className={`font-bold uppercase text-[10px] tracking-wider px-2 py-0.5 rounded ${
                                                msg.approvalData.status.includes('approved') 
                                                    ? "bg-green-500/10 text-green-400" 
                                                    : "bg-red-500/10 text-red-400"
                                            }`}>
                                                {msg.approvalData.status}
                                            </span>
                                        </div>
                                        
                                        {/* Skill Path (if available) */}
                                        {msg.approvalData.skillPath && (
                                            <div className="flex items-center gap-2 px-3 py-2 bg-black/20 border-b border-white/5">
                                                <button 
                                                    onClick={() => handleOpenFolder(msg.approvalData!.skillPath!)}
                                                    className="p-1 hover:bg-white/10 rounded-md transition-colors text-blue-400"
                                                    title="Open in Folder"
                                                >
                                                    <Folder size={14} />
                                                </button>
                                                <div className="font-mono text-[10px] text-gray-400 break-all">
                                                    {msg.approvalData.skillPath}
                                                </div>
                                            </div>
                                        )}

                                        {/* Command / Input Details */}
                                        <div className="p-3 font-mono text-xs text-text-sec whitespace-pre-wrap overflow-x-auto bg-black/20">
                                            {msg.approvalData.command}
                                        </div>
                                    </div>
                                </div>
                            </div>
                         );
                    }
                }

                return (
                <MessageBubble 
                   key={msg.id}
                   role={msg.role as any}
                   content={msg.content}
                   reasoning={msg.reasoning}
                   images={msg.images}
                   onEdit={onEdit}
                />
            )})}
            
            {isStreaming && (
                <div className="max-w-3xl mx-auto px-4 py-2">
                   <div className="flex gap-1">
                       <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                       <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                       <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce"></div>
                   </div>
                </div>
            )}
            <div ref={bottomRef} className="h-4" />
        </div>
    );
}
