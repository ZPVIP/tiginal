import React, { useState, useEffect } from 'react';
import { X, ChevronLeft, ChevronRight, MessageSquare, Trash2 } from 'lucide-react';
import { clsx } from 'clsx';

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

  useEffect(() => {
    if (isOpen) {
      loadConversations();
    }
  }, [isOpen]);

  const loadConversations = async () => {
    setIsLoading(true);
    try {
      const list = await invoke('chat:get-conversations');
      // Sort by updated_at descending
      const sorted = (list || []).sort((a: Conversation, b: Conversation) => b.updatedAt - a.updatedAt);
      setConversations(sorted);
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

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const totalPages = Math.ceil(conversations.length / PAGE_SIZE);
  const pagedConversations = conversations.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  if (!isOpen) return null;

  return (
    <div className="absolute inset-0 bg-background/95 backdrop-blur-sm z-40 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <h2 className="text-lg font-semibold text-white">Chat History</h2>
        <button onClick={onClose} className="p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg">
          <X size={20} />
        </button>
      </div>

      {/* Pagination (if needed) */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 p-2 border-b border-border text-sm">
          <button 
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            className="p-1 text-gray-400 hover:text-white disabled:opacity-30"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="text-gray-300">
            Page {page + 1} of {totalPages}
          </span>
          <button 
            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="p-1 text-gray-400 hover:text-white disabled:opacity-30"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto p-2">
        {isLoading ? (
          <div className="text-center text-gray-500 py-8">Loading...</div>
        ) : conversations.length === 0 ? (
          <div className="text-center text-gray-500 py-8">No conversations yet</div>
        ) : (
          <div className="space-y-1">
            {pagedConversations.map(conv => (
              <div
                key={conv.id}
                onClick={() => onSelectConversation(conv.id)}
                className="flex items-center gap-3 p-3 rounded-lg hover:bg-white/5 cursor-pointer group"
              >
                <MessageSquare size={16} className="text-gray-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-gray-200 truncate">
                    {conv.title || 'Untitled Conversation'}
                  </div>
                  <div className="text-xs text-gray-500">
                    {formatDate(conv.updatedAt)}
                  </div>
                </div>
                <button
                  onClick={(e) => handleDelete(conv.id, e)}
                  className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-white/10 rounded opacity-0 group-hover:opacity-100 transition-opacity"
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
