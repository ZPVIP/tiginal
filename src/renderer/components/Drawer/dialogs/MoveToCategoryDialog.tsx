import React, { useState } from 'react';
import { FancySelect } from '../../ui/FancySelect';
import { useDrawerContext } from '../Drawer';

interface MoveToCategoryDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (categoryId: number) => void;
  currentCategoryId: number;
}

export function MoveToCategoryDialog({ isOpen, onClose, onConfirm, currentCategoryId }: MoveToCategoryDialogProps) {
  const { categories } = useDrawerContext();
  const [selectedId, setSelectedId] = useState<string>(String(currentCategoryId));

  const handleSubmit = () => {
    onConfirm(parseInt(selectedId, 10));
  };

  if (!isOpen) return null;

  const options = categories.map((category) => ({
    value: String(category.id),
    label: category.name + (category.id === currentCategoryId ? ' (current)' : ''),
    disabled: category.id === currentCategoryId,
  }));

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface border border-border rounded-xl w-full max-w-sm shadow-xl p-6">
        <h3 className="text-lg font-semibold text-text-main mb-4">Move to Category</h3>
        <div className="mb-6">
          <FancySelect
            value={selectedId}
            onChange={setSelectedId}
            options={options}
            placeholder="Select category..."
          />
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-text-sec hover:text-text-main"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={parseInt(selectedId, 10) === currentCategoryId}
            className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Move
          </button>
        </div>
      </div>
    </div>
  );
}
