/**
 * Shared dynamic prompt templates
 * Used by both chat-handlers.ts (for AI) and tool-handlers.ts (for UI display)
 */

import * as os from 'os';
import * as path from 'path';
import { getDatabase } from '../services/database/database';

export interface DynamicPromptTemplate {
  title: string;
  content: string;
  showAlways: boolean;
}

/**
 * Get the current workspace path
 */
export function getWorkspacePath(): string {
  const dbService = getDatabase();
  let workspacePath = dbService.getSetting('workspacePath');
  
  if (!workspacePath) {
    workspacePath = process.platform === 'win32' 
      ? path.join(process.env.APPDATA || os.homedir(), 'Tiginal', 'workspaces')
      : path.join(os.homedir(), '.config', 'tiginal', 'workspaces');
  }
  
  return workspacePath;
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
export function buildDynamicPromptsForAI(dbService: ReturnType<typeof getDatabase>): string {
  const dynamicDateEnabled = dbService.getSetting('dynamicPrompt_dateInfo') !== 'false';
  const dynamicWdEnabled = dbService.getSetting('dynamicPrompt_wdInfo') !== 'false';
  const dynamicSystemEnabled = dbService.getSetting('dynamicPrompt_systemInfo') !== 'false';
  const dynamicAppleScriptEnabled = dbService.getSetting('dynamicPrompt_appleScriptInfo') !== 'false';
  
  let dynamicPrompts = '';
  
  // System Info (OS-specific) - placed first
  if (dynamicSystemEnabled) {
    dynamicPrompts += `\n\n${getSystemInfoContent()}`;
  }
  
  // Date Info
  if (dynamicDateEnabled) {
    const dateStr = new Date().toLocaleDateString('en-CA'); // ISO format for AI
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    dynamicPrompts += `\n\nIMPORTANT - Today's date is ${dateStr} (timezone: ${timezone}). This is the current date and you must use it accurately when answering time-sensitive questions. Do not confuse or misremember this date.`;
  }
  
  // Working Directory Info
  if (dynamicWdEnabled) {
    const workspacePath = getWorkspacePath();
    dynamicPrompts += `\n\nWORKING DIRECTORY - Your current working directory is: ${workspacePath}. All file operations and shell commands will be executed relative to this directory.`;
  }
  
  // AppleScript Date Handling (macOS only)
  if (dynamicAppleScriptEnabled && process.platform === 'darwin') {
    dynamicPrompts += `\n\n${getAppleScriptContent()}`;
  }
  
  return dynamicPrompts;
}
