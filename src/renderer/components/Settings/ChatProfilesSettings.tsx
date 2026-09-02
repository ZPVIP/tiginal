import React, { useEffect, useState } from 'react';
import {
  UserCircle,
  Plus,
  Trash2,
  Edit2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
} from 'lucide-react';
import { clsx } from 'clsx';
import { ProfileEditDialog } from './ProfileEditDialog';
import { parseStoredMcpProfile } from '../../../shared/profile-mcp';
import { SettingsPageHeader } from './SettingsPageHeader';

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
  rank: number;
  created_at: number;
  updated_at: number;
}

export function ChatProfilesSettings() {
  const [profiles, setProfiles] = useState<ChatProfile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editingProfile, setEditingProfile] = useState<ChatProfile | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  useEffect(() => {
    loadProfiles();
  }, []);

  const loadProfiles = async () => {
    setIsLoading(true);
    try {
      const list = await invoke('profiles:get-all');
      setProfiles(list || []);
    } catch (e) {
      console.error('Failed to load profiles:', e);
    }
    setIsLoading(false);
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    await invoke('profiles:toggle', id, enabled);
    setProfiles(prev => prev.map(p => p.id === id ? { ...p, enabled: enabled ? 1 : 0 } : p));
    window.dispatchEvent(new Event('profiles-updated'));
  };

  const handleDelete = async (id: string) => {
    await invoke('profiles:delete', id);
    setProfiles(prev => prev.filter(p => p.id !== id));
    setDeleteConfirmId(null);
    window.dispatchEvent(new Event('profiles-updated'));
  };

  const handleMove = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= profiles.length) return;

    const next = [...profiles];
    [next[index], next[target]] = [next[target], next[index]];
    setProfiles(next);
    await invoke('profiles:reorder', next.map(p => p.id));
    window.dispatchEvent(new Event('profiles-updated'));
  };

  const handleEdit = (profile: ChatProfile) => {
    setEditingProfile(profile);
    setShowEditDialog(true);
  };

  const handleAdd = () => {
    setEditingProfile(null);
    setShowEditDialog(true);
  };

  const handleDialogSave = async () => {
    setShowEditDialog(false);
    setEditingProfile(null);
    await loadProfiles();
    window.dispatchEvent(new Event('profiles-updated'));
  };

  const toggleExpanded = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const formatConfig = (profile: ChatProfile) => {
    const parts: string[] = [];
    if (profile.ai_model_id) parts.push(profile.ai_model_id);
    try {
      const sp = JSON.parse(profile.system_prompts);
      if (sp.active_prompt_ids?.length) parts.push(`${sp.active_prompt_ids.length} prompts`);
    } catch {}
    try {
      const t = JSON.parse(profile.tools);
      if (t.enabled_tool_ids?.length) parts.push(`${t.enabled_tool_ids.length} tools`);
    } catch {}
    try {
      const s = JSON.parse(profile.skills);
      if (s.enabled_skill_ids?.length) parts.push(`${s.enabled_skill_ids.length} skills`);
    } catch {}
    try {
      const mcp = parseStoredMcpProfile(profile.mcp);
      if (mcp.kind === 'managed') {
        parts.push(mcp.snapshot.global_enabled
          ? `${mcp.snapshot.servers.length} MCP server${mcp.snapshot.servers.length === 1 ? '' : 's'}`
          : 'MCP off');
      }
    } catch {}
    return parts.join(' · ') || 'No configuration';
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-text-muted">
        Loading...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SettingsPageHeader
        icon={<UserCircle size={24} />}
        title="Chat Profiles"
        actions={(
          <button
            onClick={handleAdd}
            className="flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm text-primary-foreground transition-colors hover:opacity-90"
          >
            <Plus size={14} />
            Add Profile
          </button>
        )}
      />

      {/* Profile List */}
      {profiles.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-text-muted border border-border rounded-lg bg-surface">
          <UserCircle size={40} className="mb-3 opacity-40" />
          <p className="text-sm">No profiles yet</p>
          <p className="text-xs mt-1 opacity-70">
            Create a profile to quickly switch between AI configurations
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {profiles.map((profile, index) => (
            <div
              key={profile.id}
              className={clsx(
                'border border-border rounded-lg bg-surface overflow-hidden transition-colors',
                !profile.enabled && 'opacity-50'
              )}
            >
              {/* Row header */}
              <div className="flex items-center gap-3 px-4 py-3">
                {/* Reorder */}
                <div className="flex flex-col -my-1">
                  <button
                    onClick={() => handleMove(index, -1)}
                    disabled={index === 0}
                    className="text-text-muted hover:text-text-main transition-colors disabled:opacity-25 disabled:hover:text-text-muted"
                    title="Move up"
                  >
                    <ChevronUp size={12} />
                  </button>
                  <button
                    onClick={() => handleMove(index, 1)}
                    disabled={index === profiles.length - 1}
                    className="text-text-muted hover:text-text-main transition-colors disabled:opacity-25 disabled:hover:text-text-muted"
                    title="Move down"
                  >
                    <ChevronDown size={12} />
                  </button>
                </div>

                {/* Expand toggle */}
                <button
                  onClick={() => toggleExpanded(profile.id)}
                  className="text-text-muted hover:text-text-main transition-colors"
                >
                  {expandedIds.has(profile.id) ? (
                    <ChevronDown size={16} />
                  ) : (
                    <ChevronRight size={16} />
                  )}
                </button>

                {/* Name + summary */}
                <div className="flex-1 min-w-0">
                  <span className="font-medium text-sm">{profile.name}</span>
                  <p className="text-xs text-text-muted truncate mt-0.5">
                    {formatConfig(profile)}
                  </p>
                </div>

                {/* Toggle */}
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={!!profile.enabled}
                    onChange={(e) => handleToggle(profile.id, e.target.checked)}
                  />
                  <div className="w-9 h-5 bg-border rounded-full peer-checked:bg-primary transition-colors after:content-[''] after:absolute after:top-0.5 after:start-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full" />
                </label>

                {/* Edit */}
                <button
                  onClick={() => handleEdit(profile)}
                  className="p-1.5 text-text-muted hover:text-text-main hover:bg-surface-hover rounded transition-colors"
                  title="Edit"
                >
                  <Edit2 size={14} />
                </button>

                {/* Delete */}
                {deleteConfirmId === profile.id ? (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleDelete(profile.id)}
                      className="px-2 py-1 text-xs bg-red-500/20 text-red-400 rounded hover:bg-red-500/30 transition-colors"
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => setDeleteConfirmId(null)}
                      className="px-2 py-1 text-xs text-text-muted hover:text-text-main rounded transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setDeleteConfirmId(profile.id)}
                    className="p-1.5 text-text-muted hover:text-red-400 hover:bg-surface-hover rounded transition-colors"
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>

              {/* Expanded detail */}
              {expandedIds.has(profile.id) && (
                <div className="px-4 pb-3 pt-0 border-t border-border/50">
                  <pre className="text-xs text-text-muted whitespace-pre-wrap font-mono mt-2 max-h-48 overflow-y-auto">
                    {JSON.stringify(
                      {
                        provider: profile.ai_provider_id,
                        model: profile.ai_model_id,
                        system_prompts: JSON.parse(profile.system_prompts || '{}'),
                        tools: JSON.parse(profile.tools || '{}'),
                        skills: JSON.parse(profile.skills || '{}'),
                        mcp: profile.mcp ? JSON.parse(profile.mcp) : null,
                      },
                      null,
                      2
                    )}
                  </pre>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Edit Dialog */}
      {showEditDialog && (
        <ProfileEditDialog
          profile={editingProfile}
          onClose={() => { setShowEditDialog(false); setEditingProfile(null); }}
          onSave={handleDialogSave}
        />
      )}
    </div>
  );
}
