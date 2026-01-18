import React, { useState } from 'react';
import { Tabs } from '../ui/Tabs';
import { Settings as SettingsIcon, Database, Shield, Palette } from 'lucide-react';
import { GeneralSettings } from './GeneralSettings';
import { AIProviders } from './AIProviders';
import { ThemeSettings } from './ThemeSettings';

export function Settings() {
  const [activeTab, setActiveTab] = useState('general');

  const tabs = [
    { id: 'general', label: 'General', icon: <SettingsIcon size={16} /> },
    { id: 'providers', label: 'AI Providers', icon: <Database size={16} /> },
    { id: 'ssh', label: 'SSH (Coming Soon)', icon: <Shield size={16} /> }, // Placeholder
    { id: 'theme', label: 'Theme', icon: <Palette size={16} /> },
  ];

  return (
    <div className="flex h-full w-full bg-surface">
      {/* Sidebar */}
      <div className="w-64 border-r border-border p-4 bg-background/50 backdrop-blur-sm">
        <h2 className="text-lg font-semibold mb-6 px-2 flex items-center gap-2">
          <SettingsIcon className="w-5 h-5" />
          Settings
        </h2>
        <Tabs 
          tabs={tabs} 
          activeTab={activeTab} 
          onChange={setActiveTab} 
        />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-3xl mx-auto">
          {activeTab === 'general' && <GeneralSettings />}
          {activeTab === 'providers' && <AIProviders />}
          {activeTab === 'ssh' && (
             <div className="flex flex-col items-center justify-center h-64 text-text-muted">
                <Shield size={48} className="mb-4 opacity-50" />
                <p>SSH Keys and Host Config coming soon.</p>
             </div>
          )}
          {activeTab === 'theme' && <ThemeSettings />}
        </div>
      </div>
    </div>
  );
}
