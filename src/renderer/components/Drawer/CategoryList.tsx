import React, { useState } from 'react';
import { Plus, ChevronDown, ChevronRight } from 'lucide-react';
import { CategoryItem } from './CategoryItem';
import { CreateCategoryDialog } from './dialogs/CreateCategoryDialog';
import { useDrawerContext } from './Drawer';

const invoke = window.electron?.invoke || (async () => {});

export function CategoryList() {
  const { categories, refreshCategories } = useDrawerContext();
  const [isExpanded, setIsExpanded] = useState(true);
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  const handleCreateCategory = async (name: string) => {
    try {
      await invoke('chat:create-category', name);
      await refreshCategories();
      setShowCreateDialog(false);
    } catch (e) {
      console.error('Failed to create category:', e);
    }
  };

  return (
    <div className="flex-1">
      {/* Header - styled like FAVORITES */}
      <div className="flex items-center px-3 py-2 border-b border-border h-8">
        <span className="text-xs font-medium text-text-muted uppercase tracking-wider flex-1">
          CATEGORIES
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setShowCreateDialog(true);
          }}
          className="p-0.5 rounded hover:bg-elevated transition-colors text-text-muted hover:text-text-main"
          title="Create new category"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Category List */}
      <div>
        {categories.map((category) => (
          <CategoryItem key={category.id} category={category} />
        ))}
      </div>

      <CreateCategoryDialog
        isOpen={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        onConfirm={handleCreateCategory}
      />
    </div>
  );
}
