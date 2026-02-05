import React, { useState, useEffect } from 'react';
import { X, Search } from 'lucide-react';
import { clsx } from 'clsx';

interface Tool {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  categoryId?: string | null;
}

interface ToolCategory {
  id: string;
  name: string;
  enabled: boolean;
}

interface ToolsPopoverProps {
  onClose: () => void;
}

export const ToolsPopover: React.FC<ToolsPopoverProps> = ({ onClose }) => {
  const [globalEnabled, setGlobalEnabled] = useState(true);
  const [tools, setTools] = useState<Tool[]>([]);
  const [categories, setCategories] = useState<ToolCategory[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  
  // Track expanded state locally for the popover session 
  // (User didn't specify persistence for expand/collapse in POPUP, but persistence for ENABLED state. 
  // We can default to expanded or use the category's `isExpanded` property from DB if we want. 
  // Let's use local state for now to avoid too many DB writes for simple UI toggles, or just default all open)
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadSettings();
    const handleUpdate = () => loadSettings();
    window.addEventListener('tools-updated', handleUpdate);
    return () => window.removeEventListener('tools-updated', handleUpdate);
  }, []);

  const loadSettings = async () => {
    try {
      const [enabled, allTools, allCats] = await Promise.all([
        window.electron.invoke('tools:get-global-enabled'),
        window.electron.invoke('tools:get-all'),
        window.electron.invoke('categories:get-all')
      ]);
      setGlobalEnabled(enabled);
      setTools(allTools);
      setCategories(allCats || []);
      
      // Default expand all that are marked expanded in DB? Or just all?
      // Let's expand all by default for visibility in the popup
      const catIds = (allCats || []).map((c: any) => c.id);
      setExpandedCats(new Set(catIds));
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

  const toggleCategory = async (catId: string, currentEnabled: boolean) => {
    if (!globalEnabled) return; // Prevent interaction if globally disabled
    
    // Optimistic Update
    const newValue = !currentEnabled;
    setCategories(prev => prev.map(c => c.id === catId ? { ...c, enabled: newValue } : c));
    
    await window.electron.invoke('categories:toggle-enabled', catId, newValue);
  };

  const toggleTool = async (id: string, currentEnabled: boolean) => {
    if (!globalEnabled) return;

    // Find tool's category
    const tool = tools.find(t => t.id === id);
    const cat = categories.find(c => c.id === tool?.categoryId);
    
    // If category is disabled, maybe prevent toggling tool? 
    // Requirement: "If cancel checkbox (category disabled)... tools become gray...". 
    // Implies disabled category blocks interaction with children.
    if (cat && !cat.enabled) return;

    try {
      const newValue = !currentEnabled;
      setTools(prev => prev.map(t => t.id === id ? { ...t, enabled: newValue } : t));
      await window.electron.invoke('tools:toggle', id, newValue);
    } catch (error) {
      console.error('Failed to toggle tool:', error);
      loadSettings();
    }
  };

  const toggleExpand = (catId: string) => {
    const newSet = new Set(expandedCats);
    if (newSet.has(catId)) newSet.delete(catId);
    else newSet.add(catId);
    setExpandedCats(newSet);
  };

  const toggleGlobalExpand = () => {
    if (expandedCats.size === categories.length) {
      setExpandedCats(new Set());
    } else {
      setExpandedCats(new Set(categories.map(c => c.id)));
    }
  };

  // --- Filtering & Grouping ---
  const filteredTools = tools.filter(t => 
    t.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    (t.description && t.description.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const grouped = React.useMemo(() => {
    const groups: Record<string, Tool[]> = {};
    categories.forEach(c => groups[c.id] = []);
    const uncategorized: Tool[] = [];

    // Assign tools to groups
    filteredTools.forEach(t => {
      if (t.categoryId && groups[t.categoryId]) {
        groups[t.categoryId].push(t);
      } else {
        uncategorized.push(t);
      }
    });

    return { groups, uncategorized };
  }, [categories, filteredTools]);


  return (
    <div className="absolute bottom-full left-0 right-0 mb-4 md:w-96 bg-surface border border-border rounded-xl shadow-xl z-50 flex flex-col max-h-[500px] animate-in fade-in slide-in-from-bottom-2">
        {/* Header */}
        <div className="flex items-center justify-between p-4 bg-surface-light/50 rounded-t-xl backdrop-blur-sm shrink-0">
            <h3 className="font-medium text-text-main">Tools Configuration</h3>
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
                    placeholder="Search tools..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-surface-light border border-border rounded-lg pl-9 pr-3 py-1.5 text-sm text-text-main placeholder-text-muted focus:outline-none focus:border-primary/50 transition-colors"
                />
            </div>
        </div>

        {/* Global Expand Toggle (Optional utils bar) */}
        {!loading && (
          <div className="px-3 py-1 border-b border-border flex justify-end">
             <button onClick={toggleGlobalExpand} className="text-[10px] text-primary hover:underline">
               {expandedCats.size === categories.length ? 'Collapse All' : 'Expand All'}
             </button>
          </div>
        )}

        {/* Content */}
        <div className={clsx(
            "overflow-y-auto p-2 flex-col gap-2 transition-opacity duration-200 flex-1 min-h-0",
            !globalEnabled && "opacity-50 pointer-events-none grayscale-[0.5]" 
        )}>
            {loading ? (
                <div className="p-4 text-center text-text-muted text-sm">Loading tools...</div>
            ) : filteredTools.length === 0 ? (
                <div className="p-4 text-center text-text-muted text-sm">No tools found</div>
            ) : (
                <>
                  {/* categories with tools */}
                  {categories.map((cat, index) => {
                    const catTools = grouped.groups[cat.id];
                    if (!catTools || catTools.length === 0) return null;

                    const isExpanded = expandedCats.has(cat.id);
                    const isDisabled = !cat.enabled;

                    return (
                      <React.Fragment key={cat.id}>
                        {/* Separator if not first (and not first rendered? logic is minimal here, let's just use border-t on div and conditional rendering helper is hard, use CSS sibling usually, but nulls break it. 
                           Actually, if I just map and filter first, I can use index.
                           Let's filter first in the render block for cleaner logic.
                        */}
                      </React.Fragment>
                    );
                  })}
                  
                  {/* Better approach: Pre-calculate visible categories */}
                  {(() => {
                      const visibleCats = categories.filter(c => grouped.groups[c.id] && grouped.groups[c.id].length > 0);
                      const hasUncategorized = grouped.uncategorized.length > 0;
                      
                      return (
                        <>
                          {visibleCats.map((cat, idx) => {
                             const catTools = grouped.groups[cat.id];
                             const isExpanded = expandedCats.has(cat.id);
                             const isDisabled = !cat.enabled;
                             
                             return (
                               <React.Fragment key={cat.id}>
                                 {idx > 0 && <div className="h-px bg-border mx-[2px] my-0.5" />}
                                 <div className="rounded-lg overflow-hidden bg-surface-light/30">
                                    {/* Category Header */}
                                    <div className="flex items-center p-2 gap-2 hover:bg-surface-hover/50 transition-colors rounded">
                                       <button
                                           onClick={() => toggleCategory(cat.id, cat.enabled)}
                                           className={clsx(
                                               "relative inline-flex h-3.5 w-6 shrink-0 items-center rounded-full transition-colors focus:outline-none",
                                               cat.enabled ? "bg-primary" : "bg-surface-light border border-border"
                                           )}
                                       >
                                           <span
                                               className={clsx(
                                                   "inline-block h-2.5 w-2.5 transform rounded-full bg-white transition-transform shadow-sm",
                                                   cat.enabled ? "translate-x-3" : "translate-x-0.5"
                                               )}
                                           />
                                       </button>
                                       <button 
                                         onClick={() => toggleExpand(cat.id)}
                                         className="flex-1 flex items-center justify-between text-left"
                                       >
                                         <span className="text-xs font-semibold text-text-main pl-1">{cat.name}</span>
                                         <span className="text-[10px] text-text-muted bg-surface border border-border px-1.5 rounded">{catTools.length}</span>
                                       </button>
                                    </div>

                                    {/* Tools List in Category */}
                                    {isExpanded && (
                                      <div className={clsx("p-1 space-y-1", isDisabled && "opacity-50 pointer-events-none")}>
                                         {catTools.map(tool => (
                                           <div 
                                               key={tool.id} 
                                               className="flex items-center justify-between p-2 rounded hover:bg-surface-hover transition-colors group ml-7 pl-2"
                                           >
                                               <div className="flex-1 mr-3 min-w-0">
                                                   <div className="flex items-center gap-2">
                                                       <span className="font-medium text-xs text-text-main truncate">{tool.name}</span>
                                                       {!tool.enabled && <span className="text-[8px] bg-surface border border-border px-1 py-0.5 rounded text-text-muted">Disabled</span>}
                                                   </div>
                                                   {tool.description && (
                                                       <p className="text-[10px] text-text-muted truncate" title={tool.description}>{tool.description}</p>
                                                   )}
                                               </div>
                                               
                                               <button
                                                   onClick={() => toggleTool(tool.id, tool.enabled)}
                                                   className={clsx(
                                                       "relative inline-flex h-3.5 w-6 shrink-0 items-center rounded-full transition-colors focus:outline-none",
                                                       tool.enabled ? "bg-primary" : "bg-surface-light border border-border"
                                                   )}
                                               >
                                                   <span
                                                       className={clsx(
                                                           "inline-block h-2.5 w-2.5 transform rounded-full bg-white transition-transform shadow-sm",
                                                           tool.enabled ? "translate-x-3" : "translate-x-0.5"
                                                       )}
                                                   />
                                               </button>
                                           </div>
                                         ))}
                                      </div>
                                    )}
                                 </div>
                               </React.Fragment>
                             );
                          })}

                          {/* Uncategorized Tools */}
                          {hasUncategorized && (
                             <>
                               {visibleCats.length > 0 && <div className="h-px bg-border mx-[2px] my-0.5" />}
                               <div className="rounded-lg overflow-hidden bg-surface-light/30">
                                  <div className="p-2 text-xs font-semibold text-text-muted pl-8">Uncategorized</div>
                                  <div className="p-1 space-y-1">
                                     {grouped.uncategorized.map(tool => (
                                         <div key={tool.id} className="flex items-center justify-between p-2 rounded hover:bg-surface-hover transition-colors ml-7 pl-2">
                                             <div className="flex-1 mr-3 min-w-0">
                                                 <div className="flex items-center gap-2">
                                                     <span className="font-medium text-xs text-text-main truncate">{tool.name}</span>
                                                     {!tool.enabled && <span className="text-[8px] bg-surface border border-border px-1 py-0.5 rounded text-text-muted">Disabled</span>}
                                                 </div>
                                             </div>
                                             <button
                                                 onClick={() => toggleTool(tool.id, tool.enabled)}
                                                 className={clsx(
                                                     "relative inline-flex h-3.5 w-6 shrink-0 items-center rounded-full transition-colors focus:outline-none",
                                                     tool.enabled ? "bg-primary" : "bg-surface-light border border-border"
                                                 )}
                                             >
                                                 <span className={clsx("inline-block h-2.5 w-2.5 transform rounded-full bg-white transition-transform shadow-sm", tool.enabled ? "translate-x-3" : "translate-x-0.5")} />
                                             </button>
                                         </div>
                                     ))}
                                  </div>
                               </div>
                             </>
                          )}
                        </>
                      );
                  })()}
                </>
            )}
        </div>
        
        {/* Footer info */}
        {!globalEnabled && (
            <div className="p-2 border-t border-border bg-surface-light/30 shrink-0">
                <div className="text-[10px] text-text-muted text-center flex items-center justify-center gap-1">
                    <span>Tools are disabled.</span>
                </div>
            </div>
        )}
    </div>
  );
};
