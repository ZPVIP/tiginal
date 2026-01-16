/**
 * Configuration directory management for Tiginal
 * 
 * Provides cross-platform paths for storing application data:
 * - macOS/Linux: ~/.config/tiginal/
 * - Windows: %APPDATA%\Tiginal\
 */

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Get the base configuration directory for Tiginal
 */
export function getConfigDir(): string {
  let configDir: string;
  
  if (process.platform === 'win32') {
    // Windows: %APPDATA%\Tiginal
    configDir = path.join(process.env.APPDATA || os.homedir(), 'Tiginal');
  } else {
    // macOS and Linux: ~/.config/tiginal
    configDir = path.join(os.homedir(), '.config', 'tiginal');
  }
  
  return configDir;
}

/**
 * Ensure a directory exists, creating it if necessary
 */
export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Get path for shell configuration files (zshrc, etc.)
 */
export function getShellConfigDir(): string {
  const dir = path.join(getConfigDir(), 'shell');
  ensureDir(dir);
  return dir;
}

/**
 * Get path for SSH server configurations
 */
export function getServersDir(): string {
  const dir = path.join(getConfigDir(), 'servers');
  ensureDir(dir);
  return dir;
}

/**
 * Get path for command history storage
 */
export function getHistoryDir(): string {
  const dir = path.join(getConfigDir(), 'history');
  ensureDir(dir);
  return dir;
}

/**
 * Get path for main configuration file
 */
export function getConfigFilePath(): string {
  ensureDir(getConfigDir());
  return path.join(getConfigDir(), 'config.json');
}
