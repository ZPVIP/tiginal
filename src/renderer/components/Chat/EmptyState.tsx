import React from 'react';
import { Bot, Sparkles } from 'lucide-react';

interface EmptyStateProps {
  models: { value: string, label: string }[];
  selectedModel: string;
  onModelSelect: (model: string) => void;
}

export function EmptyState({ models, selectedModel, onModelSelect }: EmptyStateProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center animate-in fade-in zoom-in-95 duration-500">
      <p className="text-text-muted max-w-md mb-8">
          What’s on your mind today?
      </p>
    </div>
  );
}
