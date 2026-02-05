import React, { useState, useRef, useEffect } from 'react';
import { MoreHorizontal, Pin, Star, Edit2, Trash2, ArrowRightCircle } from 'lucide-react';
import { clsx } from 'clsx';
import { RenameConversationDialog } from './dialogs/RenameConversationDialog';
import { MoveToCategoryDialog } from './dialogs/MoveToCategoryDialog';
import { ConversationData, useDrawerContext } from './Drawer';

const invoke = window.electron?.invoke || (async () => {});

interface ConversationItemProps {
  conversation: ConversationData;
  isSelected: boolean;
  onSelect: () => void;
  onRefresh: () => Promise<void>;
  showFavoriteOption?: boolean;
}

export function ConversationItem({
  conversation,
  isSelected,
  onSelect,
  onRefresh,
  showFavoriteOption = true,
}: ConversationItemProps) {
  const { onDeleteConversation, refreshCategories } = useDrawerContext();
  const [isHovered, setIsHovered] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [showMoveDialog, setShowMoveDialog] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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

  const handleTogglePinned = async () => {
    try {
      await invoke('chat:toggle-conversation-pinned', conversation.id, !conversation.isPinned);
      await onRefresh();
      setShowMenu(false);
    } catch (e) {
      console.error('Failed to toggle pinned:', e);
    }
  };

  const handleToggleFavorite = async () => {
    try {
      await invoke('chat:toggle-conversation-favorite', conversation.id, !conversation.isFavorite);
      await onRefresh();
      setShowMenu(false);
    } catch (e) {
      console.error('Failed to toggle favorite:', e);
    }
  };

  const handleRename = async (newTitle: string) => {
    try {
      await invoke('chat:rename-conversation', conversation.id, newTitle);
      await onRefresh();
      setShowRenameDialog(false);
    } catch (e) {
      console.error('Failed to rename conversation:', e);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete "${conversation.title || 'Untitled'}"?`)) return;
    try {
      await onDeleteConversation(conversation.id);
      await onRefresh();
      setShowMenu(false);
    } catch (e) {
      console.error('Failed to delete conversation:', e);
    }
  };

  const handleMove = async (categoryId: number) => {
    try {
      await invoke('chat:move-conversation', conversation.id, categoryId);
      await onRefresh();
      await refreshCategories();
      setShowMoveDialog(false);
    } catch (e) {
      console.error('Failed to move conversation:', e);
    }
  };

  return (
    <div
      className={clsx(
        'flex items-center gap-1 px-4 py-1 cursor-pointer transition-colors relative',
        isSelected ? 'bg-accent-primary/20 text-accent-primary' : 'hover:bg-bg-secondary/50 text-text-secondary'
      )}
      onClick={onSelect}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Pin indicator */}
      {conversation.isPinned && (
        <Pin size={10} className="text-accent-primary flex-shrink-0" />
      )}

      {/* Favorite indicator */}
      {conversation.isFavorite && (
        <Star size={10} className="text-yellow-400 flex-shrink-0 fill-yellow-400" />
      )}

      {/* Title */}
      <span className="text-xs truncate flex-1">
        {conversation.title || 'Untitled'}
      </span>

      {/* Context Menu Trigger */}
      {isHovered && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setShowMenu(!showMenu);
          }}
          className="p-0.5 rounded hover:bg-bg-secondary transition-colors"
        >
          <MoreHorizontal size={12} className="text-text-muted" />
        </button>
      )}

      {/* Context Menu */}
      {showMenu && (
        <div
          ref={menuRef}
          className="absolute right-2 top-full z-50 bg-bg-primary border border-border-subtle rounded-md shadow-lg py-1 min-w-[130px]"
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
            <Pin size={12} /> {conversation.isPinned ? 'Unpin' : 'Pin'}
          </button>
          {showFavoriteOption && (
            <button
              onClick={handleToggleFavorite}
              className="w-full px-3 py-1.5 text-xs text-text-secondary hover:bg-bg-secondary flex items-center gap-2"
            >
              <Star size={12} /> {conversation.isFavorite ? 'Unfavorite' : 'Favorite'}
            </button>
          )}
          <button
            onClick={() => {
              setShowMoveDialog(true);
              setShowMenu(false);
            }}
            className="w-full px-3 py-1.5 text-xs text-text-secondary hover:bg-bg-secondary flex items-center gap-2"
          >
            <ArrowRightCircle size={12} /> Move to...
          </button>
          <button
            onClick={handleDelete}
            className="w-full px-3 py-1.5 text-xs text-red-400 hover:bg-bg-secondary flex items-center gap-2"
          >
            <Trash2 size={12} /> Delete
          </button>
        </div>
      )}

      {/* Dialogs */}
      <RenameConversationDialog
        isOpen={showRenameDialog}
        onClose={() => setShowRenameDialog(false)}
        onConfirm={handleRename}
        currentTitle={conversation.title || ''}
      />
      <MoveToCategoryDialog
        isOpen={showMoveDialog}
        onClose={() => setShowMoveDialog(false)}
        onConfirm={handleMove}
        currentCategoryId={conversation.categoryId}
      />
    </div>
  );
}
