import React, { useState, useEffect, useRef } from 'react';

interface RenameConversationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (title: string) => void;
  currentTitle: string;
}

export function RenameConversationDialog({ isOpen, onClose, onConfirm, currentTitle }: RenameConversationDialogProps) {
  const [title, setTitle] = useState(currentTitle);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTitle(currentTitle);
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 100);
    }
  }, [isOpen, currentTitle]);

  const handleSubmit = () => {
    if (title.trim()) {
      onConfirm(title.trim());
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSubmit();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface border border-border rounded-xl w-full max-w-sm shadow-xl p-6">
        <h3 className="text-lg font-semibold text-text-main mb-4">Rename Conversation</h3>
        <input
          ref={inputRef}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Conversation Title"
          className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-text-main mb-6 focus:ring-primary focus:border-primary"
        />
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-text-sec hover:text-text-main"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!title.trim()}
            className="px-3 py-1.5 text-sm bg-primary text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
