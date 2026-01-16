import React, { useState, useEffect } from 'react';
import { Modal } from '../ui/Modal';
import { RefreshCw, Check, AlertTriangle } from 'lucide-react';
import { clsx } from 'clsx';

export interface AIProvider {
  id: string;
  name: string;
  type: 'openai-compatible' | 'copilot';
  endpoint?: string;
  apiKey?: string; // Decrypted for UI
  apiKeyEncrypted?: string;
  model: string;
  availableModels?: string[];
  customHeaders?: Record<string, string>;
  autoCORSFix?: boolean;
  isDefault: boolean;
}

export const OAI_API_PROVIDERS = [
  { label: "OpenAI", value: "openai", baseUrl: "https://api.openai.com/v1" },
  { label: "Ollama", value: "ollama", baseUrl: "http://localhost:11434/v1" },
  { label: "DeepSeek", value: "deepseek", baseUrl: "https://api.deepseek.com" },
  { label: "Anthropic (Claude)", value: "anthropic", baseUrl: "https://api.anthropic.com/v1" },
  { label: "Custom", value: "custom", baseUrl: "" },
];

interface ProviderModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialData?: Partial<AIProvider>;
  onSave: (data: any) => Promise<void>;
}

// Mock invoke
const invoke = window.electron?.invoke || (async () => {});

export function ProviderModal({ isOpen, onClose, initialData, onSave }: ProviderModalProps) {
  const [formData, setFormData] = useState<Partial<AIProvider>>({
      type: 'openai-compatible',
      name: '',
      endpoint: '',
      apiKey: '',
      model: '',
      autoCORSFix: true,
      isDefault: false,
      ...initialData
  });
  const [preset, setPreset] = useState('custom');
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success?: boolean; error?: string; models?: string[] } | null>(null);

  useEffect(() => {
     // Try to match endpoint to preset
     if (initialData?.endpoint) {
         const found = OAI_API_PROVIDERS.find(p => p.baseUrl === initialData.endpoint);
         if (found) setPreset(found.value);
         else setPreset('custom');
     }
  }, [initialData]);

  const handleChange = (field: string, value: any) => {
      setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handlePresetChange = (value: string) => {
      setPreset(value);
      const found = OAI_API_PROVIDERS.find(p => p.value === value);
      if (found && value !== 'custom') {
          setFormData(prev => ({ 
              ...prev, 
              endpoint: found.baseUrl,
              name: prev.name || found.label // Auto-fill name if empty
          }));
      }
  };

  const handleTest = async () => {
      setIsTesting(true);
      setTestResult(null);
      try {
          const res = await invoke('ai:test-connection', {
              type: formData.type,
              endpoint: formData.endpoint,
              apiKey: formData.apiKey,
              customHeaders: formData.customHeaders,
              autoCORSFix: formData.autoCORSFix
          });
          setTestResult(res);
          if (res.success && res.models && res.models.length > 0) {
              setFormData(prev => ({ ...prev, availableModels: res.models }));
          }
      } finally {
          setIsTesting(false);
      }
  };

  const handleSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      await onSave(formData);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={initialData?.id ? 'Edit Provider' : 'Add Provider'} width="max-w-xl">
       <form onSubmit={handleSubmit} className="p-6 space-y-4">
           
           {/* Preset Selector */}
           <div>
               <label className="block text-sm font-medium text-gray-300 mb-1">Provider Preset</label>
               <select 
                  value={preset} 
                  onChange={(e) => handlePresetChange(e.target.value)}
                  className="w-full bg-background border border-border rounded-lg p-2.5 text-sm"
               >
                   {OAI_API_PROVIDERS.map(p => (
                       <option key={p.value} value={p.value}>{p.label}</option>
                   ))}
               </select>
           </div>

           <div className="grid grid-cols-2 gap-4">
               <div>
                   <label className="block text-sm font-medium text-gray-300 mb-1">Name</label>
                   <input 
                      type="text" 
                      required
                      value={formData.name}
                      onChange={(e) => handleChange('name', e.target.value)}
                      className="w-full bg-background border border-border rounded-lg p-2.5 text-sm"
                      placeholder="e.g. Work GPT"
                   />
               </div>
               <div>
                   <label className="block text-sm font-medium text-gray-300 mb-1">Default Model ID</label>
                    <div className="flex gap-2">
                        {testResult?.models && testResult.models.length > 0 ? (
                            <select 
                                value={formData.model}
                                onChange={(e) => handleChange('model', e.target.value)}
                                className="w-full bg-background border border-border rounded-lg p-2.5 text-sm"
                            >
                                <option value="">Select a model...</option>
                                {testResult.models.map(m => <option key={m} value={m}>{m}</option>)}
                            </select>
                        ) : (
                            <input 
                                type="text" 
                                required
                                value={formData.model}
                                onChange={(e) => handleChange('model', e.target.value)}
                                className="w-full bg-background border border-border rounded-lg p-2.5 text-sm"
                                placeholder="gpt-4o"
                            />
                        )}
                    </div>
               </div>
           </div>

           <div>
               <label className="block text-sm font-medium text-gray-300 mb-1">API Endpoint</label>
               <input 
                  type="url" 
                  required
                  value={formData.endpoint}
                  onChange={(e) => handleChange('endpoint', e.target.value)}
                  className="w-full bg-background border border-border rounded-lg p-2.5 text-sm font-mono"
                  placeholder="https://api.openai.com/v1"
               />
           </div>

           <div>
               <label className="block text-sm font-medium text-gray-300 mb-1">API Key</label>
               <input 
                  type="password" 
                  value={formData.apiKey}
                  onChange={(e) => handleChange('apiKey', e.target.value)}
                  className="w-full bg-background border border-border rounded-lg p-2.5 text-sm font-mono"
                  placeholder="sk-..."
               />
           </div>

           <div className="flex items-center gap-4 py-2">
               <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                   <input 
                      type="checkbox"
                      checked={formData.isDefault}
                      onChange={(e) => handleChange('isDefault', e.target.checked)}
                      className="rounded border-gray-600 bg-background text-primary focus:ring-primary"
                   />
                   Set as Default Provider
               </label>
           </div>

           {/* Test Connection Button */}
           <div className="flex items-center gap-4 bg-surface/50 p-3 rounded-lg border border-border">
               <button 
                  type="button"
                  onClick={handleTest}
                  disabled={isTesting || !formData.endpoint}
                  className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-xs font-medium flex items-center gap-2 transition-colors disabled:opacity-50"
               >
                   {isTesting ? <RefreshCw size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                   Test Connection
               </button>
               
               {testResult && (
                   <div className={clsx("text-xs flex items-center gap-1", testResult.success ? "text-green-400" : "text-red-400")}>
                       {testResult.success ? <Check size={14} /> : <AlertTriangle size={14} />}
                       {testResult.success ? "Connected!" : "Failed"} 
                   </div>
               )}
               {testResult?.error && <div className="text-xs text-red-400 truncate max-w-xs" title={testResult.error}>{testResult.error}</div>}
           </div>

           <div className="pt-4 flex justify-end gap-3 border-t border-border mt-4">
               <button 
                  type="button" 
                  onClick={onClose}
                  className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
               >
                   Cancel
               </button>
               <button 
                  type="submit"
                  className="px-4 py-2 bg-primary hover:bg-blue-600 text-white rounded-lg text-sm font-medium transition-colors"
               >
                   Save Provider
               </button>
           </div>
       </form>
    </Modal>
  );
}
