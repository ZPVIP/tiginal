import React, { useState, useEffect } from 'react';
import { X, Search } from 'lucide-react';
import { clsx } from 'clsx';

interface Tool {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
}

interface ToolsPopoverProps {
  onClose: () => void;
}

export const ToolsPopover: React.FC<ToolsPopoverProps> = ({ onClose }) => {
  const [globalEnabled, setGlobalEnabled] = useState(true);
  const [tools, setTools] = useState<Tool[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const [enabled, allTools] = await Promise.all([
        window.electron.invoke('tools:get-global-enabled'),
        window.electron.invoke('tools:get-all')
      ]);
      setGlobalEnabled(enabled);
      setTools(allTools);
    } catch (error) {
      console.error('Failed to load tool settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleGlobal = async () => {
    const newValue = !globalEnabled;
    setGlobalEnabled(newValue);
    await window.electron.invoke('tools:set-global-enabled', newValue);
  };

  const toggleTool = async (id: string, currentEnabled: boolean) => {
    // Only allow toggling if global is enabled (or maybe allow it but it won't have effect? 
    // User requirement: "If disabled ... disable below single settings ... but single tools enabled value should not change"
    // So we should probably prevent clicking if global is disabled, or just let them toggle but it's visually grayed out.
    // The requirement "single settings become gray, cannot be changed" implies we should disable interaction.
    if (!globalEnabled) return;

    try {
      const newValue = !currentEnabled;
      // Optimistic update
      setTools(prev => prev.map(t => t.id === id ? { ...t, enabled: newValue } : t));
      await window.electron.invoke('tools:toggle', id, newValue);
    } catch (error) {
      console.error('Failed to toggle tool:', error);
      // Revert on error
      loadSettings();
    }
  };

  const filteredTools = tools.filter(t => 
    t.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    (t.description && t.description.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="absolute bottom-full left-0 right-0 mb-4 md:w-96 bg-surface border border-border rounded-xl shadow-xl z-50 flex flex-col max-h-[400px] animate-in fade-in slide-in-from-bottom-2">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border bg-surface-light/50 rounded-t-xl backdrop-blur-sm">
            <h3 className="font-medium text-text-main">Tools Configuration</h3>
            <div className="flex items-center gap-3">
                {/* Global Toggle */}
                <div className="flex items-center gap-2">
                    <span className="text-xs text-text-muted font-medium">Global</span>
                    <button
                        onClick={toggleGlobal}
                        className={clsx(
                            "relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-surface",
                            globalEnabled ? "bg-primary" : "bg-surface-light border border-border"
                        )}
                    >
                        <span
                            className={clsx(
                                "inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow-sm",
                                globalEnabled ? "translate-x-6" : "translate-x-1"
                            )}
                        />
                    </button>
                </div>
                <button 
                  onClick={onClose}
                  className="p-1 hover:bg-surface-hover rounded-md text-text-muted hover:text-text-main transition-colors"
                >
                    <X size={16} />
                </button>
            </div>
        </div>

        {/* Search */}
        <div className="p-3 border-b border-border">
            <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                <input 
                    type="text" 
                    placeholder="Search tools..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-surface-light border border-border rounded-lg pl-9 pr-3 py-1.5 text-sm text-text-main placeholder-text-muted focus:outline-none focus:border-primary/50 transition-colors"
                />
            </div>
        </div>

        {/* Tool List */}
        <div className={clsx(
            "overflow-y-auto p-2 flex-col gap-1 transition-opacity duration-200",
            !globalEnabled && "opacity-50 pointer-events-none grayscale-[0.5]" 
        )}>
            {loading ? (
                <div className="p-4 text-center text-text-muted text-sm">Loading tools...</div>
            ) : filteredTools.length === 0 ? (
                <div className="p-4 text-center text-text-muted text-sm">No tools found</div>
            ) : (
                filteredTools.map(tool => (
                    <div 
                        key={tool.id} 
                        className="flex items-start justify-between p-3 rounded-lg hover:bg-surface-light transition-colors group"
                    >
                        <div className="flex-1 mr-3">
                            <div className="flex items-center gap-2">
                                <span className="font-medium text-sm text-text-main">{tool.name}</span>
                                {!tool.enabled && <span className="text-[10px] bg-surface-hover px-1.5 py-0.5 rounded text-text-muted">Disabled</span>}
                            </div>
                            {tool.description && (
                                <p className="text-xs text-text-muted mt-0.5 line-clamp-2">{tool.description}</p>
                            )}
                        </div>
                        
                        <button
                            onClick={() => toggleTool(tool.id, tool.enabled)}
                            className={clsx(
                                "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none",
                                tool.enabled ? "bg-primary" : "bg-surface-light border border-border"
                            )}
                        >
                            <span
                                className={clsx(
                                    "inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform shadow-sm",
                                    tool.enabled ? "translate-x-5" : "translate-x-0.5"
                                )}
                            />
                        </button>
                    </div>
                ))
            )}
        </div>
        
        {/* Footer info */}
        {!globalEnabled && (
            <div className="p-2 border-t border-border bg-surface-light/30">
                <div className="text-[10px] text-text-muted text-center flex items-center justify-center gap-1">
                    <span>Tools are globally disabled. Individual settings preserved.</span>
                </div>
            </div>
        )}
    </div>
  );
};
