import React, { useState, useEffect } from 'react';
import { X, Search, ChevronDown, ChevronRight } from 'lucide-react';
import { clsx } from 'clsx';

interface SystemPrompt {
  id: number;
  title: string;
  content: string;
  isDefault: boolean;
  isActive: boolean;
  rank: number;
}

interface SystemPromptsPopoverProps {
  onClose: () => void;
}

export const SystemPromptsPopover: React.FC<SystemPromptsPopoverProps> = ({ onClose }) => {
  const [globalEnabled, setGlobalEnabled] = useState(true);
  const [customCategoryEnabled, setCustomCategoryEnabled] = useState(true);
  const [defaultCategoryEnabled, setDefaultCategoryEnabled] = useState(true);
  const [prompts, setPrompts] = useState<SystemPrompt[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  
  // Track expanded state for categories
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set(['custom', 'default']));

  useEffect(() => {
    loadSettings();
    const handleUpdate = () => loadSettings();
    window.addEventListener('system-prompts-updated', handleUpdate);
    return () => window.removeEventListener('system-prompts-updated', handleUpdate);
  }, []);

  const loadSettings = async () => {
    try {
      const [enabled, customEnabled, defaultEnabled, allPrompts] = await Promise.all([
        window.electron.invoke('system-prompts:get-global-enabled'),
        window.electron.invoke('system-prompts:get-category-enabled', 'custom'),
        window.electron.invoke('system-prompts:get-category-enabled', 'default'),
        window.electron.invoke('system-prompts:get-all')
      ]);
      setGlobalEnabled(enabled);
      setCustomCategoryEnabled(customEnabled);
      setDefaultCategoryEnabled(defaultEnabled);
      setPrompts(allPrompts || []);
    } catch (error) {
      console.error('Failed to load system prompt settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleGlobal = async () => {
    const newValue = !globalEnabled;
    setGlobalEnabled(newValue);
    await window.electron.invoke('system-prompts:set-global-enabled', newValue);
  };

  const toggleCategory = async (category: 'default' | 'custom') => {
    if (!globalEnabled) return;
    
    const currentValue = category === 'default' ? defaultCategoryEnabled : customCategoryEnabled;
    const newValue = !currentValue;
    
    // Optimistic Update
    if (category === 'default') {
      setDefaultCategoryEnabled(newValue);
    } else {
      setCustomCategoryEnabled(newValue);
    }
    
    await window.electron.invoke('system-prompts:set-category-enabled', category, newValue);
  };

  const togglePrompt = async (id: number, currentActive: boolean) => {
    if (!globalEnabled) return;

    try {
      const newValue = !currentActive;
      setPrompts(prev => prev.map(p => p.id === id ? { ...p, isActive: newValue } : p));
      await window.electron.invoke('system-prompts:toggle', id, newValue);
    } catch (error) {
      console.error('Failed to toggle prompt:', error);
      loadSettings();
    }
  };

  const toggleExpand = (catId: string) => {
    const newSet = new Set(expandedCats);
    if (newSet.has(catId)) newSet.delete(catId);
    else newSet.add(catId);
    setExpandedCats(newSet);
  };

  // --- Filtering & Grouping ---
  const filteredPrompts = prompts.filter(p => 
    p.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
    p.content.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const customPrompts = filteredPrompts.filter(p => !p.isDefault);
  const defaultPrompts = filteredPrompts.filter(p => p.isDefault);

  return (
    <div className="absolute bottom-full left-0 right-0 mb-4 md:w-96 bg-surface border border-border rounded-xl shadow-xl z-50 flex flex-col max-h-[500px] animate-in fade-in slide-in-from-bottom-2">
        {/* Header */}
        <div className="flex items-center justify-between p-4 bg-surface-light/50 rounded-t-xl backdrop-blur-sm shrink-0">
            <h3 className="font-medium text-text-main">System Prompts</h3>
            <div className="flex items-center gap-3">
                {/* Global Toggle */}
                <div className="flex items-center gap-2">
                    <span className="text-xs text-text-muted font-medium">Global</span>
                    <button
                        onClick={toggleGlobal}
                        className={clsx(
                            "relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none",
                            globalEnabled ? "bg-primary" : "bg-surface-light border border-border"
                        )}
                    >
                        <span
                            className={clsx(
                                "inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform shadow-sm",
                                globalEnabled ? "translate-x-5" : "translate-x-0.5"
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
        <div className="p-3 shrink-0">
            <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                <input 
                    type="text" 
                    placeholder="Search prompts..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-surface-light border border-border rounded-lg pl-9 pr-3 py-1.5 text-sm text-text-main placeholder-text-muted focus:outline-none focus:border-primary/50 transition-colors"
                />
            </div>
        </div>

        {/* Content */}
        <div className={clsx(
            "overflow-y-auto p-2 flex-col gap-2 transition-opacity duration-200 flex-1 min-h-0",
            !globalEnabled && "opacity-50 pointer-events-none grayscale-[0.5]" 
        )}>
            {loading ? (
                <div className="p-4 text-center text-text-muted text-sm">Loading prompts...</div>
            ) : filteredPrompts.length === 0 ? (
                <div className="p-4 text-center text-text-muted text-sm">No prompts found</div>
            ) : (
                <>
                  {/* Custom Prompts (shown first) */}
                  {customPrompts.length > 0 && (
                    <div className={clsx(
                      "rounded-lg overflow-hidden bg-surface-light/30 mb-2",
                      !customCategoryEnabled && "opacity-60"
                    )}>
                       {/* Category Header */}
                       <div className="flex items-center p-2 gap-2 hover:bg-surface-hover/50 transition-colors rounded">
                          <button
                              onClick={() => toggleCategory('custom')}
                              className={clsx(
                                  "relative inline-flex h-3.5 w-6 shrink-0 items-center rounded-full transition-colors focus:outline-none",
                                  customCategoryEnabled ? "bg-primary" : "bg-surface-light border border-border"
                              )}
                          >
                              <span
                                  className={clsx(
                                      "inline-block h-2.5 w-2.5 transform rounded-full bg-white transition-transform shadow-sm",
                                      customCategoryEnabled ? "translate-x-3" : "translate-x-0.5"
                                  )}
                              />
                          </button>
                          <button 
                            onClick={() => toggleExpand('custom')}
                            className="flex-1 flex items-center justify-between text-left"
                          >
                            <div className="flex items-center gap-2">
                              {expandedCats.has('custom') ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                              <span className="text-xs font-semibold text-text-main">Custom</span>
                              <span className="text-[10px] bg-orange-500/20 text-orange-400 px-1.5 py-0.5 rounded">User</span>
                            </div>
                            <span className="text-[10px] text-text-muted bg-surface border border-border px-1.5 rounded">{customPrompts.length}</span>
                          </button>
                       </div>

                       {/* Prompts List in Category */}
                       {expandedCats.has('custom') && (
                         <div className="p-1 space-y-1">
                            {customPrompts.map(prompt => (
                              <div 
                                  key={prompt.id} 
                                  className="flex items-center justify-between p-2 rounded hover:bg-surface-hover transition-colors group ml-7 pl-2"
                              >
                                  <div className="flex-1 mr-3 min-w-0">
                                      <div className="flex items-center gap-2">
                                          <span className="font-medium text-xs text-text-main truncate">{prompt.title}</span>
                                          {!prompt.isActive && <span className="text-[8px] bg-surface border border-border px-1 py-0.5 rounded text-text-muted">Disabled</span>}
                                      </div>
                                  </div>
                                  
                                  <button
                                      onClick={() => togglePrompt(prompt.id, prompt.isActive)}
                                      className={clsx(
                                          "relative inline-flex h-3.5 w-6 shrink-0 items-center rounded-full transition-colors focus:outline-none",
                                          prompt.isActive ? "bg-primary" : "bg-surface-light border border-border"
                                      )}
                                  >
                                      <span
                                          className={clsx(
                                              "inline-block h-2.5 w-2.5 transform rounded-full bg-white transition-transform shadow-sm",
                                              prompt.isActive ? "translate-x-3" : "translate-x-0.5"
                                          )}
                                      />
                                  </button>
                              </div>
                            ))}
                         </div>
                       )}
                    </div>
                  )}

                  {/* Separator */}
                  {customPrompts.length > 0 && defaultPrompts.length > 0 && (
                    <div className="h-px bg-border mx-[2px] my-0.5" />
                  )}

                  {/* Default Prompts */}
                  {defaultPrompts.length > 0 && (
                    <div className={clsx(
                      "rounded-lg overflow-hidden bg-surface-light/30",
                      !defaultCategoryEnabled && "opacity-60"
                    )}>
                       {/* Category Header */}
                       <div className="flex items-center p-2 gap-2 hover:bg-surface-hover/50 transition-colors rounded">
                          <button
                              onClick={() => toggleCategory('default')}
                              className={clsx(
                                  "relative inline-flex h-3.5 w-6 shrink-0 items-center rounded-full transition-colors focus:outline-none",
                                  defaultCategoryEnabled ? "bg-primary" : "bg-surface-light border border-border"
                              )}
                          >
                              <span
                                  className={clsx(
                                      "inline-block h-2.5 w-2.5 transform rounded-full bg-white transition-transform shadow-sm",
                                      defaultCategoryEnabled ? "translate-x-3" : "translate-x-0.5"
                                  )}
                              />
                          </button>
                          <button 
                            onClick={() => toggleExpand('default')}
                            className="flex-1 flex items-center justify-between text-left"
                          >
                            <div className="flex items-center gap-2">
                              {expandedCats.has('default') ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                              <span className="text-xs font-semibold text-text-main">Default</span>
                              <span className="text-[10px] bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded">System</span>
                            </div>
                            <span className="text-[10px] text-text-muted bg-surface border border-border px-1.5 rounded">{defaultPrompts.length}</span>
                          </button>
                       </div>

                       {/* Prompts List in Category */}
                       {expandedCats.has('default') && (
                         <div className="p-1 space-y-1">
                            {defaultPrompts.map(prompt => (
                              <div 
                                  key={prompt.id} 
                                  className="flex items-center justify-between p-2 rounded hover:bg-surface-hover transition-colors group ml-7 pl-2"
                              >
                                  <div className="flex-1 mr-3 min-w-0">
                                      <div className="flex items-center gap-2">
                                          <span className="font-medium text-xs text-text-main truncate">{prompt.title}</span>
                                          {!prompt.isActive && <span className="text-[8px] bg-surface border border-border px-1 py-0.5 rounded text-text-muted">Disabled</span>}
                                      </div>
                                  </div>
                                  
                                  <button
                                      onClick={() => togglePrompt(prompt.id, prompt.isActive)}
                                      className={clsx(
                                          "relative inline-flex h-3.5 w-6 shrink-0 items-center rounded-full transition-colors focus:outline-none",
                                          prompt.isActive ? "bg-primary" : "bg-surface-light border border-border"
                                      )}
                                  >
                                      <span
                                          className={clsx(
                                              "inline-block h-2.5 w-2.5 transform rounded-full bg-white transition-transform shadow-sm",
                                              prompt.isActive ? "translate-x-3" : "translate-x-0.5"
                                          )}
                                      />
                                  </button>
                              </div>
                            ))}
                         </div>
                       )}
                    </div>
                  )}
                </>
            )}
        </div>
        
        {/* Footer info */}
        {!globalEnabled && (
            <div className="p-2 border-t border-border bg-surface-light/30 shrink-0">
                <div className="text-[10px] text-text-muted text-center flex items-center justify-center gap-1">
                    <span>System prompts are disabled.</span>
                </div>
            </div>
        )}
    </div>
  );
};
