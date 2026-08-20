import React, { useEffect, useState, useMemo } from 'react';
import { 
  FileText, 
  Plus, 
  Trash2, 
  Edit2, 
  RotateCcw,
  ChevronDown,
  ChevronRight,
  Save,
  X,
  AlertTriangle,
  Calendar,
  FolderOpen,
  Monitor,
  Apple
} from 'lucide-react';
import { clsx } from 'clsx';

const invoke = window.electron?.invoke || (async () => {});

interface SystemPrompt {
  id: number;
  title: string;
  content: string;
  isDefault: boolean;
  isActive: boolean;
  rank: number;
}

interface DynamicSettings {
  dateInfo: boolean;
  wdInfo: boolean;
  systemInfo: boolean;
  appleScriptInfo: boolean;
}

interface DynamicTemplate {
  title: string;
  content: string;
  showAlways: boolean;
}

type TabId = 'default' | 'custom';

export function SystemPromptSettings() {
  // State
  const [activeTab, setActiveTab] = useState<TabId>('default');
  const [prompts, setPrompts] = useState<SystemPrompt[]>([]);
  const [dynamicSettings, setDynamicSettings] = useState<DynamicSettings>({
    dateInfo: true,
    wdInfo: true,
    systemInfo: true,
    appleScriptInfo: true,
  });
  const [dynamicTemplates, setDynamicTemplates] = useState<Record<string, DynamicTemplate>>({});
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [expandedDynamic, setExpandedDynamic] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [showResetModal, setShowResetModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<SystemPrompt | null>(null);
  const [formTitle, setFormTitle] = useState('');
  const [formContent, setFormContent] = useState('');
  const [formError, setFormError] = useState('');

  // Load data
  useEffect(() => {
    loadData();
  }, []);

  const notifySystemPromptsUpdated = () => {
    window.dispatchEvent(new Event('system-prompts-updated'));
  };

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [promptList, dynSettings, dynTemplates] = await Promise.all([
        invoke('system-prompts:get-all'),
        invoke('system-prompts:get-dynamic-settings'),
        invoke('system-prompts:get-dynamic-templates'),
      ]);
      setPrompts(promptList || []);
      setDynamicSettings(dynSettings || {
        dateInfo: true,
        wdInfo: true,
        systemInfo: true,
        appleScriptInfo: true,
      });
      setDynamicTemplates(dynTemplates || {});
    } catch (err) {
      console.error('Failed to load system prompts', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Separate default and custom prompts
  const defaultPrompts = useMemo(() => prompts.filter(p => p.isDefault), [prompts]);
  const customPrompts = useMemo(() => prompts.filter(p => !p.isDefault), [prompts]);

  // Toggle expand for accordion
  const toggleExpand = (id: number) => {
    setExpandedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const toggleDynamicExpand = (key: string) => {
    setExpandedDynamic(prev => {
      const newSet = new Set(prev);
      if (newSet.has(key)) {
        newSet.delete(key);
      } else {
        newSet.add(key);
      }
      return newSet;
    });
  };

  // Toggle active status
  const handleToggle = async (id: number, isActive: boolean) => {
    try {
      await invoke('system-prompts:toggle', id, isActive);
      setPrompts(prev => prev.map(p => p.id === id ? { ...p, isActive } : p));
      notifySystemPromptsUpdated();
    } catch (err) {
      console.error('Failed to toggle prompt', err);
    }
  };

  // Toggle dynamic setting
  const handleDynamicToggle = async (key: keyof DynamicSettings, value: boolean) => {
    try {
      await invoke('system-prompts:set-dynamic-setting', key, value);
      setDynamicSettings(prev => ({ ...prev, [key]: value }));
      notifySystemPromptsUpdated();
    } catch (err) {
      console.error('Failed to toggle dynamic setting', err);
    }
  };

  // Reset to defaults
  const handleResetDefaults = async () => {
    try {
      await invoke('system-prompts:reset-defaults');
      await loadData();
      setShowResetModal(false);
      notifySystemPromptsUpdated();
    } catch (err) {
      console.error('Failed to reset defaults', err);
    }
  };

  // Open add modal
  const openAddModal = () => {
    setEditingPrompt(null);
    setFormTitle('');
    setFormContent('');
    setFormError('');
    setShowEditModal(true);
  };

  // Open edit modal
  const openEditModal = (prompt: SystemPrompt) => {
    setEditingPrompt(prompt);
    setFormTitle(prompt.title);
    setFormContent(prompt.content);
    setFormError('');
    setShowEditModal(true);
  };

  // Save prompt (add or edit)
  const handleSavePrompt = async () => {
    if (!formTitle.trim()) {
      setFormError('Title is required');
      return;
    }
    if (!formContent.trim()) {
      setFormError('Content is required');
      return;
    }

    try {
      if (editingPrompt) {
        // Update existing
        await invoke('system-prompts:update', {
          id: editingPrompt.id,
          title: formTitle.trim(),
          content: formContent.trim(),
          isActive: editingPrompt.isActive,
        });
      } else {
        // Add new
        await invoke('system-prompts:add', {
          title: formTitle.trim(),
          content: formContent.trim(),
          isActive: true,
        });
      }
      await loadData();
      setShowEditModal(false);
      notifySystemPromptsUpdated();
    } catch (err: any) {
      setFormError(err.message || 'Failed to save prompt');
    }
  };

  // Delete custom prompt
  const handleDeletePrompt = async (id: number) => {
    if (!confirm('Are you sure you want to delete this custom prompt?')) return;
    try {
      await invoke('system-prompts:delete', id);
      setPrompts(prev => prev.filter(p => p.id !== id));
      notifySystemPromptsUpdated();
    } catch (err: any) {
      alert(err.message || 'Failed to delete prompt');
    }
  };

  // Icons for dynamic prompts
  const dynamicIcons: Record<string, React.ReactNode> = {
    dateInfo: <Calendar size={16} className="text-green-400" />,
    wdInfo: <FolderOpen size={16} className="text-orange-400" />,
    systemInfo: <Monitor size={16} className="text-blue-400" />,
    appleScriptInfo: <Apple size={16} className="text-text-muted" />,
  };

  // Dynamic prompt info for display (from backend templates)
  const dynamicPromptInfo = useMemo(() => {
    const order = ['dateInfo', 'wdInfo', 'systemInfo', 'appleScriptInfo'];
    return order
      .filter(key => dynamicTemplates[key])
      .map(key => ({
        key,
        title: dynamicTemplates[key].title,
        icon: dynamicIcons[key],
        content: dynamicTemplates[key].content,
        showAlways: dynamicTemplates[key].showAlways,
      }));
  }, [dynamicTemplates]);

  // Toggle Switch Component
  const ToggleSwitch = ({ checked, onChange }: { checked: boolean; onChange: (val: boolean) => void }) => (
    <button
      onClick={(e) => { e.stopPropagation(); onChange(!checked); }}
      className={clsx(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none",
        checked ? "bg-primary" : "bg-surface-light border border-border"
      )}
    >
      <span
        className={clsx(
          "inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform shadow-sm",
          checked ? "translate-x-5" : "translate-x-0.5"
        )}
      />
    </button>
  );

  // Accordion Item Component
  const AccordionItem = ({ 
    id, 
    title, 
    content, 
    isActive, 
    isExpanded, 
    onToggleExpand, 
    onToggleActive,
    icon,
    isReadOnly = false,
    actions
  }: {
    id: number | string;
    title: string;
    content: string;
    isActive: boolean;
    isExpanded: boolean;
    onToggleExpand: () => void;
    onToggleActive: (val: boolean) => void;
    icon?: React.ReactNode;
    isReadOnly?: boolean;
    actions?: React.ReactNode;
  }) => (
    <div className="border border-border rounded-lg overflow-hidden bg-surface">
      <button
        onClick={onToggleExpand}
        className="flex items-center justify-between w-full px-4 py-3 hover:bg-background/30 transition-colors text-left"
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {isExpanded ? <ChevronDown size={16} className="shrink-0" /> : <ChevronRight size={16} className="shrink-0" />}
          {icon}
          <span className="font-medium text-text-main truncate">{title}</span>
          {isReadOnly && (
            <span className="text-[10px] uppercase bg-blue-500/10 text-blue-400 px-1.5 py-0.5 rounded shrink-0">
              System
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0 ml-2">
          {actions}
          <ToggleSwitch checked={isActive} onChange={onToggleActive} />
        </div>
      </button>
      
      {isExpanded && (
        <div className="px-4 pb-4 border-t border-border bg-background/20">
          <pre className="mt-3 text-sm text-text-muted whitespace-pre-wrap font-mono leading-relaxed max-h-80 overflow-y-auto">
            {content}
          </pre>
        </div>
      )}
    </div>
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500 h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-2xl font-bold text-text-main flex items-center gap-2">
            <FileText className="text-cyan-400" />
            System Prompts
          </h2>
          <p className="text-sm text-text-muted mt-1">
            Configure system prompts that are prepended to every AI conversation.
          </p>
        </div>
        {activeTab === 'default' && (
          <button
            onClick={() => setShowResetModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-surface hover:bg-surface-light border border-border rounded-lg transition-colors text-text-muted hover:text-text-main"
          >
            <RotateCcw size={14} />
            Reset
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex space-x-1 bg-surface border border-border p-1 rounded-lg shrink-0">
        <button
          onClick={() => setActiveTab('default')}
          className={clsx(
            "flex-1 px-4 py-2 text-sm font-medium rounded-md transition-all",
            activeTab === 'default'
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-text-sec hover:text-text-main hover:bg-surface-light"
          )}
        >
          Default ({defaultPrompts.length})
        </button>
        <button
          onClick={() => setActiveTab('custom')}
          className={clsx(
            "flex-1 px-4 py-2 text-sm font-medium rounded-md transition-all",
            activeTab === 'custom'
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-text-sec hover:text-text-main hover:bg-surface-light"
          )}
        >
          Custom ({customPrompts.length})
        </button>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto pr-1 min-h-0">
        {/* Default Tab */}
        {activeTab === 'default' && (
          <div className="space-y-3">
            <p className="text-sm text-text-muted mb-4">
              Built-in system prompts. Content is read-only, but you can enable or disable each prompt.
            </p>
            
            {defaultPrompts.map(prompt => (
              <AccordionItem
                key={prompt.id}
                id={prompt.id}
                title={prompt.title}
                content={prompt.content}
                isActive={prompt.isActive}
                isExpanded={expandedIds.has(prompt.id)}
                onToggleExpand={() => toggleExpand(prompt.id)}
                onToggleActive={(val) => handleToggle(prompt.id, val)}
                isReadOnly
                icon={<FileText size={16} className="text-cyan-400" />}
              />
            ))}

            {/* Dynamic Prompts Section */}
            <div className="mt-6 pt-6 border-t border-border">
              <h3 className="text-lg font-semibold text-text-main mb-3">Dynamic Prompts</h3>
              <p className="text-sm text-text-muted mb-4">
                These prompts are generated at runtime with current system information.
              </p>
              
              <div className="space-y-3">
                {dynamicPromptInfo.filter(d => d.showAlways).map(dynPrompt => (
                  <AccordionItem
                    key={dynPrompt.key}
                    id={dynPrompt.key}
                    title={dynPrompt.title}
                    content={dynPrompt.content}
                    isActive={dynamicSettings[dynPrompt.key as keyof DynamicSettings]}
                    isExpanded={expandedDynamic.has(dynPrompt.key)}
                    onToggleExpand={() => toggleDynamicExpand(dynPrompt.key)}
                    onToggleActive={(val) => handleDynamicToggle(dynPrompt.key as keyof DynamicSettings, val)}
                    isReadOnly
                    icon={dynPrompt.icon}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Custom Tab */}
        {activeTab === 'custom' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm text-text-muted">
                Add your own custom system prompts.
              </p>
              <button
                onClick={openAddModal}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary hover:opacity-90 text-primary-foreground rounded-lg transition-colors"
              >
                <Plus size={16} /> Add Prompt
              </button>
            </div>

            {customPrompts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-text-muted">
                <FileText size={48} className="opacity-30 mb-4" />
                <p>No custom prompts yet.</p>
                <p className="text-sm">Click "Add Prompt" to create your first one.</p>
              </div>
            ) : (
              customPrompts.map(prompt => (
                <AccordionItem
                  key={prompt.id}
                  id={prompt.id}
                  title={prompt.title}
                  content={prompt.content}
                  isActive={prompt.isActive}
                  isExpanded={expandedIds.has(prompt.id)}
                  onToggleExpand={() => toggleExpand(prompt.id)}
                  onToggleActive={(val) => handleToggle(prompt.id, val)}
                  icon={<FileText size={16} className="text-orange-400" />}
                  actions={
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); openEditModal(prompt); }}
                        className="p-1 hover:bg-surface-light rounded text-text-muted hover:text-primary"
                      >
                        <Edit2 size={14} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeletePrompt(prompt.id); }}
                        className="p-1 hover:bg-surface-light rounded text-text-muted hover:text-red-400"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  }
                />
              ))
            )}
          </div>
        )}
      </div>

      {/* Reset Confirmation Modal */}
      {showResetModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-surface border border-border rounded-xl w-full max-w-md mx-4 shadow-xl">
            <div className="px-6 py-4 border-b border-border">
              <h3 className="text-lg font-semibold text-text-main">Reset to Default</h3>
            </div>
            <div className="p-6">
              <p className="text-text-muted">
                This will reset all default system prompts to their original content. Your custom prompts will not be affected.
              </p>
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-border">
              <button
                onClick={() => setShowResetModal(false)}
                className="px-4 py-2 text-sm bg-background hover:bg-surface-light border border-border rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleResetDefaults}
                className="px-4 py-2 text-sm bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors"
              >
                Reset
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add/Edit Modal */}
      {showEditModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface border border-border rounded-xl w-full max-w-2xl shadow-xl flex flex-col max-h-[85vh]">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
              <div className="flex items-center gap-2">
                <FileText className="text-primary" size={20} />
                <h3 className="text-lg font-semibold text-text-main">
                  {editingPrompt ? 'Edit Custom Prompt' : 'Add Custom Prompt'}
                </h3>
              </div>
              <button onClick={() => setShowEditModal(false)} className="text-text-muted hover:text-text-main">
                <X size={20} />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {formError && (
                <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm flex items-center gap-2">
                  <AlertTriangle size={16} /> {formError}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-text-sec mb-1.5">Title</label>
                <input
                  autoFocus
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-text-main focus:ring-primary focus:border-primary"
                  value={formTitle}
                  onChange={e => setFormTitle(e.target.value)}
                  placeholder="e.g. Code Review Guidelines"
                />
              </div>

              <div className="flex-1 min-h-[200px] flex flex-col">
                <label className="block text-xs font-medium text-text-sec mb-1.5">Content</label>
                <textarea
                  className="flex-1 w-full bg-background border border-border rounded-lg p-4 text-sm font-mono text-text-main focus:ring-primary focus:border-primary resize-none leading-relaxed min-h-[200px]"
                  value={formContent}
                  onChange={e => setFormContent(e.target.value)}
                  placeholder="Enter your custom system prompt here..."
                  spellCheck={false}
                />
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-border flex justify-end gap-3 shrink-0">
              <button
                onClick={() => setShowEditModal(false)}
                className="px-4 py-2 text-sm bg-background hover:bg-surface-light border border-border rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSavePrompt}
                className="flex items-center gap-1.5 px-4 py-2 text-sm bg-primary hover:opacity-90 text-primary-foreground rounded-lg transition-colors"
              >
                <Save size={16} />
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
