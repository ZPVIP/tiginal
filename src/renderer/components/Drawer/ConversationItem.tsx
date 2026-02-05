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
  const { onDeleteConversation, refreshCategories, refreshFavorites } = useDrawerContext();
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
      // Only toggle favorite, not pinned
      await invoke('chat:toggle-conversation-favorite', conversation.id, !conversation.isFavorite);
      await onRefresh();
      refreshFavorites(); // Immediately refresh favorites list
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
        'flex items-center gap-2 px-4 h-8 cursor-pointer transition-colors relative group',
        isSelected 
          ? 'bg-primary/20 text-primary' 
          : 'text-text-sec hover:bg-elevated'
      )}
      onClick={onSelect}
    >
      {/* Pin indicator */}
      {conversation.isPinned && (
        <Pin size={10} className="text-primary flex-shrink-0" />
      )}

      {/* Favorite indicator */}
      {conversation.isFavorite && (
        <Star size={10} className="text-yellow-400 flex-shrink-0 fill-yellow-400" />
      )}

      {/* Title */}
      <span className="text-xs truncate flex-1">
        {conversation.title || 'Untitled'}
      </span>

      {/* Context Menu Trigger - always present but invisible unless hovered */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          setShowMenu(!showMenu);
        }}
        className="p-0.5 rounded hover:bg-surface transition-colors opacity-0 group-hover:opacity-100"
      >
        <MoreHorizontal size={12} className="text-text-muted" />
      </button>

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
            className="w-full text-left px-3 py-1.5 text-text-sec hover:bg-primary hover:text-white flex items-center gap-2"
          >
            <Edit2 size={12} /> Rename
          </button>
          <button
            onClick={handleTogglePinned}
            className="w-full text-left px-3 py-1.5 text-text-sec hover:bg-primary hover:text-white flex items-center gap-2"
          >
            <Pin size={12} /> {conversation.isPinned ? 'Unpin' : 'Pin'}
          </button>
          {showFavoriteOption && (
            <button
              onClick={handleToggleFavorite}
              className="w-full text-left px-3 py-1.5 text-text-sec hover:bg-primary hover:text-white flex items-center gap-2"
            >
              <Star size={12} /> {conversation.isFavorite ? 'Unfavorite' : 'Favorite'}
            </button>
          )}
          <button
            onClick={() => {
              setShowMoveDialog(true);
              setShowMenu(false);
            }}
            className="w-full text-left px-3 py-1.5 text-text-sec hover:bg-primary hover:text-white flex items-center gap-2"
          >
            <ArrowRightCircle size={12} /> Move to...
          </button>
          <div className="h-px bg-border my-1" />
          <button
            onClick={handleDelete}
            className="w-full text-left px-3 py-1.5 text-red-400 hover:bg-red-500 hover:text-white flex items-center gap-2"
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
