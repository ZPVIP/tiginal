import React, { useEffect, useState } from 'react';
import { 
  Wrench, 
  Plus, 
  Trash2, 
  Check, 
  X, 
  FileJson,
  ChevronDown,
  ChevronUp,
  Bot,
  Download
} from 'lucide-react';
import { clsx } from 'clsx';
import { AIProvider } from '../../settings/ai-constants';

const invoke = window.electron?.invoke || (async () => {});

interface Tool {
  id: string;
  name: string;
  description?: string;
  inputSchema: object;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export function ToolsSettings() {
  const [tools, setTools] = useState<Tool[]>([]);
  const [providers, setProviders] = useState<AIProvider[]>([]);
  const [selectedToolModel, setSelectedToolModel] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  // Add tool modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [newToolName, setNewToolName] = useState('');
  const [newToolDesc, setNewToolDesc] = useState('');
  const [newToolSchema, setNewToolSchema] = useState('{\n  "type": "object",\n  "properties": {\n    "command": {\n      "type": "string",\n      "description": "Command to execute"\n    }\n  },\n  "required": ["command"]\n}');
  const [addError, setAddError] = useState('');

  // Expanded tool IDs for viewing schema
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [toolList, providerList, savedModel] = await Promise.all([
        invoke('tools:get-all'),
        invoke('ai:get-providers'),
        invoke('tools:get-model'),
      ]);
      setTools(toolList || []);
      setProviders(providerList || []);
      setSelectedToolModel(savedModel || '');
    } catch (err) {
      console.error('Failed to load tools data', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleModelChange = async (value: string) => {
    setSelectedToolModel(value);
    await invoke('tools:set-model', value);
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    await invoke('tools:toggle', id, enabled);
    setTools(prev => prev.map(t => t.id === id ? { ...t, enabled } : t));
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this tool?')) return;
    await invoke('tools:delete', id);
    setTools(prev => prev.filter(t => t.id !== id));
  };

  const handleAddTool = async () => {
    setAddError('');
    
    if (!newToolName.trim()) {
      setAddError('Please enter a tool name');
      return;
    }

    let schema: object;
    try {
      schema = JSON.parse(newToolSchema);
    } catch (e) {
      setAddError('Invalid JSON Schema format');
      return;
    }

    try {
      const tool = await invoke('tools:add', {
        name: newToolName.trim(),
        description: newToolDesc.trim() || undefined,
        inputSchema: schema,
        enabled: true,
      });
      setTools(prev => [...prev, tool]);
      setShowAddModal(false);
      setNewToolName('');
      setNewToolDesc('');
      setNewToolSchema('{\n  "type": "object",\n  "properties": {},\n  "required": []\n}');
    } catch (err) {
      setAddError((err as Error).message);
    }
  };

  const handleImportJson = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        const json = JSON.parse(text);
        
        // Extract tools array
        let toolsArray = [];
        if (Array.isArray(json)) {
          toolsArray = json;
        } else if (json.tools && Array.isArray(json.tools)) {
          toolsArray = json.tools;
        } else {
          alert('Invalid tools JSON file');
          return;
        }

        const result = await invoke('tools:import-from-json', toolsArray);
        alert(`Import complete: Added ${result.added}, Skipped ${result.skipped}`);
        loadData();
      } catch (err) {
        alert('Import failed: ' + (err as Error).message);
      }
    };
    input.click();
  };

  const handleImportPreset = async () => {
    try {
      const result = await invoke('tools:import-preset') as { added: number; updated: number };
      alert(`System preset imported: Added ${result.added}, Updated ${result.updated}`);
      loadData();
    } catch (err) {
      alert('Import failed: ' + (err as Error).message);
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Build model options from providers
  const modelOptions = providers.flatMap(p => {
    const models = p.availableModels || [];
    return models
      .filter((m: any) => typeof m === 'string' || m.enabled !== false)
      .map((m: any) => ({
        value: `${p.id}:${typeof m === 'string' ? m : m.id}`,
        label: `${p.name} / ${typeof m === 'string' ? m : m.name || m.id}`,
      }));
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Tool Model Selection */}
      <section className="space-y-4">
        <h3 className="text-xl font-semibold flex items-center gap-2 text-text-main">
          <Bot className="w-5 h-5 text-blue-400" />
          Tool Model
        </h3>
        <p className="text-sm text-text-muted">
          Select the AI model for executing tool calls. Not all models support tool calling.
        </p>

        <div className="bg-surface border border-border rounded-lg p-6">
          <div className="flex flex-col gap-2 max-w-md">
            <label className="text-sm font-medium text-text-sec">AI Model for Tools</label>
            <select
              value={selectedToolModel}
              onChange={(e) => handleModelChange(e.target.value)}
              className="bg-background border border-border text-text-main text-sm rounded-lg focus:ring-primary focus:border-primary block w-full p-2.5"
            >
              <option value="">-- Select Model --</option>
              {modelOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <p className="text-xs text-text-muted">
              Recommended: claude-sonnet-4-5, gpt-4, gpt-4o
            </p>
          </div>
        </div>
      </section>

      {/* Tools List */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-semibold flex items-center gap-2 text-text-main">
            <Wrench className="w-5 h-5 text-green-400" />
            Available Tools
          </h3>
          <div className="flex gap-2">
            <button
              onClick={handleImportPreset}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition-colors"
            >
              <Download size={16} />
              Import System Preset
            </button>
            <button
              onClick={handleImportJson}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-surface hover:bg-surface-light border border-border rounded-lg transition-colors"
            >
              <FileJson size={16} />
              Import JSON
            </button>
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary hover:bg-blue-600 text-white rounded-lg transition-colors"
            >
              <Plus size={16} />
              Add Tool
            </button>
          </div>
        </div>
        <p className="text-sm text-text-muted">
          Manage tools that AI can invoke. Enabled tools are included in AI requests.
        </p>

        <div className="bg-surface border border-border rounded-lg overflow-hidden">
          {tools.length === 0 ? (
            <div className="p-8 text-center text-text-muted">
              <Wrench className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No tools available</p>
              <p className="text-sm mt-1">Click "Import System Preset" or "Add Tool" to get started</p>
            </div>
          ) : (
            <table className="w-full">
              <thead className="bg-background/50">
                <tr>
                  <th className="text-left px-4 py-3 text-sm font-medium text-text-sec">Name</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-text-sec">Description</th>
                  <th className="text-center px-4 py-3 text-sm font-medium text-text-sec">Enabled</th>
                  <th className="text-right px-4 py-3 text-sm font-medium text-text-sec">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {tools.map(tool => (
                  <React.Fragment key={tool.id}>
                    <tr className="hover:bg-background/30 transition-colors">
                      <td className="px-4 py-3">
                        <button
                          onClick={() => toggleExpand(tool.id)}
                          className="flex items-center gap-1 text-text-main font-medium hover:text-primary"
                        >
                          {expandedIds.has(tool.id) ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                          {tool.name}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-sm text-text-muted max-w-xs truncate">
                        {tool.description || '-'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => handleToggle(tool.id, !tool.enabled)}
                          className={clsx(
                            "w-10 h-5 rounded-full relative transition-colors",
                            tool.enabled ? "bg-green-500" : "bg-gray-600"
                          )}
                        >
                          <div className={clsx(
                            "absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all",
                            tool.enabled ? "left-5" : "left-0.5"
                          )} />
                        </button>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => handleDelete(tool.id)}
                          className="p-1.5 text-text-muted hover:text-red-400 hover:bg-red-400/10 rounded transition-colors"
                          title="Delete"
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                    {expandedIds.has(tool.id) && (
                      <tr>
                        <td colSpan={4} className="px-4 py-3 bg-background/50">
                          <div className="text-xs font-mono">
                            <div className="text-text-sec mb-1">Input Schema:</div>
                            <pre className="bg-background p-3 rounded-lg overflow-x-auto text-text-muted">
                              {JSON.stringify(tool.inputSchema, null, 2)}
                            </pre>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* Add Tool Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-surface border border-border rounded-xl w-full max-w-lg mx-4 shadow-xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h3 className="text-lg font-semibold text-text-main">Add Tool</h3>
              <button onClick={() => setShowAddModal(false)} className="text-text-muted hover:text-text-main">
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {addError && (
                <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
                  {addError}
                </div>
              )}

              <div>
                <label className="block mb-1.5 text-sm font-medium text-text-sec">Tool Name *</label>
                <input
                  type="text"
                  value={newToolName}
                  onChange={(e) => setNewToolName(e.target.value)}
                  placeholder="e.g., Bash"
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-text-main focus:ring-primary focus:border-primary"
                />
              </div>

              <div>
                <label className="block mb-1.5 text-sm font-medium text-text-sec">Description</label>
                <input
                  type="text"
                  value={newToolDesc}
                  onChange={(e) => setNewToolDesc(e.target.value)}
                  placeholder="Execute bash commands"
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-text-main focus:ring-primary focus:border-primary"
                />
              </div>

              <div>
                <label className="block mb-1.5 text-sm font-medium text-text-sec">Input Schema (JSON) *</label>
                <textarea
                  value={newToolSchema}
                  onChange={(e) => setNewToolSchema(e.target.value)}
                  rows={8}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-text-main font-mono focus:ring-primary focus:border-primary"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 px-6 py-4 border-t border-border">
              <button
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 text-sm bg-background hover:bg-surface-light border border-border rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAddTool}
                className="flex items-center gap-1.5 px-4 py-2 text-sm bg-primary hover:bg-blue-600 text-white rounded-lg transition-colors"
              >
                <Check size={16} />
                Add
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
