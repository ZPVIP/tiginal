import React, { useState, useEffect } from 'react';
import { X, Star, Sparkles, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';

interface FavoriteCommandModalProps {
  initialCommand: string;
  onSave: (command: string) => void;
  onClose: () => void;
}

interface AIModel {
  value: string;
  label: string;
  providerId: string;
  modelId: string;
}

export function FavoriteCommandModal({ initialCommand, onSave, onClose }: FavoriteCommandModalProps) {
  const [command, setCommand] = useState(initialCommand);
  const [isNormalizing, setIsNormalizing] = useState(false);
  const [aiModel, setAiModel] = useState<{ providerId: string; modelId: string } | null>(null);

  const invoke = window.electron?.invoke || (async () => null);

  // Load AI model setting
  useEffect(() => {
    (async () => {
      const settings = await invoke('settings:get', 'terminal');
      if (settings) {
        const parsed = JSON.parse(settings);
        if (parsed.aiModel) {
          const [providerId, ...modelParts] = parsed.aiModel.split(':');
          const modelId = modelParts.join(':');
          setAiModel({ providerId, modelId });
        }
      }
    })();
  }, []);

  const handleSave = () => {
    if (command.trim()) {
      onSave(command.trim());
      onClose();
    }
  };

  const handleNormalize = async () => {
    if (!aiModel || !command.trim()) return;
    
    setIsNormalizing(true);
    try {
      const result = await invoke('command:normalize', command.trim(), aiModel.providerId, aiModel.modelId);
      if (result && typeof result === 'string') {
        setCommand(result);
      }
    } catch (err) {
      console.error('Failed to normalize command:', err);
    } finally {
      setIsNormalizing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-surface border border-border rounded-xl shadow-2xl w-full max-w-lg mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Star size={18} className="text-yellow-400" />
            <span className="font-semibold text-text-main">Add to Favorites</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-surface-light text-text-muted hover:text-text-main transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="p-4">
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm text-text-muted">
              Edit command before saving:
            </label>
            {aiModel && (
              <button
                onClick={handleNormalize}
                disabled={isNormalizing || !command.trim()}
                className={clsx(
                  "flex items-center gap-1.5 px-2 py-1 text-xs rounded-md transition-colors",
                  isNormalizing || !command.trim()
                    ? "text-text-muted/50 cursor-not-allowed"
                    : "text-purple-400 hover:bg-purple-500/20 hover:text-purple-300"
                )}
                title="Use AI to normalize command (remove dynamic values)"
              >
                {isNormalizing ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Sparkles size={12} />
                )}
                Normalize
              </button>
            )}
          </div>
          <textarea
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            className="w-full bg-background text-text-main text-sm font-mono rounded-lg py-2 px-3 outline-none resize-none border border-border focus:border-primary min-h-[80px]"
            autoFocus
          />
          {aiModel && (
            <p className="text-xs text-text-muted mt-1">
              AI will remove dynamic values like commit messages, timestamps, etc.
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-border">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg border border-border text-text-muted hover:bg-surface-light transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!command.trim()}
            className={clsx(
              "px-4 py-2 text-sm rounded-lg transition-colors",
              command.trim()
                ? "bg-primary text-primary-foreground hover:opacity-90"
                : "bg-surface-light text-text-muted cursor-not-allowed"
            )}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
