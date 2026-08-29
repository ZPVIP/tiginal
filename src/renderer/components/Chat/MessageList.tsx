import React, { useRef, useEffect, useState } from 'react';
import { MessageBubble } from './MessageBubble';
import { ToolApprovalRequest } from './ToolApprovalRequest';
import { Folder } from 'lucide-react';
import {
    formatMessageTimestamp,
    parseDateFormat,
    parseTimeZonePreference,
    type DateFormat,
    type TimeZonePreference,
} from '../../../shared/date-time';

const invoke = window.electron?.invoke || (async () => {});

interface Message {
    id: string;
    role: 'user' | 'assistant' | 'tool' | 'tool-request';
    content: string;
    createdAt?: number;
    reasoning?: string;
    images?: string[];
    tool_call_id?: string;
    promptTokens?: number;
    completionTokens?: number;
    reasoningTokens?: number;
    cachedTokens?: number;
    cacheStatus?: 'hit' | 'miss' | 'unknown';
    titleTokens?: number;
    totalTokens?: number;
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
    const [dateFormat, setDateFormat] = useState<DateFormat>('iso');
    const [timeZone, setTimeZone] = useState<TimeZonePreference>({ kind: 'system' });
    // Helper to open folder
    const handleOpenFolder = (path: string) => {
        (window as any).electron?.invoke('shell:show-item-in-folder', path);
    };

    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const isAtBottomRef = useRef(true);

    useEffect(() => {
        let active = true;
        const loadDateTimeSettings = async () => {
            try {
                const [savedDateFormat, savedTimeZone] = await Promise.all([
                    invoke('settings:get', 'dateFormat'),
                    invoke('settings:get', 'timeZone'),
                ]);
                if (!active) return;
                setDateFormat(parseDateFormat(savedDateFormat));
                setTimeZone(parseTimeZonePreference(savedTimeZone));
            } catch (error) {
                console.error('Failed to load message timestamp settings', error);
            }
        };

        const handleSettingsUpdate = () => {
            void loadDateTimeSettings();
        };

        void loadDateTimeSettings();
        window.addEventListener('settings-general-updated', handleSettingsUpdate);
        return () => {
            active = false;
            window.removeEventListener('settings-general-updated', handleSettingsUpdate);
        };
    }, []);

    const getMessageTimestamp = (message: Message): string => (
        message.createdAt === undefined
            ? ''
            : formatMessageTimestamp(message.createdAt, dateFormat, timeZone)
    );

    // Initial scroll to bottom
    useEffect(() => {
        if (bottomRef.current) {
            bottomRef.current.scrollIntoView({ behavior: 'auto' });
        }
    }, []);

    const handleScroll = () => {
        if (!scrollContainerRef.current) return;
        
        const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
        // Check if user is near the bottom (within 100px)
        const isAtBottom = scrollHeight - scrollTop - clientHeight < 100;
        isAtBottomRef.current = isAtBottom;
    };

    useEffect(() => {
        // Only auto-scroll if we're already at the bottom
        if (isAtBottomRef.current) {
            bottomRef.current?.scrollIntoView({ behavior: 'auto' });
        }
    }, [messages, isStreaming]);

    if (messages.length === 0) return null;

    return (
        <div 
            ref={scrollContainerRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto custom-scrollbar"
        >
            {messages.map(msg => {
                const timestamp = getMessageTimestamp(msg);
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
                                    {timestamp && (
                                        <time className="block mt-1 text-right text-[10px] font-mono text-text-muted">
                                            {timestamp}
                                        </time>
                                    )}
                                </div>
                            </div>
                        );
                     } else {
                         return (
                            <div key={msg.id} className="mx-auto max-w-3xl px-4 py-2 flex gap-4">
                                <div className="w-8 shrink-0" /> {/* Spacer for Avatar alignment */}
                                <div className="flex-1 min-w-0">
                                    <div className="rounded-lg bg-surface border border-border overflow-hidden">
                                        {/* Status Header */}
                                        <div className="flex items-center justify-between p-2 pl-3 bg-surface-light/50 border-b border-border">
                                            <div className="flex items-center gap-2 text-xs text-text-muted">
                                                <span>Tool Execution:</span>
                                                <span className="font-mono font-medium text-accent-tool">{msg.approvalData.name}</span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {timestamp && <time className="font-mono text-[10px] text-text-muted">{timestamp}</time>}
                                                <span className={`font-bold uppercase text-[10px] tracking-wider px-2 py-0.5 rounded ${
                                                    msg.approvalData.status.includes('approved')
                                                        ? "bg-accent-success/15 text-accent-success"
                                                        : "bg-accent-danger/15 text-accent-danger"
                                                }`}>
                                                    {msg.approvalData.status}
                                                </span>
                                            </div>
                                        </div>
                                        
                                        {/* Skill Path (if available) */}
                                        {msg.approvalData.skillPath && (
                                            <div className="flex items-center gap-2 px-3 py-2 bg-background/60 border-b border-border">
                                                <button
                                                    onClick={() => handleOpenFolder(msg.approvalData!.skillPath!)}
                                                    className="p-1 hover:bg-surface-hover rounded-md transition-colors text-accent-info"
                                                    title="Open in Folder"
                                                >
                                                    <Folder size={14} />
                                                </button>
                                                <div className="font-mono text-[10px] text-text-sec break-all">
                                                    {msg.approvalData.skillPath}
                                                </div>
                                            </div>
                                        )}

                                        {/* Command / Input Details */}
                                        <div className="p-3 font-mono text-xs text-text-main whitespace-pre-wrap overflow-x-auto bg-background/60">
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
                   timestamp={timestamp}
                   reasoning={msg.reasoning}
                   images={msg.images}
                   onEdit={onEdit}
                   promptTokens={msg.promptTokens}
                   completionTokens={msg.completionTokens}
                   reasoningTokens={msg.reasoningTokens}
                   cachedTokens={msg.cachedTokens}
                   cacheStatus={msg.cacheStatus}
                   titleTokens={msg.titleTokens}
                   totalTokens={msg.totalTokens}
                />
            )})}
            
            {isStreaming && (
                <div className="max-w-3xl mx-auto px-4 py-2">
                   <div className="flex gap-1">
                       <div className="w-2 h-2 bg-text-muted rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                       <div className="w-2 h-2 bg-text-muted rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                       <div className="w-2 h-2 bg-text-muted rounded-full animate-bounce"></div>
                   </div>
                </div>
            )}
            <div ref={bottomRef} className="h-4" />
        </div>
    );
}
