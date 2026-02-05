import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ChevronDown, ChevronRight, MoreHorizontal, Pin, Edit2, Trash2, FolderOpen } from 'lucide-react';
import { clsx } from 'clsx';
import { ConversationItem } from './ConversationItem';
import { Pagination } from './Pagination';
import { RenameCategoryDialog } from './dialogs/RenameCategoryDialog';
import { CategoryData, ConversationData, useDrawerContext } from './Drawer';

const invoke = window.electron?.invoke || (async () => {});

const PAGE_SIZE = 10;

interface CategoryItemProps {
  category: CategoryData;
}

export function CategoryItem({ category }: CategoryItemProps) {
  const { currentConversationId, onSelectConversation, refreshCategories } = useDrawerContext();
  const [isExpanded, setIsExpanded] = useState(category.isExpanded);
  const [conversations, setConversations] = useState<ConversationData[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [showMenu, setShowMenu] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const loadConversations = useCallback(async () => {
    if (!isExpanded) return;
    try {
      const result = await invoke('chat:get-conversations-by-category', category.id, page, PAGE_SIZE);
      setConversations(result.items || []);
      setTotal(result.total || 0);
    } catch (e) {
      console.error('Failed to load conversations:', e);
    }
  }, [category.id, page, isExpanded]);

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
    if (category.id === 1) return; // Cannot delete default
    if (!confirm(`Delete category "${category.name}"? Conversations will be moved to Default.`)) return;
    try {
      await invoke('chat:delete-category', category.id);
      await refreshCategories();
      setShowMenu(false);
    } catch (e) {
      console.error('Failed to delete category:', e);
    }
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="border-b border-border-subtle last:border-b-0">
      {/* Header */}
      <div
        className="flex items-center gap-1 px-2 py-1.5 cursor-pointer hover:bg-bg-secondary/50 transition-colors relative"
        onClick={handleToggleExpanded}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {isExpanded ? (
          <ChevronDown size={14} className="text-text-muted flex-shrink-0" />
        ) : (
          <ChevronRight size={14} className="text-text-muted flex-shrink-0" />
        )}
        <FolderOpen size={14} className="text-text-muted flex-shrink-0" />
        <span className="text-xs font-medium text-text-secondary truncate flex-1">
          {category.name}
        </span>
        {category.isPinned && (
          <Pin size={10} className="text-accent-primary flex-shrink-0" />
        )}
        <span className="text-xs text-text-muted">{total}</span>

        {/* Context Menu Trigger */}
        {isHovered && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowMenu(!showMenu);
            }}
            className="p-0.5 rounded hover:bg-bg-secondary transition-colors ml-1"
          >
            <MoreHorizontal size={14} className="text-text-muted" />
          </button>
        )}

        {/* Context Menu */}
        {showMenu && (
          <div
            ref={menuRef}
            className="absolute right-2 top-full z-50 bg-bg-primary border border-border-subtle rounded-md shadow-lg py-1 min-w-[120px]"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => {
                setShowRenameDialog(true);
                setShowMenu(false);
              }}
              className="w-full px-3 py-1.5 text-xs text-text-secondary hover:bg-bg-secondary flex items-center gap-2"
            >
              <Edit2 size={12} /> Rename
            </button>
            <button
              onClick={handleTogglePinned}
              className="w-full px-3 py-1.5 text-xs text-text-secondary hover:bg-bg-secondary flex items-center gap-2"
            >
              <Pin size={12} /> {category.isPinned ? 'Unpin' : 'Pin'}
            </button>
            {category.id !== 1 && (
              <button
                onClick={handleDelete}
                className="w-full px-3 py-1.5 text-xs text-red-400 hover:bg-bg-secondary flex items-center gap-2"
              >
                <Trash2 size={12} /> Delete
              </button>
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

      {/* Rename Dialog */}
      <RenameCategoryDialog
        isOpen={showRenameDialog}
        onClose={() => setShowRenameDialog(false)}
        onConfirm={handleRename}
        currentName={category.name}
      />
    </div>
  );
}
