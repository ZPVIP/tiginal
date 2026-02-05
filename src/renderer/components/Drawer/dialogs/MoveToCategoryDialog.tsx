import React, { useState } from 'react';
import { FolderOpen, Check } from 'lucide-react';
import { clsx } from 'clsx';
import { Modal } from '../../ui/Modal';
import { useDrawerContext } from '../Drawer';

interface MoveToCategoryDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (categoryId: number) => void;
  currentCategoryId: number;
}

export function MoveToCategoryDialog({ isOpen, onClose, onConfirm, currentCategoryId }: MoveToCategoryDialogProps) {
  const { categories } = useDrawerContext();
  const [selectedId, setSelectedId] = useState<number>(currentCategoryId);

  const handleSubmit = () => {
    onConfirm(selectedId);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Move to...">
      <div className="space-y-4">
        <div className="max-h-64 overflow-y-auto border border-border-subtle rounded-md">
          {categories.map((category) => (
            <button
              key={category.id}
              onClick={() => setSelectedId(category.id)}
              className={clsx(
                'w-full px-3 py-2 flex items-center gap-2 text-left transition-colors',
                selectedId === category.id
                  ? 'bg-accent-primary/20 text-accent-primary'
                  : 'hover:bg-bg-secondary text-text-secondary',
                category.id === currentCategoryId && 'opacity-60'
              )}
            >
              <FolderOpen size={14} />
              <span className="flex-1 text-sm truncate">{category.name}</span>
              {selectedId === category.id && (
                <Check size={14} className="text-accent-primary" />
              )}
              {category.id === currentCategoryId && (
                <span className="text-xs text-text-muted">(current)</span>
              )}
            </button>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={selectedId === currentCategoryId}
            className="px-4 py-2 text-sm bg-accent-primary text-white rounded-md hover:bg-accent-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            OK
          </button>
        </div>
      </div>
    </Modal>
  );
}
