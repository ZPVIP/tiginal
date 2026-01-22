import React, { useState, useEffect } from 'react';
import { clsx } from 'clsx';
import { 
  FolderOpen, Trash2, Plus, Edit2, Save, X, RefreshCw, 
  Check, ChevronLeft, ChevronRight, Folder
} from 'lucide-react';

interface SkillDirectory {
  id: string;
  name: string;
  path: string;
  enabled: boolean;
}

interface Skill {
  id: number;
  skillFolder: string;
  name: string;
  description: string;
  skillDirectoryId: string;
  directoryName: string;
  directoryPath: string;
  scanAt: number;
  enabled: boolean;
}

const TABS = [
  { id: 'directories', label: 'Skill Directories' },
  { id: 'skills', label: 'Skills' },
];

export function SkillsSettings() {
  const [activeTab, setActiveTab] = useState('directories');
  
  // Directories
  const [directories, setDirectories] = useState<SkillDirectory[]>([]);
  const [editingDir, setEditingDir] = useState<string | null>(null);
  const [editDirName, setEditDirName] = useState('');
  const [editDirPath, setEditDirPath] = useState('');
  const [newDirName, setNewDirName] = useState('');
  const [newDirPath, setNewDirPath] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  
  // Skills
  const [skills, setSkills] = useState<Skill[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<{ added: number; removed: number } | null>(null);
  
  // Pagination
  const PAGE_SIZE = 10;
  const [dirPage, setDirPage] = useState(0);
  const [skillPage, setSkillPage] = useState(0);

  const invoke = window.electron?.invoke || (async () => null);

  useEffect(() => {
    loadDirectories();
    loadSkills();
  }, []);

  const loadDirectories = async () => {
    const dirs = await invoke('skills:get-directories');
    setDirectories(dirs || []);
  };

  const loadSkills = async () => {
    const s = await invoke('skills:get-skills');
    setSkills(s || []);
  };

  const handleAddDirectory = async () => {
    if (!newDirName.trim() || !newDirPath.trim()) return;
    await invoke('skills:add-directory', newDirName.trim(), newDirPath.trim());
    setNewDirName('');
    setNewDirPath('');
    setShowAddForm(false);
    loadDirectories();
  };

  const handleUpdateDirectory = async (id: string) => {
    if (!editDirName.trim() || !editDirPath.trim()) return;
    const dir = directories.find(d => d.id === id);
    if (!dir) return;
    await invoke('skills:update-directory', id, editDirName.trim(), editDirPath.trim(), dir.enabled);
    setEditingDir(null);
    loadDirectories();
  };

  const handleDeleteDirectory = async (id: string) => {
    if (!confirm('Are you sure you want to delete this directory? All associated skills will be removed.')) return;
    await invoke('skills:delete-directory', id);
    loadDirectories();
    loadSkills();
  };

  const handleToggleDirectory = async (id: string) => {
    await invoke('skills:toggle-directory', id);
    loadDirectories();
  };

  const handleToggleSkill = async (id: number) => {
    await invoke('skills:toggle-skill', id);
    loadSkills();
  };

  const handleScan = async () => {
    setScanning(true);
    setScanResult(null);
    const result = await invoke('skills:scan');
    setScanResult(result);
    setScanning(false);
    loadSkills();
  };

  const handleOpenFolder = async (directoryPath: string, skillFolder: string) => {
    await invoke('skills:open-folder', directoryPath, skillFolder);
  };

  const handleBrowseDirectory = async (forEdit = false) => {
    const path = await invoke('skills:choose-directory');
    if (path) {
      if (forEdit) {
        setEditDirPath(path);
      } else {
        setNewDirPath(path);
      }
    }
  };

  // Pagination helpers
  const paginate = <T,>(items: T[], page: number) => items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = (total: number) => Math.ceil(total / PAGE_SIZE);

  const pagedDirectories = paginate(directories, dirPage);
  const pagedSkills = paginate(skills, skillPage);

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold text-text-main">Skills Settings</h2>
      
      {/* Tabs */}
      <div className="flex gap-1 border-b border-border pb-2">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={clsx(
              "flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-t-lg transition-colors",
              activeTab === tab.id
                ? "bg-primary/20 text-primary border-b-2 border-primary"
                : "text-text-muted hover:text-text-main hover:bg-surface-light"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Directories Tab */}
      {activeTab === 'directories' && (
        <div className="space-y-4">
          {/* Add button */}
          {!showAddForm && (
            <button
              onClick={() => setShowAddForm(true)}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-white text-sm rounded-lg hover:opacity-90 transition-colors"
            >
              <Plus size={14} />
              Add Directory
            </button>
          )}

          {/* Add form */}
          {showAddForm && (
            <div className="p-4 bg-surface rounded-lg border border-border space-y-3">
              <div>
                <label className="block text-sm font-medium text-text-main mb-1">Name</label>
                <input
                  type="text"
                  value={newDirName}
                  onChange={(e) => setNewDirName(e.target.value)}
                  placeholder="e.g., Claude, OpenAI, Custom"
                  className="w-full bg-background text-text-main text-sm rounded-lg py-2 px-3 border border-border focus:border-primary outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-main mb-1">Path</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newDirPath}
                    readOnly
                    placeholder="Click Browse to select..."
                    className="flex-1 bg-surface-light text-text-main text-sm font-mono rounded-lg py-2 px-3 border border-border focus:border-primary outline-none cursor-not-allowed opacity-80"
                  />
                  <button
                    onClick={() => handleBrowseDirectory(false)}
                    className="px-3 py-2 bg-surface border border-border hover:border-primary hover:bg-surface-light text-text-main text-sm rounded-lg transition-colors"
                  >
                    Browse
                  </button>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleAddDirectory}
                  className="px-4 py-2 bg-primary text-white text-sm rounded-lg hover:opacity-90"
                >
                  Add
                </button>
                <button
                  onClick={() => { setShowAddForm(false); setNewDirName(''); setNewDirPath(''); }}
                  className="px-4 py-2 bg-surface-light text-text-main text-sm rounded-lg hover:bg-surface"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Directory list */}
          <div className="space-y-2">
            {directories.length === 0 ? (
              <div className="text-center py-8 text-text-muted text-sm">
                No skill directories configured
              </div>
            ) : (
              pagedDirectories.map(dir => (
                <div
                  key={dir.id}
                  className="group flex items-center gap-3 px-4 py-3 bg-surface rounded-lg border border-border hover:border-primary/50 transition-colors"
                >
                  {/* Enable checkbox */}
                  <button
                    onClick={() => handleToggleDirectory(dir.id)}
                    className={clsx(
                      "w-5 h-5 rounded border flex items-center justify-center transition-colors",
                      dir.enabled
                        ? "bg-primary border-primary text-white"
                        : "border-border hover:border-primary"
                    )}
                  >
                    {dir.enabled && <Check size={12} />}
                  </button>

                  {editingDir === dir.id ? (
                    <>
                      <input
                        type="text"
                        value={editDirName}
                        onChange={(e) => setEditDirName(e.target.value)}
                        className="w-32 bg-background text-text-main text-sm rounded py-1 px-2 border border-primary outline-none"
                        placeholder="Name"
                      />
                      <div className="flex gap-1 flex-1">
                        <input
                          type="text"
                          value={editDirPath}
                          readOnly
                          className="flex-1 bg-surface-light text-text-main text-sm font-mono rounded py-1 px-2 border border-primary outline-none cursor-not-allowed opacity-80"
                          placeholder="Path"
                        />
                         <button
                           onClick={() => handleBrowseDirectory(true)}
                           className="px-2 py-1 bg-surface border border-border hover:border-primary hover:bg-surface-light text-text-main text-xs rounded transition-colors"
                         >
                           Browse
                         </button>
                      </div>
                      <button onClick={() => handleUpdateDirectory(dir.id)} className="p-1 text-green-400 hover:bg-green-500/20 rounded">
                        <Save size={14} />
                      </button>
                      <button onClick={() => setEditingDir(null)} className="p-1 text-text-muted hover:bg-surface-light rounded">
                        <X size={14} />
                      </button>
                    </>
                  ) : (
                    <>
                      <FolderOpen size={16} className="text-blue-400 shrink-0" />
                      <span className="text-sm font-medium text-text-main w-32 truncate">{dir.name}</span>
                      <span className="flex-1 text-sm font-mono text-text-muted truncate">{dir.path}</span>
                      <button
                        onClick={() => { setEditingDir(dir.id); setEditDirName(dir.name); setEditDirPath(dir.path); }}
                        className="p-1 text-text-muted opacity-0 group-hover:opacity-100 hover:text-primary rounded"
                      >
                        <Edit2 size={14} />
                      </button>
                      <button
                        onClick={() => handleDeleteDirectory(dir.id)}
                        className="p-1 text-text-muted opacity-0 group-hover:opacity-100 hover:text-red-400 rounded"
                      >
                        <Trash2 size={14} />
                      </button>
                    </>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Pagination */}
          {totalPages(directories.length) > 1 && (
            <div className="flex items-center justify-center gap-2 mt-2">
              <button
                onClick={() => setDirPage(p => Math.max(0, p - 1))}
                disabled={dirPage === 0}
                className="p-1 rounded hover:bg-surface-light disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="text-xs text-text-muted">
                {dirPage + 1} / {totalPages(directories.length)}
              </span>
              <button
                onClick={() => setDirPage(p => Math.min(totalPages(directories.length) - 1, p + 1))}
                disabled={dirPage >= totalPages(directories.length) - 1}
                className="p-1 rounded hover:bg-surface-light disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Skills Tab */}
      {activeTab === 'skills' && (
        <div className="space-y-4">
          {/* Scan button */}
          <div className="flex items-center gap-4">
            <button
              onClick={handleScan}
              disabled={scanning}
              className={clsx(
                "flex items-center gap-2 px-4 py-2 bg-primary text-white text-sm rounded-lg transition-colors",
                scanning ? "opacity-50 cursor-not-allowed" : "hover:opacity-90"
              )}
            >
              <RefreshCw size={14} className={clsx(scanning && "animate-spin")} />
              {scanning ? 'Scanning...' : 'Scan Directories'}
            </button>
            {scanResult && (
              <span className="text-sm text-text-muted">
                Added {scanResult.added}, Removed {scanResult.removed}
              </span>
            )}
          </div>

          {/* Skills list */}
          <div className="space-y-2">
            {skills.length === 0 ? (
              <div className="text-center py-8 text-text-muted text-sm">
                No skills found. Click "Scan Directories" to discover skills.
              </div>
            ) : (
              pagedSkills.map(skill => (
                <div
                  key={skill.id}
                  className="group flex items-center gap-3 px-4 py-3 bg-surface rounded-lg border border-border hover:border-primary/50 transition-colors"
                >
                  {/* Enable checkbox */}
                  <button
                    onClick={() => handleToggleSkill(skill.id)}
                    className={clsx(
                      "w-5 h-5 rounded border flex items-center justify-center transition-colors shrink-0",
                      skill.enabled
                        ? "bg-primary border-primary text-white"
                        : "border-border hover:border-primary"
                    )}
                  >
                    {skill.enabled && <Check size={12} />}
                  </button>

                  {/* Folder icon - opens in Finder */}
                  <button
                    onClick={() => handleOpenFolder(skill.directoryPath, skill.skillFolder)}
                    className="p-1 text-blue-400 hover:bg-blue-500/20 rounded shrink-0"
                    title="Open in Finder"
                  >
                    <Folder size={14} />
                  </button>

                  {/* Skill folder */}
                  <span className="text-sm font-mono text-text-main w-40 truncate">
                    {skill.skillFolder}
                  </span>

                  {/* Skill name with tooltip */}
                  <span
                    className="flex-1 text-sm font-medium text-text-main truncate cursor-help"
                    title={skill.description || 'No description'}
                  >
                    {skill.name}
                  </span>

                  {/* Directory name */}
                  <span className="text-xs text-text-muted bg-surface-light px-2 py-1 rounded shrink-0">
                    {skill.directoryName}
                  </span>
                </div>
              ))
            )}
          </div>

          {/* Pagination */}
          {totalPages(skills.length) > 1 && (
            <div className="flex items-center justify-center gap-2 mt-2">
              <button
                onClick={() => setSkillPage(p => Math.max(0, p - 1))}
                disabled={skillPage === 0}
                className="p-1 rounded hover:bg-surface-light disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="text-xs text-text-muted">
                {skillPage + 1} / {totalPages(skills.length)}
              </span>
              <button
                onClick={() => setSkillPage(p => Math.min(totalPages(skills.length) - 1, p + 1))}
                disabled={skillPage >= totalPages(skills.length) - 1}
                className="p-1 rounded hover:bg-surface-light disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
