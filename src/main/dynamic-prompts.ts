/**
 * Shared dynamic prompt templates
 * Used by both chat-handlers.ts (for AI) and tool-handlers.ts (for UI display)
 */

import * as os from 'os';
import { defaultWorkspaceDir, expandHome } from './utils/paths';
import * as path from 'path';
import { getDatabase } from '../services/database/database';

export interface DynamicPromptTemplate {
  title: string;
  content: string;
  showAlways: boolean;
}

export interface DynamicPromptSections {
  stable: string;
  volatile: string;
}

/**
 * Get the current workspace path
 */
export function getWorkspacePath(): string {
  const dbService = getDatabase();
  let workspacePath = dbService.getSetting('workspacePath');
  
  return workspacePath ? expandHome(workspacePath) : defaultWorkspaceDir();
}

/**
 * Get the system info prompt based on OS
 */
export function getSystemInfoContent(): string {
  if (process.platform === 'darwin') {
    return 'SYSTEM INFO - You are running on macOS (you can use osascript via Bash to interact with system features like Calendar, Reminders, Mail, Notifications, and other apps).';
  } else if (process.platform === 'win32') {
    return 'SYSTEM INFO - You are running on Windows (you can use PowerShell via Bash to interact with system features, manage files, automate tasks, and access Windows-specific utilities).';
  } else {
    return 'SYSTEM INFO - You are running on Linux (you can use Bash to interact with system features, manage files, automate tasks, and leverage standard Unix utilities).';
  }
}

/**
 * Get the AppleScript date handling prompt (macOS only)
 */
export function getAppleScriptContent(): string {
  return `IMPORTANT for AppleScript date handling: When setting dates in AppleScript (for Reminders, Calendar, etc.), use the current date as a base and modify it. Do NOT use string date parsing like 'date "2026-01-31 22:23:24"' as it's unreliable. Instead use:
  set targetDate to current date
  set year of targetDate to 2026
  set month of targetDate to 1
  set day of targetDate to 31
  set hours of targetDate to 22
  set minutes of targetDate to 23
  set seconds of targetDate to 24.`;
}

/**
 * Get all dynamic prompt templates
 */
export function getDynamicPromptTemplates(): Record<string, DynamicPromptTemplate> {
  const isMacOS = process.platform === 'darwin';
  const dateStr = new Date().toLocaleDateString();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const workspacePath = getWorkspacePath();

  return {
    dateInfo: {
      title: 'Date & Time Information',
      content: `IMPORTANT - Today's date is ${dateStr} (timezone: ${timezone}). This is the current date and you must use it accurately when answering time-sensitive questions.`,
      showAlways: true,
    },
    wdInfo: {
      title: 'Working Directory',
      content: `WORKING DIRECTORY - Your current working directory is: ${workspacePath}. All file operations and shell commands will be executed relative to this directory.`,
      showAlways: true,
    },
    systemInfo: {
      title: 'System Information',
      content: getSystemInfoContent(),
      showAlways: true,
    },
    appleScriptInfo: {
      title: 'AppleScript Date Handling',
      content: getAppleScriptContent(),
      showAlways: isMacOS,
    },
  };
}

/**
 * Build dynamic prompts string for AI based on settings
 */
export function buildDynamicPromptSectionsForAI(dbService: ReturnType<typeof getDatabase>): DynamicPromptSections {
  // Check global switch
  const globalEnabled = dbService.getSetting('dynamicPromptsGlobalEnabled');
  if (globalEnabled === 'false') {
    return { stable: '', volatile: '' };
  }

  const dynamicDateEnabled = dbService.getSetting('dynamicPrompt_dateInfo') !== 'false';
  const dynamicWdEnabled = dbService.getSetting('dynamicPrompt_wdInfo') !== 'false';
  const dynamicSystemEnabled = dbService.getSetting('dynamicPrompt_systemInfo') !== 'false';
  const dynamicAppleScriptEnabled = dbService.getSetting('dynamicPrompt_appleScriptInfo') !== 'false';
  
  let stablePrompts = '';
  let volatilePrompts = '';
  
  // System Info (OS-specific) - placed first
  if (dynamicSystemEnabled) {
    stablePrompts += `\n\n${getSystemInfoContent()}`;
  }
  
  // Working Directory Info
  if (dynamicWdEnabled) {
    const workspacePath = getWorkspacePath();
    stablePrompts += `\n\nWORKING DIRECTORY - Your current working directory is: ${workspacePath}. All file operations and shell commands will be executed relative to this directory.`;
  }
  
  // AppleScript Date Handling (macOS only)
  if (dynamicAppleScriptEnabled && process.platform === 'darwin') {
    stablePrompts += `\n\n${getAppleScriptContent()}`;
  }

  // Web Search Guidance (Dynamic Check)
  try {
    const row = dbService.getDb().prepare(`
      SELECT t.enabled as tool_enabled, tc.enabled as cat_enabled 
      FROM tools t 
      LEFT JOIN tool_categories tc ON t.category_id = tc.id 
      WHERE t.name = ?
    `).get('WebSearch') as { tool_enabled: number, cat_enabled: number | null };

    const isEnabled = row && 
                      row.tool_enabled === 1 && 
                      (row.cat_enabled === null || row.cat_enabled === 1);

    if (isEnabled) {
         stablePrompts += `\n\nWEB SEARCH - You have access to a WebSearch tool.
IMPORTANT: You MUST use the WebSearch tool when:
- The user asks about current events, news, sports, or weather.
- The user asks about topics that may have changed since your training cutoff.
- You are unsure of the answer or need real-time verification.
Do NOT say "I don't know" or "My knowledge is limited" without using WebSearch to find the answer first.`;
    }
  } catch (e) {
      // Ignore DB errors
  }

  // Keep the day-level value in its own final system block. It is stable within
  // a day and only invalidates content after this cache boundary at midnight.
  if (dynamicDateEnabled) {
    const dateStr = new Date().toLocaleDateString('en-CA');
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    volatilePrompts = `IMPORTANT - Today's date is ${dateStr} (timezone: ${timezone}). This is the current date and you must use it accurately when answering time-sensitive questions. Do not confuse or misremember this date.`;
  }

  return { stable: stablePrompts, volatile: volatilePrompts };
}

export function buildDynamicPromptsForAI(dbService: ReturnType<typeof getDatabase>): string {
  const sections = buildDynamicPromptSectionsForAI(dbService);
  return sections.stable + (sections.volatile ? `\n\n${sections.volatile}` : '');
}
