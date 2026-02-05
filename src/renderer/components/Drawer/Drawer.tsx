import React, { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FavoriteSection } from './FavoriteSection';
import { CategoryList } from './CategoryList';

const invoke = window.electron?.invoke || (async () => {});

export interface CategoryData {
  id: number;
  name: string;
  isPinned: boolean;
  isExpanded: boolean;
  rank: number;
}

export interface ConversationData {
  id: string;
  title: string | null;
  providerId: string | null;
  categoryId: number;
  isPinned: boolean;
  isFavorite: boolean;
  createdAt: number;
  updatedAt: number;
}

interface DrawerContextType {
  categories: CategoryData[];
  refreshCategories: () => Promise<void>;
  refreshFavorites: () => void;
  favoritesRefreshKey: number;
  currentConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onDeleteConversation: (id: string) => Promise<void>;
  sortBy: 'updatedAt' | 'createdAt';
}

const DrawerContext = createContext<DrawerContextType | null>(null);

export function useDrawerContext() {
  const ctx = useContext(DrawerContext);
  if (!ctx) throw new Error('useDrawerContext must be used within Drawer');
  return ctx;
}

interface DrawerProps {
  isOpen: boolean;
  currentConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onDeleteConversation: (id: string) => Promise<void>;
}

export function Drawer({ isOpen, currentConversationId, onSelectConversation, onDeleteConversation }: DrawerProps) {
  const [categories, setCategories] = useState<CategoryData[]>([]);
  const [favoritesRefreshKey, setFavoritesRefreshKey] = useState(0);
  const [sortBy, setSortBy] = useState<'updatedAt' | 'createdAt'>('updatedAt');

  const refreshCategories = useCallback(async () => {
    try {
      const data = await invoke('chat:get-categories');
      setCategories(data || []);
    } catch (e) {
      console.error('Failed to load categories:', e);
    }
  }, []);

  const refreshFavorites = useCallback(() => {
    setFavoritesRefreshKey(k => k + 1);
  }, []);

  useEffect(() => {
    refreshCategories();
  }, [refreshCategories]);

  // Load sortBy setting and listen for changes
  useEffect(() => {
    const loadSortBy = async () => {
      try {
        const val = await invoke('settings:get', 'historySort');
        if (val) setSortBy(val as any);
      } catch (e) {
        console.error('Failed to load historySort:', e);
      }
    };
    loadSortBy();

    const handleSettingsUpdate = (e: CustomEvent) => {
      if (e.detail?.key === 'historySort') {
        setSortBy(e.detail.value);
      }
    };

    window.addEventListener('settings-general-updated', handleSettingsUpdate as EventListener);
    return () => {
      window.removeEventListener('settings-general-updated', handleSettingsUpdate as EventListener);
    };
  }, []);

  const contextValue: DrawerContextType = {
    categories,
    refreshCategories,
    refreshFavorites,
    favoritesRefreshKey,
    currentConversationId,
    onSelectConversation,
    onDeleteConversation,
    sortBy,
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 260, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="h-full bg-surface border-r border-border flex flex-col overflow-hidden"
          style={{ minWidth: isOpen ? 260 : 0 }}
        >
          <DrawerContext.Provider value={contextValue}>
            <div className="flex-1 overflow-y-auto scrollbar-thin">
              <FavoriteSection />
              <CategoryList />
            </div>
          </DrawerContext.Provider>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
