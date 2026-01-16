/**
 * Shared types for tiginal
 */

export interface SSHServerConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'key' | 'agent';
  /** Encrypted credential (password or private key path) */
  encryptedCredential?: string;
  /** Key passphrase (encrypted) */
  encryptedPassphrase?: string;
  createdAt: number;
  updatedAt: number;
}

export interface CommandHistoryEntry {
  id: string;
  command: string;
  timestamp: number;
  sessionId: string;
  cwd?: string;
  exitCode?: number;
}

export interface AIServiceConfig {
  endpoint: string;
  apiKey?: string;
  model: string;
}

export interface SyncConfig {
  enabled: boolean;
  endpoint: string;
  apiKey?: string;
  lastSyncAt?: number;
}
