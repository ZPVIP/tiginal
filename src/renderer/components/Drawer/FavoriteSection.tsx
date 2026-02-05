import React, { useState, useEffect, useCallback } from 'react';
import { ChevronDown, ChevronRight, Star } from 'lucide-react';
import { clsx } from 'clsx';
import { ConversationItem } from './ConversationItem';
import { Pagination } from './Pagination';
import { ConversationData, useDrawerContext } from './Drawer';

const invoke = window.electron?.invoke || (async () => {});

const PAGE_SIZE = 10;

export function FavoriteSection() {
  const { currentConversationId, onSelectConversation } = useDrawerContext();
  const [isExpanded, setIsExpanded] = useState(true);
  const [favorites, setFavorites] = useState<ConversationData[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);

  const loadFavorites = useCallback(async () => {
    try {
      const result = await invoke('chat:get-favorite-conversations', page, PAGE_SIZE);
      setFavorites(result.items || []);
      setTotal(result.total || 0);
    } catch (e) {
      console.error('Failed to load favorites:', e);
    }
  }, [page]);

  useEffect(() => {
    loadFavorites();
  }, [loadFavorites]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  if (total === 0) return null;

  return (
    <div className="border-b border-border-subtle">
      {/* Header */}
      <div
        className="flex items-center gap-1 px-2 py-1.5 cursor-pointer hover:bg-bg-secondary/50 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {isExpanded ? (
          <ChevronDown size={14} className="text-text-muted flex-shrink-0" />
        ) : (
          <ChevronRight size={14} className="text-text-muted flex-shrink-0" />
        )}
        <Star size={14} className="text-yellow-400 flex-shrink-0" />
        <span className="text-xs font-medium text-text-secondary truncate flex-1">
          Favorites
        </span>
        <span className="text-xs text-text-muted">{total}</span>
      </div>

      {/* Content */}
      {isExpanded && (
        <div className="pb-1">
          {favorites.map((conv) => (
            <ConversationItem
              key={conv.id}
              conversation={conv}
              isSelected={conv.id === currentConversationId}
              onSelect={() => onSelectConversation(conv.id)}
              onRefresh={loadFavorites}
              showFavoriteOption={false}
            />
          ))}

          {/* Pagination */}
          {totalPages > 1 && (
            <Pagination
              currentPage={page}
              totalPages={totalPages}
              onPageChange={setPage}
            />
          )}
        </div>
      )}
    </div>
  );
}
