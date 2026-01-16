import { getDatabase } from '../database/database';
import { getCrypto } from './CryptoService';

export interface SSHServerConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'key' | 'agent';
  encryptedCredential?: string;
  encryptedPassphrase?: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * SSH Server configuration manager
 * Handles CRUD operations for SSH server configurations with encrypted storage
 */
export class ServerManager {
  /**
   * Add a new SSH server configuration
   */
  addServer(
    config: Omit<SSHServerConfig, 'id' | 'createdAt' | 'updatedAt' | 'encryptedCredential' | 'encryptedPassphrase'>,
    credential?: string,
    passphrase?: string
  ): SSHServerConfig {
    const crypto = getCrypto();
    const db = getDatabase().getDb();
    
    const id = crypto.isUnlocked() ? this.generateId() : '';
    if (!crypto.isUnlocked()) {
      throw new Error('Crypto service not unlocked');
    }

    const now = Date.now();
    const encryptedCredential = credential ? crypto.encrypt(credential) : null;
    const encryptedPassphrase = passphrase ? crypto.encrypt(passphrase) : null;

    db.prepare(`
      INSERT INTO ssh_servers (id, name, host, port, username, auth_type, encrypted_credential, encrypted_passphrase, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      config.name,
      config.host,
      config.port,
      config.username,
      config.authType,
      encryptedCredential,
      encryptedPassphrase,
      now,
      now
    );

    return {
      id,
      ...config,
      encryptedCredential: encryptedCredential || undefined,
      encryptedPassphrase: encryptedPassphrase || undefined,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Get a server by ID
   */
  getServer(id: string): SSHServerConfig | undefined {
    const db = getDatabase().getDb();
    const row = db.prepare('SELECT * FROM ssh_servers WHERE id = ?').get(id) as SSHServerConfig | undefined;
    return row;
  }

  /**
   * Get all servers
   */
  getAllServers(): SSHServerConfig[] {
    const db = getDatabase().getDb();
    return db.prepare('SELECT * FROM ssh_servers ORDER BY name').all() as SSHServerConfig[];
  }

  /**
   * Update a server configuration
   */
  updateServer(
    id: string,
    updates: Partial<Omit<SSHServerConfig, 'id' | 'createdAt'>>,
    newCredential?: string,
    newPassphrase?: string
  ): SSHServerConfig | undefined {
    const crypto = getCrypto();
    const db = getDatabase().getDb();

    const existing = this.getServer(id);
    if (!existing) return undefined;

    const now = Date.now();
    let encryptedCredential = existing.encryptedCredential;
    let encryptedPassphrase = existing.encryptedPassphrase;

    if (newCredential !== undefined && crypto.isUnlocked()) {
      encryptedCredential = newCredential ? crypto.encrypt(newCredential) : undefined;
    }

    if (newPassphrase !== undefined && crypto.isUnlocked()) {
      encryptedPassphrase = newPassphrase ? crypto.encrypt(newPassphrase) : undefined;
    }

    db.prepare(`
      UPDATE ssh_servers SET
        name = ?,
        host = ?,
        port = ?,
        username = ?,
        auth_type = ?,
        encrypted_credential = ?,
        encrypted_passphrase = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      updates.name ?? existing.name,
      updates.host ?? existing.host,
      updates.port ?? existing.port,
      updates.username ?? existing.username,
      updates.authType ?? existing.authType,
      encryptedCredential || null,
      encryptedPassphrase || null,
      now,
      id
    );

    return {
      ...existing,
      ...updates,
      encryptedCredential,
      encryptedPassphrase,
      updatedAt: now,
    };
  }

  /**
   * Delete a server
   */
  deleteServer(id: string): boolean {
    const db = getDatabase().getDb();
    const result = db.prepare('DELETE FROM ssh_servers WHERE id = ?').run(id);
    return result.changes > 0;
  }

  /**
   * Get decrypted credential for a server
   */
  getCredential(id: string): string | undefined {
    const crypto = getCrypto();
    const server = this.getServer(id);
    
    if (!server?.encryptedCredential || !crypto.isUnlocked()) {
      return undefined;
    }

    try {
      return crypto.decrypt(server.encryptedCredential);
    } catch {
      return undefined;
    }
  }

  /**
   * Get decrypted passphrase for a server
   */
  getPassphrase(id: string): string | undefined {
    const crypto = getCrypto();
    const server = this.getServer(id);
    
    if (!server?.encryptedPassphrase || !crypto.isUnlocked()) {
      return undefined;
    }

    try {
      return crypto.decrypt(server.encryptedPassphrase);
    } catch {
      return undefined;
    }
  }

  /**
   * Generate a unique ID
   */
  private generateId(): string {
    return crypto.randomUUID();
  }
}

// Singleton instance
let serverManagerInstance: ServerManager | null = null;

export function getServerManager(): ServerManager {
  if (!serverManagerInstance) {
    serverManagerInstance = new ServerManager();
  }
  return serverManagerInstance;
}
