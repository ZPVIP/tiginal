import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ChevronDown, ChevronRight, MoreHorizontal, Pin, Edit2, Trash2, FolderOpen, Check } from 'lucide-react';
import { clsx } from 'clsx';
import { ConversationItem } from './ConversationItem';
import { Pagination } from './Pagination';
import { RenameCategoryDialog } from './dialogs/RenameCategoryDialog';
import { CategoryData, ConversationData, useDrawerContext } from './Drawer';

const invoke = window.electron?.invoke || (async () => {});

const PAGE_SIZE = 15;

interface CategoryItemProps {
  category: CategoryData;
}

export function CategoryItem({ category }: CategoryItemProps) {
  const { currentConversationId, onSelectConversation, refreshCategories, conversationsRefreshKey, sortBy } = useDrawerContext();
  const [isExpanded, setIsExpanded] = useState(category.isExpanded);
  const [conversations, setConversations] = useState<ConversationData[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [showMenu, setShowMenu] = useState(false);
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Sync local expanded state when category prop changes (e.g. after setCurrentCategory)
  useEffect(() => {
    setIsExpanded(category.isExpanded);
  }, [category.isExpanded]);

  const loadConversations = useCallback(async () => {
    if (!isExpanded) return;
    try {
      const result = await invoke('chat:get-conversations-by-category', category.id, page, PAGE_SIZE, sortBy);
      setConversations(result.items || []);
      setTotal(result.total || 0);
    } catch (e) {
      console.error('Failed to load conversations:', e);
    }
  }, [category.id, page, isExpanded, sortBy, conversationsRefreshKey]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    if (showMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMenu]);

  const handleToggleExpanded = async () => {
    const newExpanded = !isExpanded;
    setIsExpanded(newExpanded);
    try {
      await invoke('chat:toggle-category-expanded', category.id, newExpanded);
    } catch (e) {
      console.error('Failed to toggle expanded:', e);
    }
  };

  const handleTogglePinned = async () => {
    try {
      await invoke('chat:toggle-category-pinned', category.id, !category.isPinned);
      await refreshCategories();
      setShowMenu(false);
    } catch (e) {
      console.error('Failed to toggle pinned:', e);
    }
  };

  const handleRename = async (newName: string) => {
    try {
      await invoke('chat:update-category', category.id, newName);
      await refreshCategories();
      setShowRenameDialog(false);
    } catch (e) {
      console.error('Failed to rename category:', e);
    }
  };

  const handleDelete = async () => {
    if (category.id === 1) return;
    if (!confirm(`Delete category "${category.name}"? Conversations will be moved to Default.`)) return;
    try {
      await invoke('chat:delete-category', category.id);
      await refreshCategories();
      setShowMenu(false);
    } catch (e) {
      console.error('Failed to delete category:', e);
    }
  };

  const handleSetCurrent = async () => {
    try {
      await invoke('chat:set-current-category', category.id);
      await refreshCategories();
      setShowMenu(false);
    } catch (e) {
      console.error('Failed to set current category:', e);
    }
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div>
      {/* Header - fixed height to prevent height change on hover */}
      <div
        className={clsx(
          "flex items-center gap-2 px-3 h-8 cursor-pointer hover:bg-elevated transition-colors relative group",
          category.isCurrent && "bg-primary/5"
        )}
        onClick={handleToggleExpanded}
      >
        {isExpanded ? (
          <ChevronDown size={14} className="text-text-muted flex-shrink-0" />
        ) : (
          <ChevronRight size={14} className="text-text-muted flex-shrink-0" />
        )}
        <FolderOpen size={14} className="flex-shrink-0 text-text-muted" />
        <span className="text-xs font-medium text-text-sec truncate">
          {category.name}
          {category.isPinned && (
            <Pin size={10} className="text-primary ml-1 inline-block" />
          )}
          <span className="text-text-muted ml-1">({total})</span>
        </span>
        
        {/* Flex spacer */}
        <div className="flex-1" />

        {/* Current indicator (green check) + Context Menu Trigger */}
        <div className="flex items-center gap-0.5 flex-shrink-0">
          {category.isCurrent && (
            <Check size={14} className="text-green-500" strokeWidth={3} />
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowMenu(!showMenu);
            }}
            className="p-0.5 rounded hover:bg-surface transition-colors opacity-0 group-hover:opacity-100"
          >
            <MoreHorizontal size={14} className="text-text-muted" />
          </button>
        </div>

        {/* Context Menu */}
        {showMenu && (
          <div
            ref={menuRef}
            className="absolute right-2 top-full z-50 bg-surface border border-border shadow-xl text-xs py-1 rounded w-32"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => {
                setShowRenameDialog(true);
                setShowMenu(false);
              }}
              className="w-full text-left px-3 py-1.5 text-text-sec hover:bg-primary hover:text-primary-foreground flex items-center gap-2"
            >
              <Edit2 size={12} /> Rename
            </button>
            {!category.isCurrent && (
              <button
                onClick={handleSetCurrent}
                className="w-full text-left px-3 py-1.5 text-text-sec hover:bg-primary hover:text-primary-foreground flex items-center gap-2"
              >
                <Check size={12} /> Set as Current
              </button>
            )}
            <button
              onClick={handleTogglePinned}
              className="w-full text-left px-3 py-1.5 text-text-sec hover:bg-primary hover:text-primary-foreground flex items-center gap-2"
            >
              <Pin size={12} /> {category.isPinned ? 'Unpin' : 'Pin'}
            </button>
            {category.id !== 1 && (
              <>
                <div className="h-px bg-border my-1" />
                <button
                  onClick={handleDelete}
                  className="w-full text-left px-3 py-1.5 text-red-400 hover:bg-red-500 hover:text-text-main flex items-center gap-2"
                >
                  <Trash2 size={12} /> Delete
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Content */}
      {isExpanded && (
        <div className="pb-1">
          {conversations.length === 0 ? (
            <div className="px-4 py-2 text-xs text-text-muted italic">
              No conversations
            </div>
          ) : (
            conversations.map((conv) => (
              <ConversationItem
                key={conv.id}
                conversation={conv}
                isSelected={conv.id === currentConversationId}
                onSelect={() => onSelectConversation(conv.id)}
                onRefresh={loadConversations}
              />
            ))
          )}

          {totalPages > 1 && (
            <Pagination
              currentPage={page}
              totalPages={totalPages}
              onPageChange={setPage}
            />
          )}
        </div>
      )}

      <RenameCategoryDialog
        isOpen={showRenameDialog}
        onClose={() => setShowRenameDialog(false)}
        onConfirm={handleRename}
        currentName={category.name}
      />
    </div>
  );
}
