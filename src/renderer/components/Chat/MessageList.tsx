import React, { useRef, useEffect } from 'react';
import { MessageBubble } from './MessageBubble';
import { ToolApprovalRequest } from './ToolApprovalRequest';

interface Message {
    id: string;
    role: 'user' | 'assistant' | 'tool';
    content: string;
    reasoning?: string;
    images?: string[];
    tool_call_id?: string;
}

interface MessageListProps {
    messages: Message[];
    isStreaming?: boolean;
    onEdit?: (content: string) => void;
    pendingToolCall?: {
        name: string;
        input: any;
        description?: string;
        riskLevel?: 'safe' | 'low' | 'medium' | 'high';
        onAllow: () => void;
        onAllowAll: () => void;
        onDeny: () => void;
    };
}

export function MessageList({ messages, isStreaming, onEdit, pendingToolCall, onApproval }: MessageListProps) {
    console.log('MessageList render, pendingToolCall:', pendingToolCall);
    const bottomRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        // Use 'auto' behavior during streaming for instant updates, 'smooth' otherwise
        bottomRef.current?.scrollIntoView({ behavior: 'auto' });
    }, [messages, isStreaming, pendingToolCall]);

    if (messages.length === 0) return null;

    return (
        <div className="flex-1 overflow-y-auto custom-scrollbar">
            {messages.map(msg => {
                if (msg.role === 'tool-request' && msg.approvalData) {
                    if (msg.approvalData.status === 'pending') {
                        return (
                            <ToolApprovalRequest 
                                key={msg.id}
                                name={msg.approvalData.name}
                                command={msg.approvalData.command}
                                description={msg.approvalData.description}
                                riskLevel={msg.approvalData.riskLevel}
                                onAllow={() => onApproval?.(msg.id, 'approved')}
                                onAllowAll={() => onApproval?.(msg.id, 'always')}
                                onDeny={() => onApproval?.(msg.id, 'denied')}
                            />
                        );
                    } else {
                         return (
                            <div key={msg.id} className="mx-auto max-w-3xl px-4 py-2 opacity-75 flex gap-4">
                                <div className="w-8 shrink-0" /> {/* Spacer for Avatar alignment */}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between p-3 rounded-lg bg-[#1e1e1e] border border-white/10">
                                        <div className="flex items-center gap-2 text-sm">
                                            <span className="text-gray-400">Tool Request:</span>
                                            <span className="font-mono text-gray-200">{msg.approvalData.name}</span>
                                        </div>
                                        <span className={`font-bold uppercase text-[10px] tracking-wider px-2 py-1 rounded ${
                                            msg.approvalData.status.includes('approved') 
                                                ? "bg-green-500/20 text-green-400" 
                                                : "bg-red-500/20 text-red-400"
                                        }`}>
                                            {msg.approvalData.status}
                                        </span>
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
