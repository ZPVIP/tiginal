import React, { useState, useEffect, useCallback } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { clsx } from 'clsx';
import { ConversationItem } from './ConversationItem';
import { Pagination } from './Pagination';
import { ConversationData, useDrawerContext } from './Drawer';

const invoke = window.electron?.invoke || (async () => {});

const PAGE_SIZE = 5;

export function FavoriteSection() {
  const { currentConversationId, onSelectConversation, favoritesRefreshKey, sortBy } = useDrawerContext();
  const [isExpanded, setIsExpanded] = useState(true);
  const [favorites, setFavorites] = useState<ConversationData[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);

  const loadFavorites = useCallback(async () => {
    try {
      const result = await invoke('chat:get-favorite-conversations', page, PAGE_SIZE, sortBy);
      setFavorites(result.items || []);
      setTotal(result.total || 0);
    } catch (e) {
      console.error('Failed to load favorites:', e);
    }
  }, [page, sortBy]);

  useEffect(() => {
    loadFavorites();
  }, [loadFavorites, favoritesRefreshKey]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="border-b border-border">
      {/* Header - style matches CATEGORIES exactly */}
      <div
        className="flex items-center px-3 py-2 cursor-pointer hover:bg-elevated transition-colors h-8"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <span className="text-xs font-medium text-text-muted uppercase tracking-wider flex-1">
          FAVORITES {total > 0 && `(${total})`}
        </span>
        {isExpanded ? (
          <ChevronDown size={14} className="text-text-muted" />
        ) : (
          <ChevronRight size={14} className="text-text-muted" />
        )}
      </div>

      {/* Content */}
      {isExpanded && total > 0 && (
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
