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
      <div className="w-24 h-24 bg-surface rounded-3xl flex items-center justify-center mb-8 shadow-2xl shadow-primary/10 border border-border">
          <Bot size={48} className="text-primary" />
      </div>

      <h1 className="text-3xl font-bold bg-gradient-to-r from-gray-100 to-gray-400 bg-clip-text text-transparent mb-4">
          How can I help you today?
      </h1>
      
      <p className="text-gray-400 max-w-md mb-8">
          I can help you write code, analyze data, or even just chat. Select a model to get started.
      </p>

      <div className="flex flex-col gap-3 w-full max-w-xs">
         {/* Quick Actions / Model Info could go here */}
         <div className="bg-surface border border-border rounded-lg p-4 flex items-center gap-3">
             <Sparkles size={18} className="text-yellow-400" />
             <div className="text-left">
                 <div className="text-sm font-medium text-gray-200">Current Model</div>
                 <div className="text-xs text-gray-500">
                    {models.find(m => m.value === selectedModel)?.label || selectedModel || 'No model selected'}
                 </div>
             </div>
         </div>
      </div>
    </div>
  );
}
