import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Modal } from '../ui/Modal';
import { RefreshCw, Check, AlertTriangle, ChevronDown, Eye, EyeOff } from 'lucide-react';
import { clsx } from 'clsx';
// Import icons from the correct path
import { ICONS } from '../../settings/icons';
import { OAI_API_PROVIDERS, AIProvider, ModelConfig } from '../../settings/ai-constants';
import { FancySelect } from '../ui/FancySelect';

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
  const [showApiKey, setShowApiKey] = useState(false);
  
  // Custom Select State
  const [isPresetOpen, setIsPresetOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 0 });
  const presetRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
     // Try to match endpoint to preset
     if (initialData?.endpoint) {
         const found = OAI_API_PROVIDERS.find(p => p.baseUrl === initialData.endpoint);
         if (found) setPreset(found.value);
         else setPreset('custom');
     }
  }, [initialData]);

  // Click outside to close preset dropdown
  useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
          const target = event.target as Node;
          const isInsideTrigger = presetRef.current?.contains(target);
          const isInsideDropdown = dropdownRef.current?.contains(target);

          if (!isInsideTrigger && !isInsideDropdown) {
              setIsPresetOpen(false);
          }
      };
      
      if (isPresetOpen) {
          // Use capture so parent handlers calling stopPropagation (e.g. draggable modal surfaces)
          // don't prevent outside-click closing.
          document.addEventListener('mousedown', handleClickOutside, true);
          // Also update coords on scroll/resize ideally, or just close
          const handleResize = () => setIsPresetOpen(false);
          window.addEventListener('resize', handleResize);
          return () => {
              document.removeEventListener('mousedown', handleClickOutside, true);
              window.removeEventListener('resize', handleResize);
          };
      }
  }, [isPresetOpen]);

  const handleChange = (field: string, value: any) => {
      setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handlePresetSelect = (provider: typeof OAI_API_PROVIDERS[0]) => {
      setPreset(provider.value);
      setIsPresetOpen(false);
      
      if (provider.value !== 'custom') {
          setFormData(prev => ({ 
              ...prev, 
              endpoint: provider.baseUrl,
              name: prev.name || provider.label // Auto-fill name if empty
          }));
      }
  };
  
  const togglePreset = () => {
      if (!isPresetOpen && presetRef.current) {
          const rect = presetRef.current.getBoundingClientRect();
          setCoords({
              top: rect.bottom + window.scrollY + 4,
              left: rect.left + window.scrollX,
              width: rect.width
          });
          setIsPresetOpen(true);
      } else {
          setIsPresetOpen(false);
      }
  };

  const handleTest = async () => {
      setIsTesting(true);
      setTestResult(null);
      try {
          const res = await invoke('ai:test-connection', {
              id: formData.id, // Pass ID for fallback lookup
              type: formData.type,
              endpoint: formData.endpoint,
              apiKey: formData.apiKey,
              customHeaders: formData.customHeaders,
              autoCORSFix: formData.autoCORSFix
          });
          setTestResult(res);
          if (res.success && res.models && res.models.length > 0) {
              // Strict Sync Logic: New list based on Server IDs
              const localEnabledMap = new Map<string, boolean>();
              const existingModels = formData.availableModels || [];
              existingModels.forEach(m => {
                   const name = m.name;
                   localEnabledMap.set(name, m.enabled !== false);
              });
              
              const mergedModels: ModelConfig[] = [];
              const uniqueIds = new Set<string>();

              res.models.forEach((id: string) => {
                  if (!uniqueIds.has(id)) {
                      uniqueIds.add(id);
                      const name = id;
                      const isEnabled = localEnabledMap.has(name) ? (localEnabledMap.get(name) ?? true) : true;
                      mergedModels.push({ id, name, enabled: isEnabled });
                  }
              });
              
              setFormData(prev => {
                  let newModel = prev.model || '';
                  // Check if current model exists in the new list
                  const exists = mergedModels.some(m => m.id === newModel);
                  if (!exists && mergedModels.length > 0) {
                      const firstEnabled = mergedModels.find(m => m.enabled !== false);
                      newModel = firstEnabled ? firstEnabled.id : mergedModels[0].id;
                  }
                  
                  return { 
                      ...prev, 
                      availableModels: mergedModels,
                      model: newModel
                  };
              });
          }
      } finally {
          setIsTesting(false);
      }
  };

  const handleSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      
      let finalData = { ...formData };
      
      // Localhost check
      if (finalData.endpoint && finalData.endpoint.includes('localhost')) {
          const shouldReplace = window.confirm(
              "Using 'localhost' may cause connection issues with some AI providers (e.g. Ollama).\n\n" +
              "Do you want to switch to '127.0.0.1' instead? (Recommended)"
          );
          
          if (shouldReplace) {
              finalData.endpoint = finalData.endpoint.replace('localhost', '127.0.0.1');
              setFormData(finalData); // Update UI too
          }
      }

      await onSave(finalData);
  };

  const selectedPreset = OAI_API_PROVIDERS.find(p => p.value === preset) || OAI_API_PROVIDERS[0];

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={initialData?.id ? 'Edit Provider' : 'Add Provider'} width="max-w-xl">
       <form onSubmit={handleSubmit} className="p-6 space-y-4">
           
           {/* Custom Preset Selector */}
           <div className="relative" ref={presetRef}>
               <label className="block text-sm font-medium text-gray-300 mb-1">Provider Preset</label>
               <button
                  type="button"
                  onClick={togglePreset}
                  className="w-full bg-background border border-border rounded-lg p-2.5 text-sm flex items-center justify-between hover:border-gray-500 transition-colors"
               >
                   <div className="flex items-center gap-2">
                       <div 
                           className="w-5 h-5 flex items-center justify-center text-gray-400"
                           dangerouslySetInnerHTML={{ __html: ICONS[selectedPreset.value] || ICONS.default }} 
                       />
                       <span>{selectedPreset.label}</span>
                   </div>
                   <ChevronDown size={16} className={clsx("text-gray-500 transition-transform", isPresetOpen ? "rotate-180" : "")} />
               </button>

               {/* Dropdown Menu Portal */}
               {isPresetOpen && createPortal(
                   <div 
                       ref={dropdownRef}
                       style={{ 
                           top: coords.top, 
                           left: coords.left, 
                           width: coords.width,
                           maxHeight: '300px'
                       }}
                       className="fixed z-[9999] bg-surface border border-border rounded-lg shadow-xl overflow-y-auto"
                   >
                       {OAI_API_PROVIDERS.filter(p => p.value !== 'copilot').map(p => (
                           <button
                               key={p.value}
                               type="button"
                               onClick={() => handlePresetSelect(p)}
                               className="w-full p-2.5 text-left text-sm hover:bg-white/5 flex items-center gap-2 transition-colors border-b border-white/5 last:border-0"
                           >
                               <div 
                                   className="w-5 h-5 flex items-center justify-center text-gray-400"
                                   dangerouslySetInnerHTML={{ __html: ICONS[p.value] || ICONS.default }} 
                               />
                               <span className="font-medium">{p.label}</span>
                               {p.baseUrl && <span className="text-xs text-gray-500 ml-auto truncate max-w-[150px]">{new URL(p.baseUrl).hostname}</span>}
                           </button>
                       ))}
                   </div>,
                   document.body
               )}
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
                   <label className="block text-sm font-medium text-gray-300 mb-1">Models</label>
                    <FancySelect
                      className="w-full"
                      value={formData.model || ''}
                      onChange={(val) => handleChange('model', val)}
                      options={(formData.availableModels || []).map(m => ({ value: m.id, label: m.name }))}
                      buttonClassName="bg-background"
                    />
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
                <div className="relative">
                    <input 
                       type={showApiKey ? "text" : "password"}
                       value={formData.apiKey}
                       onChange={(e) => handleChange('apiKey', e.target.value)}
                       className="w-full bg-background border border-border rounded-lg p-2.5 pr-10 text-sm font-mono"
                       placeholder="sk-..."
                    />
                    <button
                        type="button"
                        onClick={() => setShowApiKey(!showApiKey)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white transition-colors"
                    >
                        {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                </div>
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
