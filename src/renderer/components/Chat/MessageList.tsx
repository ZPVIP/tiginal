import React, { useRef, useEffect } from 'react';
import { MessageBubble } from './MessageBubble';

interface Message {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    reasoning?: string;
    images?: string[];
}

interface MessageListProps {
    messages: Message[];
    isStreaming?: boolean;
    onEdit?: (content: string) => void;
}

export function MessageList({ messages, isStreaming, onEdit }: MessageListProps) {
    const bottomRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        // Use 'auto' behavior during streaming for instant updates, 'smooth' otherwise
        bottomRef.current?.scrollIntoView({ behavior: 'auto' });
    }, [messages, isStreaming]);

    if (messages.length === 0) return null;

    return (
        <div className="flex-1 overflow-y-auto custom-scrollbar">
            {messages.map(msg => (
                <MessageBubble 
                   key={msg.id}
                   role={msg.role}
                   content={msg.content}
                   reasoning={msg.reasoning}
                   images={msg.images}
                   onEdit={onEdit}
                />
            ))}
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
