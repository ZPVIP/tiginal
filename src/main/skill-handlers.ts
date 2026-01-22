import { ipcMain, shell } from 'electron';
import { getDatabase } from '../services/database/database';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

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

/**
 * Parse SKILL.md frontmatter to extract name and description
 */
function parseSkillMd(filePath: string): { name: string; description: string } | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').slice(0, 5); // Read first 5 lines
    
    if (lines[0]?.trim() !== '---') return null;
    
    let name = '';
    let description = '';
    
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line === '---') break;
      
      if (line.startsWith('name:')) {
        name = line.substring(5).trim();
      } else if (line.startsWith('description:')) {
        description = line.substring(12).trim();
      }
    }
    
    if (!name) return null;
    
    return { name, description };
  } catch {
    return null;
  }
}

/**
 * Expand ~ to home directory
 */
function expandPath(p: string): string {
  if (p.startsWith('~/')) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

/**
 * Get the default skills directory path
 */
function getDefaultSkillsDir(): string {
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || os.homedir(), 'Tiginal', 'skills');
  }
  return path.join(os.homedir(), '.config', 'tiginal', 'skills');
}

/**
 * Setup Skills-related IPC handlers
 */
export function setupSkillHandlers(): void {
  const db = getDatabase().getDb();

  // Initialize default skills directory on first run
  ipcMain.handle('skills:init-default', async (): Promise<void> => {
    const defaultDir = getDefaultSkillsDir();
    
    // Create directory if not exists
    if (!fs.existsSync(defaultDir)) {
      fs.mkdirSync(defaultDir, { recursive: true });
    }
    
    // Check if already in database
    const existing = db.prepare('SELECT id FROM skill_directories WHERE path = ?').get(defaultDir);
    if (!existing) {
      const id = require('crypto').randomUUID();
      db.prepare('INSERT INTO skill_directories (id, name, path, enabled) VALUES (?, ?, ?, ?)').run(
        id, 'Tiginal', defaultDir, 1
      );
    }
  });

  // Get all skill directories
  ipcMain.handle('skills:get-directories', async (): Promise<SkillDirectory[]> => {
    const rows = db.prepare('SELECT id, name, path, enabled FROM skill_directories ORDER BY name').all() as Array<{
      id: string;
      name: string;
      path: string;
      enabled: number;
    }>;
    
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      path: row.path,
      enabled: row.enabled === 1,
    }));
  });

  // Add skill directory
  ipcMain.handle('skills:add-directory', async (_event, name: string, dirPath: string): Promise<SkillDirectory> => {
    const id = require('crypto').randomUUID();
    const expandedPath = expandPath(dirPath);
    
    db.prepare('INSERT INTO skill_directories (id, name, path, enabled) VALUES (?, ?, ?, ?)').run(
      id, name, expandedPath, 1
    );
    
    return { id, name, path: expandedPath, enabled: true };
  });

  // Update skill directory
  ipcMain.handle('skills:update-directory', async (_event, id: string, name: string, dirPath: string, enabled: boolean): Promise<void> => {
    const expandedPath = expandPath(dirPath);
    db.prepare('UPDATE skill_directories SET name = ?, path = ?, enabled = ? WHERE id = ?').run(
      name, expandedPath, enabled ? 1 : 0, id
    );
  });

  // Delete skill directory
  ipcMain.handle('skills:delete-directory', async (_event, id: string): Promise<void> => {
    db.prepare('DELETE FROM skill_directories WHERE id = ?').run(id);
  });

  // Toggle skill directory enabled
  ipcMain.handle('skills:toggle-directory', async (_event, id: string): Promise<void> => {
    db.prepare('UPDATE skill_directories SET enabled = NOT enabled WHERE id = ?').run(id);
  });

  // Get all skills with directory info
  ipcMain.handle('skills:get-skills', async (): Promise<Skill[]> => {
    const rows = db.prepare(`
      SELECT s.id, s.skill_folder, s.name, s.description, s.skill_directory_id, 
             s.scan_at, s.enabled, d.name as directory_name, d.path as directory_path
      FROM skills s
      JOIN skill_directories d ON s.skill_directory_id = d.id
      ORDER BY d.name, s.name
    `).all() as Array<{
      id: number;
      skill_folder: string;
      name: string;
      description: string;
      skill_directory_id: string;
      scan_at: number;
      enabled: number;
      directory_name: string;
      directory_path: string;
    }>;
    
    return rows.map(row => ({
      id: row.id,
      skillFolder: row.skill_folder,
      name: row.name,
      description: row.description || '',
      skillDirectoryId: row.skill_directory_id,
      directoryName: row.directory_name,
      directoryPath: row.directory_path,
      scanAt: row.scan_at,
      enabled: row.enabled === 1,
    }));
  });

  // Toggle skill enabled
  ipcMain.handle('skills:toggle-skill', async (_event, id: number): Promise<void> => {
    db.prepare('UPDATE skills SET enabled = NOT enabled WHERE id = ?').run(id);
  });

  // Scan all directories for skills
  ipcMain.handle('skills:scan', async (): Promise<{ added: number; removed: number }> => {
    const scanAt = Date.now();
    let added = 0;
    
    // Get all enabled directories
    const directories = db.prepare('SELECT id, path FROM skill_directories WHERE enabled = 1').all() as Array<{
      id: string;
      path: string;
    }>;
    
    for (const dir of directories) {
      const expandedPath = expandPath(dir.path);
      
      if (!fs.existsSync(expandedPath)) continue;
      
      // Get all subdirectories
      const entries = fs.readdirSync(expandedPath, { withFileTypes: true });
      
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        
        const skillFolder = entry.name;
        const skillMdPath = path.join(expandedPath, skillFolder, 'SKILL.md');
        const parsed = parseSkillMd(skillMdPath);
        
        if (!parsed) continue;
        
        // Check if skill exists
        const existing = db.prepare(
          'SELECT id FROM skills WHERE skill_folder = ? AND skill_directory_id = ?'
        ).get(skillFolder, dir.id) as { id: number } | undefined;
        
        if (existing) {
          // Update scan_at
          db.prepare('UPDATE skills SET scan_at = ?, name = ?, description = ? WHERE id = ?').run(
            scanAt, parsed.name, parsed.description, existing.id
          );
        } else {
          // Insert new skill
          db.prepare(`
            INSERT INTO skills (skill_folder, name, description, skill_directory_id, scan_at, enabled)
            VALUES (?, ?, ?, ?, ?, 0)
          `).run(skillFolder, parsed.name, parsed.description, dir.id, scanAt);
          added++;
        }
      }
    }
    
    // Remove stale skills (old scan_at)
    const result = db.prepare('DELETE FROM skills WHERE scan_at < ?').run(scanAt);
    const removed = result.changes;
    
    return { added, removed };
  });

  // Get enabled skills for AI prompt injection
  ipcMain.handle('skills:get-enabled', async (): Promise<Array<{ name: string; description: string; path: string }>> => {
    const rows = db.prepare(`
      SELECT s.name, s.description, s.skill_folder, d.path as directory_path
      FROM skills s
      JOIN skill_directories d ON s.skill_directory_id = d.id
      WHERE s.enabled = 1 AND d.enabled = 1
      ORDER BY s.name
    `).all() as Array<{
      name: string;
      description: string;
      skill_folder: string;
      directory_path: string;
    }>;
    
    return rows.map(row => ({
      name: row.name,
      description: row.description || '',
      path: path.join(row.directory_path, row.skill_folder, 'SKILL.md'),
    }));
  });

  // Open skill folder in Finder/Explorer
  ipcMain.handle('skills:open-folder', async (_event, directoryPath: string, skillFolder: string): Promise<void> => {
    const fullPath = path.join(expandPath(directoryPath), skillFolder);
    shell.openPath(fullPath);
  });
}
