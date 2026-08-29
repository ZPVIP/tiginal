import React, { useState, useEffect } from 'react';
import { X, ChevronLeft, ChevronRight, MessageSquare, Trash2, Clock, Calendar } from 'lucide-react';
import { clsx } from 'clsx';
import {
  formatTimestamp,
  parseDateFormat,
  parseTimeZonePreference,
  type DateFormat,
  type TimeZonePreference,
} from '../../../shared/date-time';

const invoke = window.electron?.invoke || (async () => {});

interface Conversation {
  id: string;
  title: string | null;
  providerId: string | null;
  createdAt: number;
  updatedAt: number;
}

interface HistoryPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectConversation: (id: string) => void;
}

const PAGE_SIZE = 10;

export function HistoryPanel({ isOpen, onClose, onSelectConversation }: HistoryPanelProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [page, setPage] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [dateFormat, setDateFormat] = useState<DateFormat>('iso');
  const [timeZone, setTimeZone] = useState<TimeZonePreference>({ kind: 'system' });
  const [sortBy, setSortBy] = useState<'updatedAt' | 'createdAt'>('updatedAt');

  useEffect(() => {
    if (isOpen) {
      loadSettings();
      loadConversations();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleSettingsUpdate = () => {
      loadSettings();
      loadConversations();
    };
    window.addEventListener('settings-general-updated', handleSettingsUpdate);
    return () => window.removeEventListener('settings-general-updated', handleSettingsUpdate);
  }, [isOpen]);

  const loadSettings = async () => {
    try {
      const savedDateFormat = await invoke('settings:get', 'dateFormat');
      const savedTimeZone = await invoke('settings:get', 'timeZone');
      const savedHistorySort = await invoke('settings:get', 'historySort');
      setDateFormat(parseDateFormat(savedDateFormat));
      setTimeZone(parseTimeZonePreference(savedTimeZone));
      if (savedHistorySort) setSortBy(savedHistorySort as 'updatedAt' | 'createdAt');
    } catch (err) {
      console.error('Failed to load settings', err);
    }
  };

  const loadConversations = async () => {
    setIsLoading(true);
    try {
      const list = await invoke('chat:get-conversations');
      setConversations(list || []);
    } catch (err) {
      console.error('Failed to load conversations', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Delete this conversation?')) return;
    await invoke('chat:delete-conversation', id);
    loadConversations();
  };

  // Sort conversations based on setting
  const sortedConversations = [...conversations].sort((a, b) => {
    return b[sortBy] - a[sortBy];
  });

  const totalPages = Math.ceil(sortedConversations.length / PAGE_SIZE);
  const pagedConversations = sortedConversations.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  if (!isOpen) return null;

  return (
    <div className="absolute inset-0 bg-background/95 backdrop-blur-sm z-40 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <h2 className="text-lg font-semibold text-text-main">Chat History</h2>
        <button onClick={onClose} className="p-2 text-text-muted hover:text-text-main hover:bg-surface-hover rounded-lg">
          <X size={20} />
        </button>
      </div>

      {/* Pagination (if needed) */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 p-2 border-b border-border text-sm">
          <button 
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            className="p-1 text-text-muted hover:text-text-main disabled:opacity-30"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="text-text-sec">
            Page {page + 1} of {totalPages}
          </span>
          <button 
            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="p-1 text-text-muted hover:text-text-main disabled:opacity-30"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto p-2">
        {isLoading ? (
          <div className="text-center text-text-muted py-8">Loading...</div>
        ) : conversations.length === 0 ? (
          <div className="text-center text-text-muted py-8">No conversations yet</div>
        ) : (
          <div className="space-y-1">
            {pagedConversations.map(conv => (
              <div
                key={conv.id}
                onClick={() => onSelectConversation(conv.id)}
                className="flex items-start gap-3 p-3 rounded-lg hover:bg-surface-hover cursor-pointer group"
              >
                <MessageSquare size={16} className="text-text-muted shrink-0 mt-1" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-text-main truncate mb-1.5">
                    {conv.title || 'Untitled Conversation'}
                  </div>
                  {/* Two dates with icons - monospace */}
                  <div className="flex flex-col gap-0.5 text-xs font-mono text-text-muted">
                    <div className="flex items-center gap-1.5">
                      <Calendar size={10} className="shrink-0" />
                      <span>Created: {formatTimestamp(conv.createdAt, dateFormat, timeZone)}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Clock size={10} className="shrink-0" />
                      <span>Updated: {formatTimestamp(conv.updatedAt, dateFormat, timeZone)}</span>
                    </div>
                  </div>
                </div>
                <button
                  onClick={(e) => handleDelete(conv.id, e)}
                  className="p-1.5 text-text-muted hover:text-red-400 hover:bg-surface-hover rounded opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
