import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface HistoryItem {
  timestamp: number;
  command: string;
}

interface DirectorySuggestion {
  path: string;
  score: number;
  lastVisited: number;
}

const MAX_HISTORY_LINES = 10000;
// Look back 24 hours by default for "recent" heavy weighting, but keep all history useful
const RECENT_WINDOW = 24 * 60 * 60 * 1000; 

function getShellHistoryFile(): string | null {
  const shell = process.env.SHELL || '';
  const home = os.homedir();
  
  if (shell.includes('zsh')) {
    const zshHistory = path.join(home, '.zsh_history');
    if (fs.existsSync(zshHistory)) return zshHistory;
  } else if (shell.includes('bash')) {
    const bashHistory = path.join(home, '.bash_history');
    if (fs.existsSync(bashHistory)) return bashHistory;
  }
  
  return null;
}

function parseZshHistory(content: string): HistoryItem[] {
  const items: HistoryItem[] = [];
  const lines = content.split('\n');
  
  // Zsh history format: : 1674123456:0;command
  const regex = /^: (\d+):\d+;(.*)$/;
  
  for (let i = lines.length - 1; i >= 0 && items.length < MAX_HISTORY_LINES; i--) {
    const line = lines[i];
    const match = line.match(regex);
    if (match) {
      items.push({
        timestamp: parseInt(match[1]) * 1000,
        command: match[2].trim()
      });
    }
  }
  
  return items;
}

function parseBashHistory(content: string): HistoryItem[] {
  // Bash history is often just commands, or lines with #timestamp before them if configured
  // For simplicity, we'll just treat them as sequential without precise timestamps if missing
  // Or just read the last N lines.
  const items: HistoryItem[] = [];
  const lines = content.split('\n');
  const now = Date.now();
  
  for (let i = lines.length - 1; i >= 0 && items.length < MAX_HISTORY_LINES; i--) {
      // Mock timestamp decaying by 1 second for ordering
      items.push({
          timestamp: now - (lines.length - i) * 1000,
          command: lines[i].trim()
      });
  }
  return items;
}

export function getShellHistory(): HistoryItem[] {
  const historyFile = getShellHistoryFile();
  if (!historyFile) return [];

  try {
    const content = fs.readFileSync(historyFile, 'utf8'); // TODO: Use readStream for huge files?
    if (historyFile.includes('zsh')) {
      return parseZshHistory(content);
    } else {
      return parseBashHistory(content);
    }
  } catch (e) {
    console.error('Failed to read shell history', e);
    return [];
  }
}

// Helper to unescape shell paths (basic support for backslash spaces)
function unescapeShellPath(input: string): string {
  // Remove backslashes before spaces
  return input.replace(/\\ /g, ' ');
  // Future: Handle quotes if needed
}

function resolvePath(target: string, cwd: string): string | null {
  if (!target) return null;
  
  let cleanTarget = unescapeShellPath(target);

  // Expand ~
  if (cleanTarget.startsWith('~')) {
    cleanTarget = cleanTarget.replace('~', os.homedir());
  }
  
  // Resolve relative
  const absolute = path.resolve(cwd, cleanTarget);
  // ... rest of function checks existence

  
  try {
    if (fs.existsSync(absolute) && fs.statSync(absolute).isDirectory()) {
      return absolute;
    }
  } catch (e) {
    // Permission denied or other error
  }
  return null;
}

export function getDirectorySuggestions(cwd: string): string[] {
  const history = getShellHistory();
  const suggestions = new Map<string, DirectorySuggestion>();
  const now = Date.now();
  
  // We can't easily know the CWD for every history command, 
  // so we focus on absolute paths or simple relative ones that might be valid from current CWD or Home.
  // Actually, for a "smart" jump, we often want to jump to frequent project directories.
  
  history.forEach(item => {
    if (item.command.startsWith('cd ')) {
      const target = item.command.substring(3).trim();
      if (!target) return;
      
      // Try to resolve against Home first (common case) or Absolute
      let resolved = resolvePath(target, os.homedir());
      
      // If not valid relative to home, try relative to current CWD? 
      // This is tricky because historical relative CDs are context-dependent.
      // But if the user types 'cd' now, they might want a globally frequent dir.
      if (!resolved) {
          resolved = resolvePath(target, cwd);
      }

      if (resolved) {
        const existing = suggestions.get(resolved) || { path: resolved, score: 0, lastVisited: 0 };
        
        // Scoring logic
        let score = 1;
        if (now - item.timestamp < RECENT_WINDOW) {
            score = 10; // Much higher weight for recent activity
        }
        
        existing.score += score;
        existing.lastVisited = Math.max(existing.lastVisited, item.timestamp);
        suggestions.set(resolved, existing);
      }
    }
  });

  return Array.from(suggestions.values())
    .sort((a, b) => {
        // Sort by score first, then by recency
        if (b.score !== a.score) return b.score - a.score;
        return b.lastVisited - a.lastVisited;
    })
    .slice(0, 10) // Top 10
    .map(s => s.path);
}

export function getPathCompletions(partial: string, cwd: string): string[] {
  try {
     const unescaped = unescapeShellPath(partial);
     
     // Handle ~
     let searchDir = cwd;
     let prefix = '';
     
     if (unescaped.startsWith('~')) {
         const parts = unescaped.split('/');
         const expanded = parts[0].replace('~', os.homedir());
         if (parts.length === 1) {
             // completing user? just assume home for now
             return [os.homedir() + '/'];
         }
         searchDir = expanded;
         if (parts.length > 1) {
             // ~/Doc -> searchDir = /Users/me, prefix = Doc ??
             // Actually standard completion logic:
             // 1. Identify directory part and file part
             const lastSlash = unescaped.lastIndexOf('/');
             if (lastSlash !== -1) {
                 searchDir = unescaped.substring(0, lastSlash).replace('~', os.homedir());
                 prefix = unescaped.substring(lastSlash + 1);
             } else {
                 // Should not happen if starts with ~
             }
         }
     } else {
         // Relative or Absolute
         if (path.isAbsolute(unescaped)) {
             const lastSlash = unescaped.lastIndexOf('/');
              if (lastSlash !== -1) {
                 searchDir = unescaped.substring(0, lastSlash) || '/'; // Handle root
                 prefix = unescaped.substring(lastSlash + 1);
             } else {
                 searchDir = '/';
                 prefix = unescaped;
             }
         } else {
             // Relative
             const lastSlash = unescaped.lastIndexOf('/');
             if (lastSlash !== -1) {
                 searchDir = path.resolve(cwd, unescaped.substring(0, lastSlash));
                 prefix = unescaped.substring(lastSlash + 1);
             } else {
                 searchDir = cwd;
                 prefix = unescaped;
             }
         }
     }

     if (!fs.existsSync(searchDir) || !fs.statSync(searchDir).isDirectory()) {
         return [];
     }

     const entries = fs.readdirSync(searchDir, { withFileTypes: true });
     
     return entries
        .filter(e => e.isDirectory() && e.name.toLowerCase().startsWith(prefix.toLowerCase()))
        .map(e => {
            return e.name + '/';
        });

  } catch (e) {
      return [];
  }
}
