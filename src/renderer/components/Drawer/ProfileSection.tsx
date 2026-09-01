import React, { useState, useEffect, useCallback } from 'react';
import { ChevronDown, ChevronRight, Plus, UserCircle } from 'lucide-react';
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
  mcp: string | null;
}

interface ProfileSectionProps {
  activeProfileId: string | null;
  onApplyProfile: (profileId: string) => void;
  onSaveCurrentAsProfile: () => void;
}

export function ProfileSection({ activeProfileId, onApplyProfile, onSaveCurrentAsProfile }: ProfileSectionProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [profiles, setProfiles] = useState<ChatProfile[]>([]);

  const loadProfiles = useCallback(async () => {
    try {
      const list = await invoke('profiles:get-enabled');
      setProfiles(list || []);
    } catch (e) {
      console.error('Failed to load profiles:', e);
    }
  }, []);

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  // Listen for profile changes from Settings
  useEffect(() => {
    const handler = () => loadProfiles();
    window.addEventListener('profiles-updated', handler);
    return () => window.removeEventListener('profiles-updated', handler);
  }, [loadProfiles]);

  if (profiles.length === 0) return null;

  return (
    <div className="border-b border-border">
      {/* Header - matches FAVORITES / CATEGORIES style */}
      <div
        className="flex items-center px-3 py-2 cursor-pointer hover:bg-elevated transition-colors h-8 border-b border-border"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <span className="text-xs font-medium text-text-muted uppercase tracking-wider flex-1">
          PROFILES {profiles.length > 0 && `(${profiles.length})`}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onSaveCurrentAsProfile();
          }}
          className="p-0.5 text-text-muted hover:text-primary transition-colors mr-1"
          title="Save current settings as profile"
        >
          <Plus size={12} />
        </button>
        {isExpanded ? (
          <ChevronDown size={14} className="text-text-muted" />
        ) : (
          <ChevronRight size={14} className="text-text-muted" />
        )}
      </div>

      {/* Profile list */}
      {isExpanded && (
        <div className="pb-1">
          {profiles.map((profile) => (
            <div
              key={profile.id}
              onClick={() => onApplyProfile(profile.id)}
              className={clsx(
                'flex items-center gap-2 px-3 py-1.5 cursor-pointer transition-colors text-sm',
                activeProfileId === profile.id
                  ? 'bg-primary/10 text-primary border-l-2 border-primary'
                  : 'text-text-main hover:bg-elevated pl-[14px]'
              )}
            >
              <UserCircle size={14} className="shrink-0 opacity-60" />
              <span className="truncate text-xs">{profile.name}</span>
              {profile.ai_model_id && (
                <span className="text-[10px] text-text-muted truncate ml-auto opacity-60">
                  {profile.ai_model_id}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
