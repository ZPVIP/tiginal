import React, { useEffect, useState, useMemo } from 'react';
import {
  X,
  Save,
  UserCircle,
  Check,
  Database,
  FileText,
  Wrench,
  Wand2,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { clsx } from 'clsx';

const invoke = window.electron?.invoke || (async () => {});

interface ChatProfile {
  id: string;
  name: string;
  enabled: number;
  ai_provider_id: string | null;
  ai_model_id: string | null;
  system_prompts: string;
  tools: string;
  skills: string;
  rank: number;
}

interface AIProvider {
  id: string;
  name: string;
  type: string;
  model: string;
  is_default: number;
  available_models: string | null;
}

interface SystemPrompt {
  id: number;
  title: string;
  content: string;
  is_default: number;
  is_active: number;
}

interface ToolCategory {
  id: string;
  name: string;
  enabled: number;
}

interface Tool {
  id: string;
  categoryId: string | null;
  name: string;
  description: string | null;
  enabled: number;
}

interface SkillDirectory {
  id: string;
  name: string;
  path: string;
  enabled: number;
}

interface Skill {
  id: number;
  name: string;
  skillDirectoryId: string;
  enabled: number;
}

type TabId = 'providers' | 'prompts' | 'tools' | 'skills';

interface ProfileEditDialogProps {
  profile: ChatProfile | null; // null = creating new
  onClose: () => void;
  onSave: () => void;
}

export function ProfileEditDialog({ profile, onClose, onSave }: ProfileEditDialogProps) {
  const [activeTab, setActiveTab] = useState<TabId>('providers');
  const [name, setName] = useState(profile?.name || '');
  const [nameError, setNameError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // AI Providers state
  const [providers, setProviders] = useState<AIProvider[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);

  // System Prompts state
  const [allPrompts, setAllPrompts] = useState<SystemPrompt[]>([]);
  const [spGlobalEnabled, setSpGlobalEnabled] = useState(true);
  const [spDefaultEnabled, setSpDefaultEnabled] = useState(true);
  const [spCustomEnabled, setSpCustomEnabled] = useState(true);
  const [spDynamicGlobalEnabled, setSpDynamicGlobalEnabled] = useState(true);
  const [activePromptIds, setActivePromptIds] = useState<Set<number>>(new Set());
  const [dynamicSettings, setDynamicSettings] = useState<Record<string, boolean>>({
    dateInfo: true, wdInfo: true, systemInfo: true, appleScriptInfo: true,
  });

  // Tools state
  const [categories, setCategories] = useState<ToolCategory[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const [toolsGlobalEnabled, setToolsGlobalEnabled] = useState(true);
  const [enabledCategoryIds, setEnabledCategoryIds] = useState<Set<string>>(new Set());
  const [enabledToolIds, setEnabledToolIds] = useState<Set<string>>(new Set());
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  // Skills state
  const [directories, setDirectories] = useState<SkillDirectory[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [skillsGlobalEnabled, setSkillsGlobalEnabled] = useState(true);
  const [enabledDirIds, setEnabledDirIds] = useState<Set<string>>(new Set());
  const [enabledSkillIds, setEnabledSkillIds] = useState<Set<number>>(new Set());
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());

  // Load all data on mount
  useEffect(() => {
    loadAll();
  }, []);

  const loadAll = async () => {
    try {
      // Load providers
      const provList = await invoke('ai:get-providers');
      setProviders(provList || []);

      // Load prompts
      const promptList = await invoke('system-prompts:get-all');
      setAllPrompts(promptList || []);

      // Load tools
      const catList = await invoke('categories:get-all');
      setCategories(catList || []);
      const toolList = await invoke('tools:get-all');
      setTools(toolList || []);
      // Expand all categories by default
      setExpandedCategories(new Set((catList || []).map((c: ToolCategory) => c.id)));

      // Load skills
      const dirList = await invoke('skills:get-directories');
      setDirectories(dirList || []);
      const skillList = await invoke('skills:get-skills');
      setSkills(skillList || []);
      setExpandedDirs(new Set((dirList || []).map((d: SkillDirectory) => d.id)));

      // If editing, parse existing config
      if (profile) {
        setSelectedProviderId(profile.ai_provider_id);
        setSelectedModelId(profile.ai_model_id);

        try {
          const sp = JSON.parse(profile.system_prompts || '{}');
          if (sp.global_enabled !== undefined) setSpGlobalEnabled(sp.global_enabled);
          if (sp.default_enabled !== undefined) setSpDefaultEnabled(sp.default_enabled);
          if (sp.custom_enabled !== undefined) setSpCustomEnabled(sp.custom_enabled);
          if (sp.dynamic_prompts_global_enabled !== undefined) setSpDynamicGlobalEnabled(sp.dynamic_prompts_global_enabled);
          if (Array.isArray(sp.active_prompt_ids)) setActivePromptIds(new Set(sp.active_prompt_ids));
          if (sp.dynamic_settings) setDynamicSettings(sp.dynamic_settings);
        } catch {}

        try {
          const t = JSON.parse(profile.tools || '{}');
          if (t.global_enabled !== undefined) setToolsGlobalEnabled(t.global_enabled);
          if (Array.isArray(t.enabled_category_ids)) setEnabledCategoryIds(new Set(t.enabled_category_ids));
          if (Array.isArray(t.enabled_tool_ids)) setEnabledToolIds(new Set(t.enabled_tool_ids));
        } catch {}

        try {
          const s = JSON.parse(profile.skills || '{}');
          if (s.global_enabled !== undefined) setSkillsGlobalEnabled(s.global_enabled);
          if (Array.isArray(s.enabled_directory_ids)) setEnabledDirIds(new Set(s.enabled_directory_ids));
          if (Array.isArray(s.enabled_skill_ids)) setEnabledSkillIds(new Set(s.enabled_skill_ids));
        } catch {}
      } else {
        // For new profile, snapshot current settings as defaults
        try {
          const snapshot = await invoke('profiles:snapshot-current');
          if (snapshot) {
            setSelectedProviderId(snapshot.ai_provider_id);
            setSelectedModelId(snapshot.ai_model_id);

            const sp = snapshot.system_prompts as any;
            setSpGlobalEnabled(sp.global_enabled ?? true);
            setSpDefaultEnabled(sp.default_enabled ?? true);
            setSpCustomEnabled(sp.custom_enabled ?? true);
            setSpDynamicGlobalEnabled(sp.dynamic_prompts_global_enabled ?? true);
            setActivePromptIds(new Set(sp.active_prompt_ids || []));
            setDynamicSettings(sp.dynamic_settings || { dateInfo: true, wdInfo: true, systemInfo: true, appleScriptInfo: true });

            const t = snapshot.tools as any;
            setToolsGlobalEnabled(t.global_enabled ?? true);
            setEnabledCategoryIds(new Set(t.enabled_category_ids || []));
            setEnabledToolIds(new Set(t.enabled_tool_ids || []));

            const s = snapshot.skills as any;
            setSkillsGlobalEnabled(s.global_enabled ?? true);
            setEnabledDirIds(new Set(s.enabled_directory_ids || []));
            setEnabledSkillIds(new Set(s.enabled_skill_ids || []));
          }
        } catch (e) {
          console.error('Failed to snapshot current settings:', e);
        }
      }
    } catch (e) {
      console.error('Failed to load profile data:', e);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setNameError('Name is required');
      return;
    }
    setNameError('');
    setIsSaving(true);

    const data = {
      name: name.trim(),
      ai_provider_id: selectedProviderId,
      ai_model_id: selectedModelId,
      system_prompts: {
        global_enabled: spGlobalEnabled,
        default_enabled: spDefaultEnabled,
        custom_enabled: spCustomEnabled,
        dynamic_prompts_global_enabled: spDynamicGlobalEnabled,
        active_prompt_ids: Array.from(activePromptIds),
        dynamic_settings: dynamicSettings,
      },
      tools: {
        global_enabled: toolsGlobalEnabled,
        enabled_category_ids: Array.from(enabledCategoryIds),
        enabled_tool_ids: Array.from(enabledToolIds),
      },
      skills: {
        global_enabled: skillsGlobalEnabled,
        enabled_directory_ids: Array.from(enabledDirIds),
        enabled_skill_ids: Array.from(enabledSkillIds),
      },
    };

    try {
      if (profile) {
        await invoke('profiles:update', profile.id, data);
      } else {
        await invoke('profiles:add', data);
      }
      onSave();
    } catch (e: any) {
      // Electron prefixes IPC rejections with "Error invoking remote method '...':"
      const msg = String(e?.message || '').replace(/^Error invoking remote method '[^']*':\s*(Error:\s*)?/, '');
      setNameError(msg || 'Failed to save');
      setActiveTab('providers');
    }
    setIsSaving(false);
  };

  // Get models for the selected provider
  const providerModels = useMemo(() => {
    if (!selectedProviderId) return [];
    const prov = providers.find(p => p.id === selectedProviderId);
    if (!prov?.available_models) return prov ? [prov.model] : [];
    try {
      const models = JSON.parse(prov.available_models);
      return Array.isArray(models) ? models : [prov.model];
    } catch {
      return [prov.model];
    }
  }, [selectedProviderId, providers]);

  const defaultPrompts = useMemo(() => allPrompts.filter(p => p.is_default), [allPrompts]);
  const customPrompts = useMemo(() => allPrompts.filter(p => !p.is_default), [allPrompts]);

  const toolsByCategory = useMemo(() => {
    const map = new Map<string | null, Tool[]>();
    for (const t of tools) {
      const key = t.categoryId || '__none__';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    return map;
  }, [tools]);

  const skillsByDir = useMemo(() => {
    const map = new Map<string, Skill[]>();
    for (const s of skills) {
      if (!map.has(s.skillDirectoryId)) map.set(s.skillDirectoryId, []);
      map.get(s.skillDirectoryId)!.push(s);
    }
    return map;
  }, [skills]);

  const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: 'providers', label: 'AI Provider', icon: <Database size={14} /> },
    { id: 'prompts', label: 'System Prompts', icon: <FileText size={14} /> },
    { id: 'tools', label: 'Tools', icon: <Wrench size={14} /> },
    { id: 'skills', label: 'Skills', icon: <Wand2 size={14} /> },
  ];

  // Toggle helpers
  const togglePromptId = (id: number) => {
    setActivePromptIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleCategoryId = (id: string) => {
    setEnabledCategoryIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleToolId = (id: string) => {
    setEnabledToolIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleDirId = (id: string) => {
    setEnabledDirIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSkillId = (id: number) => {
    setEnabledSkillIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleExpandCategory = (id: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleExpandDir = (id: string) => {
    setExpandedDirs(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const dynamicPromptLabels: Record<string, string> = {
    dateInfo: 'Date & Time',
    wdInfo: 'Working Directory',
    systemInfo: 'System Info',
    appleScriptInfo: 'AppleScript',
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface border border-border rounded-xl w-full max-w-2xl shadow-xl flex flex-col h-[min(620px,100%)] max-h-full">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <UserCircle className="text-primary" size={20} />
            <h3 className="text-lg font-semibold text-text-main">
              {profile ? 'Edit Profile' : 'New Profile'}
            </h3>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-main">
            <X size={20} />
          </button>
        </div>

        {/* Name input */}
        <div className="px-6 pt-5 pb-3 shrink-0">
          <label className="block text-xs font-medium text-text-sec mb-1.5">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => { setName(e.target.value); setNameError(''); }}
            placeholder="e.g. Code review"
            className={clsx(
              'w-full bg-background border rounded-lg px-3 py-2 text-sm text-text-main outline-none transition-colors',
              nameError ? 'border-accent-danger' : 'border-border focus:border-primary'
            )}
            autoFocus
          />
          {nameError && <p className="text-xs text-accent-danger mt-1.5">{nameError}</p>}
        </div>

        {/* Tabs */}
        <div className="flex px-6 gap-1 border-b border-border shrink-0">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                activeTab === tab.id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-text-muted hover:text-text-main'
              )}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 min-h-0 px-6 py-5 flex flex-col">
          {/* AI Provider Tab */}
          {activeTab === 'providers' && (
            <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pr-1">
              {/* Provider select */}
              <div>
                <label className="text-xs font-medium text-text-muted block mb-1.5">Provider</label>
                <select
                  value={selectedProviderId || ''}
                  onChange={(e) => {
                    setSelectedProviderId(e.target.value || null);
                    setSelectedModelId(null);
                  }}
                  className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="">Select provider...</option>
                  {providers.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>

              {/* Model tiles */}
              {selectedProviderId && (
                <div>
                  <label className="text-xs font-medium text-text-muted block mb-1.5">Model</label>
                  <div className="grid grid-cols-2 gap-2">
                    {providerModels.map((model: string) => (
                      <button
                        key={model}
                        onClick={() => setSelectedModelId(model)}
                        className={clsx(
                          'flex items-center justify-between px-3 py-2 rounded-md border text-sm text-left transition-all',
                          selectedModelId === model
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border hover:border-primary/50 text-text-main'
                        )}
                      >
                        <span className="truncate">{model}</span>
                        {selectedModelId === model && <Check size={14} className="shrink-0 ml-2" />}
                      </button>
                    ))}
                  </div>
                  {providerModels.length === 0 && (
                    <p className="text-xs text-text-muted">No models available. Fetch models in AI Providers settings first.</p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* System Prompts Tab */}
          {activeTab === 'prompts' && (
            <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pr-1">
              {/* Global toggle */}
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">System Prompts</span>
                <ToggleSwitch checked={spGlobalEnabled} onChange={setSpGlobalEnabled} />
              </div>

              {spGlobalEnabled && (
                <>
                  {/* Default Prompts section */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between py-1">
                      <span className="text-xs font-semibold text-text-sec uppercase tracking-wide">Default Prompts</span>
                      <ToggleSwitch checked={spDefaultEnabled} onChange={setSpDefaultEnabled} size="sm" />
                    </div>
                    {spDefaultEnabled && defaultPrompts.map(p => (
                      <CheckRow
                        key={p.id}
                        label={p.title}
                        checked={activePromptIds.has(p.id)}
                        onChange={() => togglePromptId(p.id)}
                      />
                    ))}
                  </div>

                  {/* Custom Prompts section */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between py-1">
                      <span className="text-xs font-semibold text-text-sec uppercase tracking-wide">Custom Prompts</span>
                      <ToggleSwitch checked={spCustomEnabled} onChange={setSpCustomEnabled} size="sm" />
                    </div>
                    {spCustomEnabled && customPrompts.map(p => (
                      <CheckRow
                        key={p.id}
                        label={p.title}
                        checked={activePromptIds.has(p.id)}
                        onChange={() => togglePromptId(p.id)}
                      />
                    ))}
                    {spCustomEnabled && customPrompts.length === 0 && (
                      <p className="text-sm text-text-muted px-3 py-1.5">No custom prompts</p>
                    )}
                  </div>

                  {/* Dynamic Prompts section */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between py-1">
                      <span className="text-xs font-semibold text-text-sec uppercase tracking-wide">Dynamic Prompts</span>
                      <ToggleSwitch checked={spDynamicGlobalEnabled} onChange={setSpDynamicGlobalEnabled} size="sm" />
                    </div>
                    {spDynamicGlobalEnabled && Object.entries(dynamicPromptLabels).map(([key, label]) => (
                      <CheckRow
                        key={key}
                        label={label}
                        checked={dynamicSettings[key] ?? false}
                        onChange={() => setDynamicSettings(prev => ({ ...prev, [key]: !prev[key] }))}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Tools Tab */}
          {activeTab === 'tools' && (
            <div className="flex-1 min-h-0 flex flex-col gap-3">
              {/* Global toggle stays pinned above the scrolling list */}
              <div className="flex items-center justify-between shrink-0">
                <span className="text-sm font-medium">Tools</span>
                <ToggleSwitch checked={toolsGlobalEnabled} onChange={setToolsGlobalEnabled} />
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto space-y-3 pr-1 -mr-1">
              {toolsGlobalEnabled && categories.map(cat => {
                const catTools = toolsByCategory.get(cat.id) || [];
                const isExpanded = expandedCategories.has(cat.id);
                return (
                  <div key={cat.id} className="border border-border/50 rounded-md overflow-hidden">
                    {/* Category header */}
                    <div className="flex items-center gap-2 px-3 py-2 bg-background/50 hover:bg-surface-hover transition-colors">
                      <button
                        onClick={() => toggleExpandCategory(cat.id)}
                        className="text-text-muted hover:text-text-main"
                      >
                        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </button>
                      <span className="text-sm font-medium flex-1">{cat.name}</span>
                      <span className="text-xs text-text-muted mr-2">{catTools.length}</span>
                      <ToggleSwitch
                        checked={enabledCategoryIds.has(cat.id)}
                        onChange={() => toggleCategoryId(cat.id)}
                        size="sm"
                      />
                    </div>
                    {/* Tools in category */}
                    {isExpanded && catTools.length > 0 && (
                      <div className={clsx(
                        'border-t border-border/30 py-0.5',
                        !enabledCategoryIds.has(cat.id) && 'opacity-50 pointer-events-none'
                      )}>
                        {catTools.map(tool => (
                          <CheckRow
                            key={tool.id}
                            label={tool.name}
                            checked={enabledToolIds.has(tool.id)}
                            onChange={() => toggleToolId(tool.id)}
                            indent
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Uncategorized tools */}
              {toolsGlobalEnabled && (toolsByCategory.get('__none__') || []).length > 0 && (
                <div className="border border-border/50 rounded-md overflow-hidden">
                  <div className="px-3 py-2 bg-background/50">
                    <span className="text-xs font-medium text-text-muted">Uncategorized</span>
                  </div>
                  <div className="border-t border-border/30 py-0.5">
                    {(toolsByCategory.get('__none__') || []).map(tool => (
                      <CheckRow
                        key={tool.id}
                        label={tool.name}
                        checked={enabledToolIds.has(tool.id)}
                        onChange={() => toggleToolId(tool.id)}
                      />
                    ))}
                  </div>
                </div>
              )}
              </div>
            </div>
          )}

          {/* Skills Tab */}
          {activeTab === 'skills' && (
            <div className="flex-1 min-h-0 flex flex-col gap-3">
              {/* Global toggle stays pinned above the scrolling list */}
              <div className="flex items-center justify-between shrink-0">
                <span className="text-sm font-medium">Skills</span>
                <ToggleSwitch checked={skillsGlobalEnabled} onChange={setSkillsGlobalEnabled} />
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto space-y-3 pr-1 -mr-1">
              {skillsGlobalEnabled && directories.map(dir => {
                const dirSkills = skillsByDir.get(dir.id) || [];
                const isExpanded = expandedDirs.has(dir.id);
                return (
                  <div key={dir.id} className="border border-border/50 rounded-md overflow-hidden">
                    <div className="flex items-center gap-2 px-3 py-2 bg-background/50 hover:bg-surface-hover transition-colors">
                      <button
                        onClick={() => toggleExpandDir(dir.id)}
                        className="text-text-muted hover:text-text-main"
                      >
                        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </button>
                      <span className="text-sm font-medium flex-1">{dir.name}</span>
                      <span className="text-xs text-text-muted mr-2">{dirSkills.length}</span>
                      <ToggleSwitch
                        checked={enabledDirIds.has(dir.id)}
                        onChange={() => toggleDirId(dir.id)}
                        size="sm"
                      />
                    </div>
                    {isExpanded && dirSkills.length > 0 && (
                      <div className={clsx(
                        'border-t border-border/30 py-0.5',
                        !enabledDirIds.has(dir.id) && 'opacity-50 pointer-events-none'
                      )}>
                        {dirSkills.map(skill => (
                          <CheckRow
                            key={skill.id}
                            label={skill.name}
                            checked={enabledSkillIds.has(skill.id)}
                            onChange={() => toggleSkillId(skill.id)}
                            indent
                          />
                        ))}
                      </div>
                    )}
                    {isExpanded && dirSkills.length === 0 && (
                      <div className="border-t border-border/30 px-3 py-2">
                        <p className="text-xs text-text-muted">No skills in this directory</p>
                      </div>
                    )}
                  </div>
                );
              })}

              {skillsGlobalEnabled && directories.length === 0 && (
                <p className="text-xs text-text-muted">No skill directories configured</p>
              )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex justify-end gap-3 shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm bg-background hover:bg-surface-light border border-border rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-primary hover:opacity-90 text-primary-foreground rounded-lg transition-colors disabled:opacity-50"
          >
            <Save size={16} />
            {isSaving ? 'Saving...' : (profile ? 'Save Changes' : 'Create')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Small Reusable Components ───────────────────────────────

function ToggleSwitch({ checked, onChange, size = 'md' }: {
  checked: boolean;
  onChange: (val: boolean) => void;
  size?: 'sm' | 'md';
}) {
  const w = size === 'sm' ? 'w-7 h-4' : 'w-9 h-5';
  const dot = size === 'sm' ? 'h-3 w-3' : 'h-4 w-4';
  return (
    <label className="relative inline-flex items-center cursor-pointer">
      <input
        type="checkbox"
        className="sr-only peer"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <div className={clsx(
        w,
        'bg-border rounded-full peer-checked:bg-primary transition-colors',
        "after:content-[''] after:absolute after:top-0.5 after:start-[2px] after:bg-white after:rounded-full after:transition-all peer-checked:after:translate-x-full",
        dot === 'h-3 w-3' ? 'after:h-3 after:w-3' : 'after:h-4 after:w-4'
      )} />
    </label>
  );
}

/**
 * One selectable row: label on the left, toggle on the right. Shared by the
 * prompt, tool and skill lists so all three behave and highlight identically.
 */
function CheckRow({ label, checked, onChange, indent }: {
  label: string;
  checked: boolean;
  onChange: () => void;
  indent?: boolean;
}) {
  return (
    <label className={clsx(
      'flex items-center justify-between gap-3 px-3 py-1.5 rounded cursor-pointer transition-colors hover:bg-surface-hover',
      indent && 'pl-9'
    )}>
      <span className="text-sm text-text-main truncate">{label}</span>
      <ToggleSwitch checked={checked} onChange={onChange} size="sm" />
    </label>
  );
}
