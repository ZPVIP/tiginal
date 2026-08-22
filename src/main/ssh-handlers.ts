import { ipcMain } from 'electron';
import { getDatabase } from '../services/database/database';
import { getCrypto } from '../services/ssh/CryptoService';

interface SSHServerInput {
  id?: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'key' | 'agent';
  credential?: string;
  passphrase?: string;
}

interface SSHServer {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'key' | 'agent';
  createdAt: number;
  updatedAt: number;
}

/**
 * Setup SSH-related IPC handlers
 */
export function setupSSHHandlers(): void {
  // Check if crypto is unlocked
  ipcMain.handle('crypto:is-unlocked', async (): Promise<boolean> => {
    return getCrypto().isUnlocked();
  });

  // Check if master password is set
  ipcMain.handle('crypto:has-master-password', async (): Promise<boolean> => {
    const db = getDatabase();
    const salt = db.getSetting('master_password_salt');
    return salt !== null;
  });

  // Unlock with password
  ipcMain.handle('crypto:unlock', async (_event, password: string): Promise<{ success: boolean; error?: string }> => {
    const db = getDatabase();
    const crypto = getCrypto();

    try {
      const saltHex = db.getSetting('master_password_salt');
      const existingHash = db.getSetting('master_password_hash');

      const salt = saltHex ? Buffer.from(saltHex, 'hex') : undefined;
      
      const result = await crypto.initialize(password, salt, existingHash || undefined);

      // Save salt and hash if this is a new password
      if (result.isNew) {
        db.setSetting('master_password_salt', result.salt.toString('hex'));
        db.setSetting('master_password_hash', result.verificationHash);
      }

      // Save the encryption key for auto-unlock on next startup
      crypto.saveKey();

      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  // Change the master password and re-encrypt every protected database value.
  ipcMain.handle('crypto:change-password', async (
    _event,
    password: string
  ): Promise<{ success: boolean; autoUnlockSaved?: boolean; error?: string }> => {
    const dbService = getDatabase();
    const db = dbService.getDb();
    const crypto = getCrypto();

    if (!crypto.isUnlocked()) {
      return { success: false, error: 'Master key must be unlocked' };
    }
    if (!password) {
      return { success: false, error: 'New password is required' };
    }

    try {
      const aiRows = db.prepare(`
        SELECT id, api_key_encrypted
        FROM ai_providers
        WHERE api_key_encrypted IS NOT NULL AND length(api_key_encrypted) > 0
      `).all() as Array<{ id: string; api_key_encrypted: string }>;
      const sshRows = db.prepare(`
        SELECT id, encrypted_credential, encrypted_passphrase
        FROM ssh_servers
        WHERE encrypted_credential IS NOT NULL OR encrypted_passphrase IS NOT NULL
      `).all() as Array<{
        id: string;
        encrypted_credential: string | null;
        encrypted_passphrase: string | null;
      }>;

      // Decrypt everything before changing the active key. Any unreadable row
      // aborts the operation before the database or key state is modified.
      const aiPlaintext = aiRows.map(row => ({
        id: row.id,
        apiKey: crypto.decrypt(row.api_key_encrypted),
      }));
      const sshPlaintext = sshRows.map(row => ({
        id: row.id,
        credential: row.encrypted_credential ? crypto.decrypt(row.encrypted_credential) : null,
        passphrase: row.encrypted_passphrase ? crypto.decrypt(row.encrypted_passphrase) : null,
      }));

      const updateApiKey = db.prepare(
        'UPDATE ai_providers SET api_key_encrypted = ? WHERE id = ?'
      );
      const updateSshSecrets = db.prepare(`
        UPDATE ssh_servers
        SET encrypted_credential = ?, encrypted_passphrase = ?
        WHERE id = ?
      `);
      const updateSetting = db.prepare(`
        INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)
      `);

      await crypto.rotateKey(password, ({ salt, verificationHash }) => {
        db.transaction(() => {
          for (const row of aiPlaintext) {
            updateApiKey.run(crypto.encrypt(row.apiKey), row.id);
          }
          for (const row of sshPlaintext) {
            updateSshSecrets.run(
              row.credential ? crypto.encrypt(row.credential) : null,
              row.passphrase ? crypto.encrypt(row.passphrase) : null,
              row.id
            );
          }
          updateSetting.run('master_password_salt', salt.toString('hex'));
          updateSetting.run('master_password_hash', verificationHash);
        })();
      });

      const autoUnlockSaved = crypto.saveKey();
      if (!autoUnlockSaved) {
        // Never leave a stale auto-unlock key pointing at the old ciphertext.
        // Manual unlock with the new password will still work on next launch.
        crypto.clearSavedKey();
      }
      return { success: true, autoUnlockSaved };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  // Save encryption key using safeStorage for auto-unlock
  ipcMain.handle('crypto:save-key', async (): Promise<boolean> => {
    return getCrypto().saveKey();
  });

  // Try to auto-unlock using saved key
  ipcMain.handle('crypto:try-auto-unlock', async (): Promise<boolean> => {
    return getCrypto().tryAutoUnlock();
  });

  // Check if there is a saved key
  ipcMain.handle('crypto:has-saved-key', async (): Promise<boolean> => {
    return getCrypto().hasSavedKey();
  });

  // Clear saved key
  ipcMain.handle('crypto:clear-saved-key', async (): Promise<void> => {
    getCrypto().clearSavedKey();
  });

  // Lock crypto
  ipcMain.handle('crypto:lock', async (): Promise<void> => {
    getCrypto().lock();
  });

  // Get all servers
  ipcMain.handle('ssh:get-servers', async (): Promise<SSHServer[]> => {
    const db = getDatabase().getDb();
    const rows = db.prepare(`
      SELECT id, name, host, port, username, auth_type, created_at, updated_at
      FROM ssh_servers ORDER BY name
    `).all() as Array<{
      id: string;
      name: string;
      host: string;
      port: number;
      username: string;
      auth_type: string;
      created_at: number;
      updated_at: number;
    }>;

    return rows.map(row => ({
      id: row.id,
      name: row.name,
      host: row.host,
      port: row.port,
      username: row.username,
      authType: row.auth_type as 'password' | 'key' | 'agent',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  });

  // Add server
  ipcMain.handle('ssh:add-server', async (_event, input: SSHServerInput): Promise<SSHServer> => {
    const db = getDatabase().getDb();
    const crypto = getCrypto();
    
    const id = require('crypto').randomUUID();
    const now = Date.now();
    
    let encryptedCredential: string | null = null;
    let encryptedPassphrase: string | null = null;

    if (crypto.isUnlocked()) {
      if (input.credential) {
        encryptedCredential = crypto.encrypt(input.credential);
      }
      if (input.passphrase) {
        encryptedPassphrase = crypto.encrypt(input.passphrase);
      }
    }

    db.prepare(`
      INSERT INTO ssh_servers (id, name, host, port, username, auth_type, encrypted_credential, encrypted_passphrase, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.name,
      input.host,
      input.port,
      input.username,
      input.authType,
      encryptedCredential,
      encryptedPassphrase,
      now,
      now
    );

    return {
      id,
      name: input.name,
      host: input.host,
      port: input.port,
      username: input.username,
      authType: input.authType,
      createdAt: now,
      updatedAt: now,
    };
  });

  // Update server
  ipcMain.handle('ssh:update-server', async (_event, input: SSHServerInput): Promise<void> => {
    if (!input.id) throw new Error('Server ID required');

    const db = getDatabase().getDb();
    const crypto = getCrypto();
    const now = Date.now();

    // Get existing server
    const existing = db.prepare('SELECT * FROM ssh_servers WHERE id = ?').get(input.id) as {
      encrypted_credential: string | null;
      encrypted_passphrase: string | null;
    } | undefined;
    
    if (!existing) throw new Error('Server not found');

    let encryptedCredential = existing.encrypted_credential;
    let encryptedPassphrase = existing.encrypted_passphrase;

    if (crypto.isUnlocked()) {
      if (input.credential !== undefined) {
        encryptedCredential = input.credential ? crypto.encrypt(input.credential) : null;
      }
      if (input.passphrase !== undefined) {
        encryptedPassphrase = input.passphrase ? crypto.encrypt(input.passphrase) : null;
      }
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
      input.name,
      input.host,
      input.port,
      input.username,
      input.authType,
      encryptedCredential,
      encryptedPassphrase,
      now,
      input.id
    );
  });

  // Delete server
  ipcMain.handle('ssh:delete-server', async (_event, id: string): Promise<void> => {
    const db = getDatabase().getDb();
    db.prepare('DELETE FROM ssh_servers WHERE id = ?').run(id);
  });

  // Connect to server (placeholder - will be implemented with ssh2)
  ipcMain.handle('ssh:connect', async (_event, id: string): Promise<void> => {
    // TODO: Implement SSH connection using ssh2
    console.log('SSH connect requested for server:', id);
  });
}
