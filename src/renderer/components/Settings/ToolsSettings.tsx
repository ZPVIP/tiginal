import React, { useEffect, useState, useMemo } from 'react';
import { 
  Wrench, 
  Plus, 
  Trash2, 
  Check, 
  X, 
  FileJson,
  ChevronDown,
  ChevronUp,
  Download,
  FolderOpen,
  Edit2,
  List,
  ArrowUp,
  ArrowDown,
  Eye,
  Save,
  AlertTriangle
} from 'lucide-react';
import { clsx } from 'clsx';
import { FancySelect } from '../ui/FancySelect';
import { GlobalToggle, SettingsPageHeader } from './SettingsPageHeader';

const invoke = window.electron?.invoke || (async () => {});

interface Tool {
  id: string;
  categoryId: string | null;
  categoryName?: string;
  name: string;
  description?: string;
  inputSchema: object;
  defaultInput: Record<string, unknown>;
  isSystem: boolean;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

interface ToolCategory {
  id: string;
  name: string;
  rank: number;
  isExpanded: boolean;
  enabled: boolean;
}

interface TabItem {
  id: 'categories' | 'tools';
  label: string;
  icon: React.ReactNode;
}

export function ToolsSettings() {
  // --- State ---
  const [activeTab, setActiveTab] = useState<'categories' | 'tools'>('categories');
  const [globalEnabled, setGlobalEnabled] = useState(true);
  const [tools, setTools] = useState<Tool[]>([]);
  const [categories, setCategories] = useState<ToolCategory[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Tools Tab State
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [showAddToolModal, setShowAddToolModal] = useState(false);
  const [showToolDetailModal, setShowToolDetailModal] = useState<Tool | null>(null);

  // Add/Edit Tool Form State
  const [toolName, setToolName] = useState('');
  const [toolDesc, setToolDesc] = useState('');
  const [toolCategory, setToolCategory] = useState('');
  const [toolSchema, setToolSchema] = useState('');
  const [toolDefaults, setToolDefaults] = useState('');
  const [toolError, setToolError] = useState('');
  const [isEditingTool, setIsEditingTool] = useState(false);

  // Categories Tab State
  const [showAddCatModal, setShowAddCatModal] = useState(false);
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [catName, setCatName] = useState('');
  const [catError, setCatError] = useState('');

  // --- Effects ---
  useEffect(() => {
    loadData();
  }, []);

  const notifyToolsUpdated = () => {
    window.dispatchEvent(new Event('tools-updated'));
  };

  // Update expanded categories set when categories changes (initial load)
  useEffect(() => {
    const expanded = new Set<string>();
    categories.forEach(c => {
      if (c.isExpanded) expanded.add(c.id);
    });
    setExpandedCategories(expanded);
  }, [categories]);

  // --- Data Loading ---
  const loadData = async () => {
    setIsLoading(true);
    try {
      const [toolList, catList, enabled] = await Promise.all([
        invoke('tools:get-all'),
        invoke('categories:get-all'),
        invoke('tools:get-global-enabled'),
      ]);
      setTools(toolList || []);
      setCategories(catList || []);
      setGlobalEnabled(enabled !== false);
    } catch (err) {
      console.error('Failed to load tools data', err);
    } finally {
      setIsLoading(false);
    }
  };

  const refreshData = async () => {
    const [toolList, catList] = await Promise.all([
      invoke('tools:get-all'),
      invoke('categories:get-all'),
    ]);
    setTools(toolList || []);
    setCategories(catList || []);
    notifyToolsUpdated();
  };

  const handleGlobalToggle = async (enabled: boolean) => {
    setGlobalEnabled(enabled);
    await invoke('tools:set-global-enabled', enabled);
    notifyToolsUpdated();
  };

  // --- Helpers ---
  const groupedTools = useMemo(() => {
    const groups: Record<string, Tool[]> = {};
    categories.forEach(cat => {
      groups[cat.id] = [];
    });
    // Add 'uncategorized' bucket just in case, though DB forces null or valid FK
    const uncategorized: Tool[] = [];

    tools.forEach(tool => {
      if (tool.categoryId && groups[tool.categoryId]) {
        groups[tool.categoryId].push(tool);
      } else {
        uncategorized.push(tool);
      }
    });

    return { groups, uncategorized };
  }, [tools, categories]);

  // --- Handlers: Categories ---
  const handleAddCategory = async () => {
    if (!catName.trim()) return setCatError('Name required');
    try {
      await invoke('categories:add', catName.trim());
      setCatName('');
      setShowAddCatModal(false);
      refreshData();
    } catch (err: any) {
      setCatError(err.message);
    }
  };

  const handleUpdateCategory = async (id: string) => {
    if (!catName.trim()) return setCatError('Name required');
    try {
      await invoke('categories:update', id, catName.trim());
      setEditingCatId(null);
      setCatName('');
      refreshData();
    } catch (err: any) {
      setCatError(err.message);
    }
  };

  const handleDeleteCategory = async (id: string) => {
    if (!confirm('Delete category? Tools will be moved to Default/Uncategorized.')) return;
    try {
      await invoke('categories:delete', id);
      refreshData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleReorderCategory = async (idx: number, direction: 'up' | 'down') => {
    if (direction === 'up' && idx === 0) return;
    if (direction === 'down' && idx === categories.length - 1) return;

    const newCats = [...categories];
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    [newCats[idx], newCats[swapIdx]] = [newCats[swapIdx], newCats[idx]];
    
    // Update simple optimistic UI first? No, just sync DB
    const orderedIds = newCats.map(c => c.id);
    await invoke('categories:reorder', orderedIds);
    refreshData();
  };

  const startEditCategory = (cat: ToolCategory) => {
    setEditingCatId(cat.id);
    setCatName(cat.name);
    setCatError('');
  };

  const handleToggleCategoryEnabled = async (id: string, enabled: boolean) => {
    await invoke('categories:toggle-enabled', id, enabled);
    refreshData();
  };

  // --- Handlers: Tools List ---
  const toggleCategory = async (catId: string) => {
    const isExpanded = expandedCategories.has(catId);
    const newSet = new Set(expandedCategories);
    if (isExpanded) newSet.delete(catId);
    else newSet.add(catId);
    
    setExpandedCategories(newSet);
    await invoke('categories:toggle-expanded', catId, !isExpanded);
  };

  const toggleAll = (expand: boolean) => {
    if (expand) {
      const all = new Set(categories.map(c => c.id));
      setExpandedCategories(all);
      categories.forEach(c => invoke('categories:toggle-expanded', c.id, true));
    } else {
      setExpandedCategories(new Set());
      categories.forEach(c => invoke('categories:toggle-expanded', c.id, false));
    }
  };

  const handleToolToggle = async (id: string, enabled: boolean) => {
    await invoke('tools:toggle', id, enabled);
    setTools(prev => prev.map(t => t.id === id ? { ...t, enabled } : t));
    notifyToolsUpdated();
  };

  const handleDeleteTool = async (id: string) => {
    if (!confirm('Are you sure you want to delete this tool?')) return;
    try {
      await invoke('tools:delete', id);
      setTools(prev => prev.filter(t => t.id !== id));
      if (showToolDetailModal?.id === id) setShowToolDetailModal(null);
      notifyToolsUpdated();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleImportPreset = async () => {
    try {
      await invoke('tools:import-preset');
      alert('System tools synced successfully.');
      refreshData();
    } catch (err: any) {
      alert('Import failed: ' + err.message);
    }
  };

  // --- Handlers: Tool Modal (Add/Edit) ---
  const openAddToolModal = () => {
    setToolName('');
    setToolDesc('');
    setToolCategory(categories[0]?.id || '');
    setToolSchema('{\n  "type": "object",\n  "properties": {\n    "input": {\n      "type": "string",\n      "description": "Input passed to the tool"\n    }\n  },\n  "required": ["input"],\n  "additionalProperties": false\n}');
    setToolDefaults('{}');
    setToolError('');
    setIsEditingTool(false);
    setShowAddToolModal(true);
  };

  const openToolDetail = (tool: Tool) => {
    setToolName(tool.name);
    setToolDesc(tool.description || '');
    setToolCategory(tool.categoryId || '');
    setToolSchema(JSON.stringify(tool.inputSchema, null, 2));
    setToolDefaults(JSON.stringify(tool.defaultInput || {}, null, 2));
    setToolError('');
    setIsEditingTool(true); // Technically "viewing/editing details"
    setShowToolDetailModal(tool);
  };

  const handleSaveTool = async () => {
    if (!toolName.trim()) return setToolError('Name required');
    
    let schemaObj: unknown;
    let defaultInput: unknown;
    try {
      schemaObj = JSON.parse(toolSchema);
    } catch (e) {
      return setToolError('Invalid JSON format');
    }
    try {
      defaultInput = JSON.parse(toolDefaults);
    } catch {
      return setToolError('Default arguments must be valid JSON');
    }
    if (typeof defaultInput !== 'object' || defaultInput === null || Array.isArray(defaultInput)) {
      return setToolError('Default arguments must be a JSON object');
    }

    try {
      if (showAddToolModal) {
        // Add Mode
        const tool = await invoke('tools:add', {
          categoryId: toolCategory || undefined,
          name: toolName.trim(),
          description: toolDesc.trim(),
          inputSchema: schemaObj,
          defaultInput,
          enabled: true,
        });
        setTools(prev => [...prev, tool]);
        setShowAddToolModal(false);
        notifyToolsUpdated();
      } else if (showToolDetailModal) {
        await invoke('tools:update', {
          id: showToolDetailModal.id,
          categoryId: toolCategory || undefined,
          name: toolName.trim(),
          description: toolDesc.trim(),
          inputSchema: schemaObj,
          defaultInput,
          enabled: showToolDetailModal.enabled
        });
        refreshData();
        setShowToolDetailModal(null);
        notifyToolsUpdated();
      }
    } catch (err: any) {
      setToolError(err.message);
    }
  };

  // --- Render Helpers ---
  const tabs: TabItem[] = [
    { id: 'categories', label: 'Tool Categories', icon: <FolderOpen size={18} /> },
    { id: 'tools', label: 'Tools', icon: <Wrench size={18} /> },
  ];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500 h-full flex flex-col">
      <SettingsPageHeader
        icon={<Wrench size={24} />}
        title="Tools"
        actions={<GlobalToggle checked={globalEnabled} onChange={handleGlobalToggle} />}
      />

      {/* Tabs Header */}
      <div className="flex space-x-1 bg-surface border border-border p-1 rounded-lg shrink-0">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={clsx(
              "flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-all",
              activeTab === tab.id
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-text-sec hover:text-text-main hover:bg-surface-light"
            )}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-hidden flex flex-col min-h-0">
        {/* === TAB: CATEGORIES === */}
        {activeTab === 'categories' && (
          <div className="flex flex-col h-full space-y-4">
             <div className="flex justify-between items-center shrink-0">
                <p className="text-sm text-text-muted">Manage tool categories and their order.</p>
                <button
                  onClick={() => {
                    setCatName('');
                    setCatError('');
                    setShowAddCatModal(true);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary hover:opacity-90 text-primary-foreground rounded-lg transition-colors"
                >
                  <Plus size={16} /> Add Category
                </button>
             </div>

             <div className="flex-1 overflow-y-auto bg-surface border border-border rounded-lg">
                <table className="w-full">
                  <thead className="bg-background/50 sticky top-0 z-10 backdrop-blur-sm">
                    <tr>
                      <th className="text-left px-4 py-3 text-sm font-medium text-text-sec">Order</th>
                      <th className="text-left px-4 py-3 text-sm font-medium text-text-sec text-center w-20">Enabled</th>
                      <th className="text-left px-4 py-3 text-sm font-medium text-text-sec">Name</th>
                      <th className="text-right px-4 py-3 text-sm font-medium text-text-sec w-32">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {categories.map((cat, idx) => (
                      <tr key={cat.id} className="hover:bg-background/30 group">
                         <td className="px-4 py-3 w-16 text-center">
                           <div className="flex flex-col items-center opacity-30 group-hover:opacity-100 transition-opacity">
                             <button onClick={() => handleReorderCategory(idx, 'up')} disabled={idx === 0} className="hover:text-primary disabled:opacity-30">
                               <ArrowUp size={14} />
                             </button>
                             <button onClick={() => handleReorderCategory(idx, 'down')} disabled={idx === categories.length - 1} className="hover:text-primary disabled:opacity-30">
                               <ArrowDown size={14} />
                             </button>
                           </div>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <button
                               onClick={() => handleToggleCategoryEnabled(cat.id, !cat.enabled)}
                               className={clsx(
                                 "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none",
                                 cat.enabled ? "bg-primary" : "bg-surface-light border border-border"
                               )}
                             >
                               <span
                                 className={clsx(
                                   "inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform shadow-sm",
                                   cat.enabled ? "translate-x-5" : "translate-x-0.5"
                                 )}
                               />
                             </button>
                          </td>
                          <td className="px-4 py-3">
                           {editingCatId === cat.id ? (
                             <div className="flex items-center gap-2">
                               <input 
                                 className="bg-background border border-border rounded px-2 py-1 text-sm text-text-main flex-1"
                                 value={catName}
                                 onChange={e => setCatName(e.target.value)}
                                 autoFocus
                               />
                               <button onClick={() => handleUpdateCategory(cat.id)} className="text-green-500 hover:text-green-400"><Check size={16}/></button>
                               <button onClick={() => setEditingCatId(null)} className="text-red-500 hover:text-red-400"><X size={16}/></button>
                             </div>
                           ) : (
                             <span className="font-medium text-text-main">{cat.name}</span>
                           )}
                           {editingCatId === cat.id && catError && <p className="text-xs text-red-400 mt-1">{catError}</p>}
                         </td>
                         <td className="px-4 py-3 text-right">
                           <div className="flex items-center justify-end gap-2 text-text-muted">
                             <button onClick={() => startEditCategory(cat)} className="hover:text-primary p-1 rounded"><Edit2 size={16}/></button>
                             {cat.name !== 'Default' && (
                               <button onClick={() => handleDeleteCategory(cat.id)} className="hover:text-red-400 p-1 rounded"><Trash2 size={16}/></button>
                             )}
                           </div>
                         </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
             </div>
          </div>
        )}

        {/* === TAB: TOOLS === */}
        {activeTab === 'tools' && (
          <div className="flex flex-col h-full space-y-4">
            <div className="flex justify-between items-center shrink-0">
              <div className="flex gap-2">
                <button onClick={() => toggleAll(true)} className="text-xs text-primary hover:underline">Expand All</button>
                <span className="text-border">|</span>
                <button onClick={() => toggleAll(false)} className="text-xs text-primary hover:underline">Collapse All</button>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleImportPreset}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-purple-600/10 hover:bg-purple-600/20 text-purple-400 border border-purple-500/30 rounded-lg transition-colors"
                >
                  <Download size={15} /> Import System Preset
                </button>
                <button
                  onClick={openAddToolModal}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary hover:opacity-90 text-primary-foreground rounded-lg transition-colors"
                >
                  <Plus size={16} /> Add Tool Definition
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto space-y-4 pr-1">
              {categories.map(cat => {
                 const catTools = groupedTools.groups[cat.id] || [];
                 if (catTools.length === 0 && cat.name !== 'Default') {
                   // Optional: hide empty categories? User didn't say. Let's show them.
                 }

                 const isExpanded = expandedCategories.has(cat.id);

                 return (
                   <div key={cat.id} className="bg-surface border border-border rounded-lg overflow-hidden flex flex-col">
                     <button 
                       onClick={() => toggleCategory(cat.id)}
                       className="flex items-center justify-between w-full px-4 py-3 hover:bg-background/30 transition-colors text-left"
                     >
                        <div className="flex items-center gap-2 font-semibold text-text-main">
                          {isExpanded ? <ChevronDown size={18}/> : <ChevronUp size={18}/>}
                          <span>{cat.name}</span>
                          <span className="text-xs font-normal text-text-muted bg-background px-2 py-0.5 rounded-full border border-border">
                            {catTools.length}
                          </span>
                        </div>
                     </button>
                     
                     {isExpanded && (
                       <div className="border-t border-border">
                          {catTools.length === 0 ? (
                            <div className="p-4 text-center text-sm text-text-muted italic">No tools in this category</div>
                          ) : (
                            <div className="divide-y divide-border">
                              {catTools.map(tool => (
                                <div key={tool.id} className="flex items-center justify-between p-3 hover:bg-background/20 group">
                                  <div className="flex items-center gap-3 min-w-0 flex-1">
                                    <div className="flex flex-col min-w-0">
                                      <button 
                                        onClick={() => openToolDetail(tool)}
                                        className="text-sm font-medium text-text-main hover:text-primary truncate text-left flex items-center gap-2"
                                        title={tool.description} // Simple tooltip
                                      >
                                        <FileJson size={14} className={clsx(tool.isSystem ? "text-blue-400" : "text-orange-400")} />
                                        {tool.name}
                                        {tool.isSystem && <span className="text-[10px] uppercase bg-blue-500/10 text-blue-400 px-1.5 py-0.5 rounded">System</span>}
                                      </button>
                                    </div>
                                  </div>
                                  
                                  <div className="flex items-center gap-4 shrink-0">
                                    {/* Toggle */}
                                    <button
                                      onClick={() => handleToolToggle(tool.id, !tool.enabled)}
                                      className={clsx(
                                        "w-9 h-5 rounded-full relative transition-colors",
                                        tool.enabled ? "bg-accent-success" : "bg-surface-light border border-border"
                                      )}
                                    >
                                      <div className={clsx(
                                        "absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all shadow-sm",
                                        tool.enabled ? "left-4.5" : "left-0.5"
                                      )} />
                                    </button>
                                    
                                    {/* Actions */}
                                    {!tool.isSystem && (
                                      <button 
                                        onClick={() => handleDeleteTool(tool.id)}
                                        className="text-text-muted hover:text-red-400 transition-colors p-1"
                                      >
                                        <Trash2 size={15}/>
                                      </button>
                                    )}
                                    {tool.isSystem && <div className="w-6" />} 
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                       </div>
                     )}
                   </div>
                 );
              })}
            </div>
          </div>
        )}
      </div>

      {/* --- MODALS --- */}

      {/* Add Category Modal */}
      {showAddCatModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface border border-border rounded-xl w-full max-w-sm shadow-xl p-6">
            <h3 className="text-lg font-semibold text-text-main mb-4">New Category</h3>
            {catError && <p className="text-sm text-red-400 mb-3">{catError}</p>}
            <input
              autoFocus
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-text-main mb-6 focus:ring-primary focus:border-primary"
              placeholder="Category Name"
              value={catName}
              onChange={e => setCatName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAddCategory()}
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowAddCatModal(false)} className="px-3 py-1.5 text-sm text-text-sec hover:text-text-main">Cancel</button>
              <button onClick={handleAddCategory} className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg hover:opacity-90">Add</button>
            </div>
          </div>
        </div>
      )}

      {/* Tool Detail / Add Modal */}
      {(showAddToolModal || showToolDetailModal) && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface border border-border rounded-xl w-full max-w-2xl shadow-xl flex flex-col max-h-full">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
              <div className="flex items-center gap-2">
                <FileJson className="text-primary" size={20} />
                <h3 className="text-lg font-semibold text-text-main">
                  {showAddToolModal ? 'Add Tool Definition' : (showToolDetailModal?.name)}
                </h3>
                {showToolDetailModal?.isSystem && (
                   <span className="text-xs bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded border border-blue-500/20">System-defined</span>
                )}
              </div>
              <button onClick={() => {setShowAddToolModal(false); setShowToolDetailModal(null);}} className="text-text-muted hover:text-text-main">
                <X size={20} />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
               {toolError && (
                  <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm flex items-center gap-2">
                    <AlertTriangle size={16}/> {toolError}
                  </div>
               )}

               {showAddToolModal && (
                 <div className="p-3 bg-yellow-500/5 border border-yellow-500/20 rounded-lg text-yellow-200 text-xs">
                   A definition tells the model how to call a tool. It still needs a matching built-in or MCP executor to run.
                 </div>
               )}

               <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-text-sec mb-1.5">Name</label>
                    <input 
                      disabled={!!showToolDetailModal?.isSystem}
                      className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-text-main disabled:opacity-50 disabled:cursor-not-allowed"
                      value={toolName}
                      onChange={e => setToolName(e.target.value)}
                      placeholder="e.g. MyTool"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-text-sec mb-1.5">Category</label>
                    <FancySelect
                      value={toolCategory}
                      onChange={setToolCategory}
                      options={categories.map(c => ({ value: c.id, label: c.name }))}
                      buttonClassName="bg-background"
                    />
                  </div>
               </div>

               <div>
                  <label className="block text-xs font-medium text-text-sec mb-1.5">Description</label>
                  <input 
                    disabled={!!showToolDetailModal?.isSystem}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-text-main"
                    value={toolDesc}
                    onChange={e => setToolDesc(e.target.value)}
                    placeholder="Brief description of what this tool does"
                  />
               </div>

               <div className="flex-1 min-h-[300px] flex flex-col">
                  <label className="block text-xs font-medium text-text-sec mb-1.5">
                    JSON Schema {showToolDetailModal?.isSystem && '(Read-only)'}
                  </label>
                  <textarea
                    readOnly={!!showToolDetailModal?.isSystem}
                    className="flex-1 w-full bg-background border border-border rounded-lg p-4 text-sm font-mono text-text-main focus:ring-primary focus:border-primary resize-none leading-relaxed"
                    value={toolSchema}
                    onChange={e => setToolSchema(e.target.value)}
                    spellCheck={false}
                  />

                  <p className="mt-2 text-xs text-text-muted">
                    The schema is sent to the model as the tool signature. It does not contain credentials or execution settings.
                  </p>

               </div>

               <div className="flex flex-col min-h-[140px]">
                  <label className="block text-xs font-medium text-text-sec mb-1.5">
                    Default arguments (local)
                  </label>
                  <textarea
                    className="flex-1 w-full bg-background border border-border rounded-lg p-4 text-sm font-mono text-text-main focus:ring-primary focus:border-primary resize-none leading-relaxed"
                    value={toolDefaults}
                    onChange={e => setToolDefaults(e.target.value)}
                    spellCheck={false}
                  />
                  <p className="mt-2 text-xs text-text-muted">
                    These values are merged before validation and execution, but are not sent in the model's tool definition. Model arguments override them.
                  </p>
                  {toolName === 'WebSearch' && (
                    <p className="mt-1 text-xs text-text-muted font-mono">
                      Example: {`{"blocked_domains":["bing.com"],"max_results":8}`}
                    </p>
                  )}
               </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-border flex justify-end gap-3 shrink-0">
               <button
                 onClick={() => {setShowAddToolModal(false); setShowToolDetailModal(null);}} 
                 className="px-4 py-2 text-sm bg-background hover:bg-surface-light border border-border rounded-lg transition-colors"
               >
                 Close
               </button>
               
               <button
                 onClick={handleSaveTool}
                 className="flex items-center gap-1.5 px-4 py-2 text-sm bg-primary hover:opacity-90 text-primary-foreground rounded-lg transition-colors"
               >
                 <Save size={16} />
                 {showToolDetailModal?.isSystem ? 'Save Defaults' : 'Save Changes'}
               </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
