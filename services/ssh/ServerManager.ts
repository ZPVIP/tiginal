import { SSHServerConfig } from '../../src/shared/types';
import { CryptoService } from './CryptoService';

/**
 * SSH Server configuration manager
 * Handles CRUD operations for SSH server configurations with encrypted storage
 */
export class ServerManager {
  private servers: Map<string, SSHServerConfig> = new Map();
  private masterPassword: string | null = null;
  private storageKey = 'tiginal-ssh-servers';

  /**
   * Initialize the server manager with a master password
   */
  async initialize(masterPassword: string): Promise<void> {
    this.masterPassword = masterPassword;
    await this.loadFromStorage();
  }

  /**
   * Add a new SSH server configuration
   */
  async addServer(
    config: Omit<SSHServerConfig, 'id' | 'createdAt' | 'updatedAt' | 'encryptedCredential'>,
    credential?: string
  ): Promise<SSHServerConfig> {
    const id = crypto.randomUUID();
    const now = Date.now();

    const server: SSHServerConfig = {
      ...config,
      id,
      createdAt: now,
      updatedAt: now,
    };

    if (credential && this.masterPassword) {
      server.encryptedCredential = CryptoService.encrypt(
        credential,
        this.masterPassword
      );
    }

    this.servers.set(id, server);
    await this.saveToStorage();

    return server;
  }

  /**
   * Get a server by ID
   */
  getServer(id: string): SSHServerConfig | undefined {
    return this.servers.get(id);
  }

  /**
   * Get all servers
   */
  getAllServers(): SSHServerConfig[] {
    return Array.from(this.servers.values());
  }

  /**
   * Update a server configuration
   */
  async updateServer(
    id: string,
    updates: Partial<Omit<SSHServerConfig, 'id' | 'createdAt'>>
  ): Promise<SSHServerConfig | undefined> {
    const server = this.servers.get(id);
    if (!server) return undefined;

    const updated: SSHServerConfig = {
      ...server,
      ...updates,
      updatedAt: Date.now(),
    };

    this.servers.set(id, updated);
    await this.saveToStorage();

    return updated;
  }

  /**
   * Delete a server
   */
  async deleteServer(id: string): Promise<boolean> {
    const deleted = this.servers.delete(id);
    if (deleted) {
      await this.saveToStorage();
    }
    return deleted;
  }

  /**
   * Get decrypted credential for a server
   */
  getCredential(id: string): string | undefined {
    const server = this.servers.get(id);
    if (!server?.encryptedCredential || !this.masterPassword) {
      return undefined;
    }

    try {
      return CryptoService.decrypt(
        server.encryptedCredential,
        this.masterPassword
      );
    } catch {
      return undefined;
    }
  }

  /**
   * Load servers from storage
   * TODO: Implement actual storage (electron-store or similar)
   */
  private async loadFromStorage(): Promise<void> {
    // Placeholder: will be implemented with actual storage
    // const stored = await electronStore.get(this.storageKey);
    // if (stored) { ... }
  }

  /**
   * Save servers to storage
   * TODO: Implement actual storage
   */
  private async saveToStorage(): Promise<void> {
    // Placeholder: will be implemented with actual storage
    // await electronStore.set(this.storageKey, Array.from(this.servers.values()));
  }

  /**
   * Export servers for sync
   * Returns encrypted data that can be synced to server
   */
  async exportForSync(): Promise<string> {
    const data = JSON.stringify(Array.from(this.servers.values()));
    if (!this.masterPassword) {
      throw new Error('Master password not set');
    }
    return CryptoService.encrypt(data, this.masterPassword);
  }

  /**
   * Import servers from sync
   */
  async importFromSync(encryptedData: string): Promise<void> {
    if (!this.masterPassword) {
      throw new Error('Master password not set');
    }

    const data = CryptoService.decrypt(encryptedData, this.masterPassword);
    const servers: SSHServerConfig[] = JSON.parse(data);

    for (const server of servers) {
      this.servers.set(server.id, server);
    }

    await this.saveToStorage();
  }
}
