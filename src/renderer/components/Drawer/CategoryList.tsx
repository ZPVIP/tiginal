import React, { useState } from 'react';
import { Plus } from 'lucide-react';
import { CategoryItem } from './CategoryItem';
import { CreateCategoryDialog } from './dialogs/CreateCategoryDialog';
import { useDrawerContext } from './Drawer';

const invoke = window.electron?.invoke || (async () => {});

export function CategoryList() {
  const { categories, refreshCategories } = useDrawerContext();
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
      {/* Header with Add button */}
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-border-subtle">
        <span className="text-xs font-medium text-text-muted uppercase tracking-wider">
          Categories
        </span>
        <button
          onClick={() => setShowCreateDialog(true)}
          className="p-0.5 rounded hover:bg-bg-secondary transition-colors text-text-muted hover:text-text-primary"
          title="Create new category"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Category List */}
      <div className="py-1">
        {categories.map((category) => (
          <CategoryItem key={category.id} category={category} />
        ))}
      </div>

      {/* Create Category Dialog */}
      <CreateCategoryDialog
        isOpen={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        onConfirm={handleCreateCategory}
      />
    </div>
  );
}
