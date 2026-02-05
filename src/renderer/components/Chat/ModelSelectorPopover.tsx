import React, { useState, useEffect, useMemo } from 'react';
import { X, Search, ChevronDown, ChevronRight, Check } from 'lucide-react';
import { clsx } from 'clsx';
import { Bot } from 'lucide-react';
import { ICONS } from '../../settings/icons';
import { OAI_API_PROVIDERS } from '../../settings/ai-constants';

interface ModelOption {
    providerId: string;
    modelId: string;
    label: string;
}

interface ModelSelectorPopoverProps {
  onClose: () => void;
  models: ModelOption[];
  selectedProviderId: string;
  selectedModel: string;
  onSelect: (providerId: string, modelId: string) => void;
}

export const ModelSelectorPopover: React.FC<ModelSelectorPopoverProps> = ({ 
    onClose, 
    models, 
    selectedProviderId, 
    selectedModel,
    onSelect
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  // Expanded providers state - default all expanded
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(new Set());

  // Group models by provider
  const groupedModels = useMemo(() => {
    const groups: Record<string, ModelOption[]> = {};
    const providerNames: Record<string, string> = {};

    models.forEach(m => {
        if (!groups[m.providerId]) {
            groups[m.providerId] = [];
            // Extract provider name from label "Provider / Model"
            // Or ideally use a separate provider name map if available, but here we can parse it
            const parts = m.label.split(' / ');
            providerNames[m.providerId] = parts[0] || m.providerId;
        }
        groups[m.providerId].push(m);
    });

    return { groups, providerNames };
  }, [models]);

  // Expand all initially
  useEffect(() => {
      setExpandedProviders(new Set(Object.keys(groupedModels.groups)));
  }, [groupedModels.groups]); // Ideally run once or when provider set changes

  const toggleExpand = (providerId: string) => {
    const newSet = new Set(expandedProviders);
    if (newSet.has(providerId)) newSet.delete(providerId);
    else newSet.add(providerId);
    setExpandedProviders(newSet);
  };

  const toggleGlobalExpand = () => {
    if (expandedProviders.size === Object.keys(groupedModels.groups).length) {
      setExpandedProviders(new Set());
    } else {
      setExpandedProviders(new Set(Object.keys(groupedModels.groups)));
    }
  };

  const filteredGroups = useMemo(() => {
      if (!searchQuery.trim()) return groupedModels.groups;

      const filtered: Record<string, ModelOption[]> = {};
      Object.keys(groupedModels.groups).forEach(pId => {
          const matched = groupedModels.groups[pId].filter(m => 
              m.label.toLowerCase().includes(searchQuery.toLowerCase()) || 
              m.modelId.toLowerCase().includes(searchQuery.toLowerCase())
          );
          if (matched.length > 0) {
              filtered[pId] = matched;
          }
      });
      return filtered;
  }, [groupedModels.groups, searchQuery]);

  return (
    <div className="absolute bottom-full left-0 mb-4 w-72 md:w-80 bg-surface border border-border rounded-xl shadow-xl z-50 flex flex-col max-h-[500px] animate-in fade-in slide-in-from-bottom-2">
        {/* Header */}
        <div className="flex items-center justify-between p-4 bg-surface-light/50 rounded-t-xl backdrop-blur-sm shrink-0">
            <h3 className="font-medium text-text-main flex items-center gap-2">
                <Bot size={16} />
                <span>Select Model</span>
            </h3>
            <button 
                onClick={onClose}
                className="p-1 hover:bg-surface-hover rounded-md text-text-muted hover:text-text-main transition-colors"
            >
                <X size={16} />
            </button>
        </div>

        {/* Search */}
        <div className="p-3 shrink-0">
            <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                <input 
                    type="text" 
                    placeholder="Search models..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-surface-light border border-border rounded-lg pl-9 pr-3 py-1.5 text-sm text-text-main placeholder-text-muted focus:outline-none focus:border-primary/50 transition-colors"
                    autoFocus
                />
            </div>
        </div>

        {/* Global Expand Toggle */}
        <div className="px-3 py-1 border-b border-border flex justify-end">
            <button onClick={toggleGlobalExpand} className="text-[10px] text-primary hover:underline">
            {expandedProviders.size === Object.keys(groupedModels.groups).length ? 'Collapse All' : 'Expand All'}
            </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto p-2 flex-col gap-2 flex-1 min-h-0">
            {Object.keys(filteredGroups).length === 0 ? (
                <div className="p-4 text-center text-text-muted text-sm">No models found</div>
            ) : (
                Object.keys(filteredGroups)
                    .sort((a, b) => {
                        const nameA = groupedModels.providerNames[a] || a;
                        const nameB = groupedModels.providerNames[b] || b;
                        return nameA.localeCompare(nameB);
                    })
                    .map(providerId => {
                    const providerName = groupedModels.providerNames[providerId];
                    const ms = filteredGroups[providerId];
                    const isExpanded = expandedProviders.has(providerId);

                    return (
                        <div key={providerId} className="rounded-lg client-group mb-1">
                             {/* Group Header */}
                             <button 
                                onClick={() => toggleExpand(providerId)}
                                className="w-full flex items-center justify-between p-2 hover:bg-surface-hover/50 transition-colors rounded text-left"
                             >
                                <div className="flex items-center gap-2">
                                    {isExpanded ? <ChevronDown size={14} className="text-text-muted" /> : <ChevronRight size={14} className="text-text-muted" />}
                                    <div className="w-4 h-4 rounded-full bg-accent/10 flex items-center justify-center text-accent shrink-0 overflow-hidden">
                                        {(() => {
                                            // Find provider info by name - simplistic match for now as we don't have endpoint easily here
                                            // Actually we can infer from providerId which is lowercase often, but label is "Name"
                                            // OAI_API_PROVIDERS values match provider names usually? Check values vs providerId
                                            
                                            // Mapping: providerId is often the 'value' from OAI_API_PROVIDERS if created via UI presets
                                            // But if custom named, providerId is UUID.
                                            // We have providerName (display name).
                                            
                                            // Best effort: Find by label (Name)
                                            const providerInfo = OAI_API_PROVIDERS.find(p => p.label === providerName);
                                            const iconKey = providerInfo?.value;
                                            const iconSvg = iconKey && ICONS[iconKey];
                                            
                                            if (iconSvg) return <div className="w-3 h-3" dangerouslySetInnerHTML={{ __html: iconSvg }} />;
                                            return <Bot size={12} />;
                                        })()}
                                    </div>
                                    <span className="text-xs font-semibold text-text-main">{providerName}</span>
                                </div>
                                <span className="text-[10px] text-text-muted bg-surface border border-border px-1.5 rounded">{ms.length}</span>
                             </button>

                             {/* Models List */}
                             {isExpanded && (
                                 <div className="mt-1 space-y-0.5">
                                     {ms.map(m => {
                                         const isSelected = m.providerId === selectedProviderId && m.modelId === selectedModel;
                                         // Display model name only (strip provider prefix if commonly present in label)
                                         // Our label format is "Provider / Model"
                                         const modelName = m.label.split(' / ')[1] || m.label;

                                         return (
                                             <button
                                                key={`${m.providerId}:${m.modelId}`}
                                                onClick={() => {
                                                    onSelect(m.providerId, m.modelId);
                                                    onClose();
                                                }}
                                                className={clsx(
                                                    "w-full flex items-center justify-between p-2 pl-8 rounded text-left transition-colors text-sm group",
                                                    isSelected ? "bg-primary/10 text-primary" : "text-text-sec hover:text-text-main hover:bg-surface-hover"
                                                )}
                                             >
                                                 <span className="truncate mr-2">{modelName}</span>
                                                 {isSelected && <Check size={14} className="shrink-0" />}
                                             </button>
                                         );
                                     })}
                                 </div>
                             )}
                        </div>
                    );
                })
            )}
        </div>
    </div>
  );
};
