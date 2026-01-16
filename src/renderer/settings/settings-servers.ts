import { ipcRenderer } from 'electron';

export interface SSHServer {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'key' | 'agent';
  createdAt: number;
  updatedAt: number;
}

export class SettingsServers {
  private container: HTMLElement | null = null;
  private servers: SSHServer[] = [];
  private isUnlocked = false;
  private editingId: string | null = null;

  async render(container: HTMLElement): Promise<void> {
    this.container = container;
    
    // Check if crypto is unlocked
    this.isUnlocked = await ipcRenderer.invoke('crypto:is-unlocked');
    
    if (!this.isUnlocked) {
      this.renderPasswordPrompt();
    } else {
      await this.loadServers();
      this.renderUI();
    }
  }

  private renderPasswordPrompt(): void {
    if (!this.container) return;

    // Check if master password is set
    ipcRenderer.invoke('crypto:has-master-password').then((hasPassword: boolean) => {
      if (!this.container) return;
      
      this.container.innerHTML = `
        <div class="settings-section">
          <h2 class="settings-title">SSH Servers</h2>
          
          <div class="password-prompt">
            <div class="password-icon">🔒</div>
            <h3>${hasPassword ? 'Enter Master Password' : 'Set Master Password'}</h3>
            <p>${hasPassword 
              ? 'Enter your master password to access SSH servers.' 
              : 'Set a master password to securely store your SSH credentials.'}</p>
            
            <div class="form-group">
              <input type="password" id="master-password" placeholder="Master Password" autofocus>
            </div>
            ${!hasPassword ? `
              <div class="form-group">
                <input type="password" id="confirm-password" placeholder="Confirm Password">
              </div>
            ` : ''}
            
            <div class="form-actions">
              <button class="btn btn-primary" id="unlock-btn">${hasPassword ? 'Unlock' : 'Set Password'}</button>
            </div>
            
            <div class="password-error hidden" id="password-error"></div>
          </div>
        </div>
      `;

      this.setupPasswordListeners(hasPassword);
    });
  }

  private setupPasswordListeners(hasExisting: boolean): void {
    const passwordInput = document.getElementById('master-password') as HTMLInputElement;
    const confirmInput = document.getElementById('confirm-password') as HTMLInputElement;
    const unlockBtn = document.getElementById('unlock-btn');
    const errorDiv = document.getElementById('password-error');

    const handleUnlock = async () => {
      const password = passwordInput?.value;
      const confirm = confirmInput?.value;

      if (!password) {
        this.showError('Password is required');
        return;
      }

      if (!hasExisting && password !== confirm) {
        this.showError('Passwords do not match');
        return;
      }

      try {
        const result = await ipcRenderer.invoke('crypto:unlock', password);
        if (result.success) {
          this.isUnlocked = true;
          await this.loadServers();
          this.renderUI();
        } else {
          this.showError(result.error || 'Invalid password');
        }
      } catch (error) {
        this.showError('Failed to unlock');
      }
    };

    unlockBtn?.addEventListener('click', handleUnlock);
    passwordInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (hasExisting) {
          handleUnlock();
        } else {
          confirmInput?.focus();
        }
      }
    });
    confirmInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleUnlock();
    });
  }

  private showError(message: string): void {
    const errorDiv = document.getElementById('password-error');
    if (errorDiv) {
      errorDiv.textContent = message;
      errorDiv.classList.remove('hidden');
    }
  }

  private async loadServers(): Promise<void> {
    try {
      this.servers = await ipcRenderer.invoke('ssh:get-servers');
    } catch (error) {
      console.error('Failed to load servers:', error);
      this.servers = [];
    }
  }

  private renderUI(): void {
    if (!this.container) return;

    this.container.innerHTML = `
      <div class="settings-section">
        <h2 class="settings-title">SSH Servers</h2>
        
        <div class="server-list" id="server-list">
          ${this.renderServerList()}
        </div>

        <div class="settings-actions">
          <button class="btn btn-primary" id="add-server-btn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            Add Server
          </button>
          <button class="btn btn-secondary" id="lock-btn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
            </svg>
            Lock
          </button>
        </div>

        <div class="server-form hidden" id="server-form">
          <div class="form-header">
            <h3 id="form-title">Add Server</h3>
            <button class="btn-icon" id="close-form-btn">×</button>
          </div>
          
          <div class="form-group">
            <label for="server-name">Name</label>
            <input type="text" id="server-name" placeholder="My Server">
          </div>

          <div class="form-row">
            <div class="form-group flex-grow">
              <label for="server-host">Host</label>
              <input type="text" id="server-host" placeholder="192.168.1.1">
            </div>
            <div class="form-group" style="width: 100px;">
              <label for="server-port">Port</label>
              <input type="number" id="server-port" value="22">
            </div>
          </div>

          <div class="form-group">
            <label for="server-username">Username</label>
            <input type="text" id="server-username" placeholder="root">
          </div>

          <div class="form-group">
            <label for="server-auth-type">Authentication</label>
            <select id="server-auth-type">
              <option value="password">Password</option>
              <option value="key">SSH Key</option>
              <option value="agent">SSH Agent</option>
            </select>
          </div>

          <div class="auth-password" id="auth-password">
            <div class="form-group">
              <label for="server-password">Password</label>
              <input type="password" id="server-password" placeholder="Password">
            </div>
          </div>

          <div class="auth-key hidden" id="auth-key">
            <div class="form-group">
              <label for="server-private-key">Private Key</label>
              <textarea id="server-private-key" rows="6" placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"></textarea>
            </div>
            <div class="form-group">
              <label for="server-passphrase">Passphrase (optional)</label>
              <input type="password" id="server-passphrase" placeholder="Key passphrase">
            </div>
          </div>

          <div class="form-actions">
            <button class="btn btn-secondary" id="cancel-form-btn">Cancel</button>
            <button class="btn btn-primary" id="save-form-btn">Save</button>
          </div>
        </div>
      </div>
    `;

    this.setupEventListeners();
  }

  private renderServerList(): string {
    if (this.servers.length === 0) {
      return '<div class="empty-state">No SSH servers configured</div>';
    }

    return this.servers.map(s => `
      <div class="server-item" data-id="${s.id}">
        <div class="server-info">
          <div class="server-name">${s.name}</div>
          <div class="server-meta">
            <span>${s.username}@${s.host}:${s.port}</span>
            <span class="server-auth-type">${s.authType}</span>
          </div>
        </div>
        <div class="server-actions">
          <button class="btn btn-primary connect-btn" title="Connect">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polygon points="5 3 19 12 5 21 5 3"></polygon>
            </svg>
          </button>
          <button class="btn-icon edit-btn" title="Edit">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
          </button>
          <button class="btn-icon delete-btn" title="Delete">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </div>
      </div>
    `).join('');
  }

  private setupEventListeners(): void {
    // Add server button
    document.getElementById('add-server-btn')?.addEventListener('click', () => {
      this.showServerForm();
    });

    // Lock button
    document.getElementById('lock-btn')?.addEventListener('click', async () => {
      await ipcRenderer.invoke('crypto:lock');
      this.isUnlocked = false;
      this.renderPasswordPrompt();
    });

    // Close form
    document.getElementById('close-form-btn')?.addEventListener('click', () => {
      this.hideServerForm();
    });

    document.getElementById('cancel-form-btn')?.addEventListener('click', () => {
      this.hideServerForm();
    });

    // Save form
    document.getElementById('save-form-btn')?.addEventListener('click', () => {
      this.saveServer();
    });

    // Auth type change
    document.getElementById('server-auth-type')?.addEventListener('change', (e) => {
      const type = (e.target as HTMLSelectElement).value;
      document.getElementById('auth-password')?.classList.toggle('hidden', type !== 'password');
      document.getElementById('auth-key')?.classList.toggle('hidden', type !== 'key');
    });

    // Server item actions
    document.querySelectorAll('.server-item').forEach(item => {
      const id = item.getAttribute('data-id');
      if (!id) return;

      item.querySelector('.connect-btn')?.addEventListener('click', () => {
        this.connectToServer(id);
      });

      item.querySelector('.edit-btn')?.addEventListener('click', () => {
        this.editServer(id);
      });

      item.querySelector('.delete-btn')?.addEventListener('click', () => {
        this.deleteServer(id);
      });
    });
  }

  private showServerForm(server?: SSHServer): void {
    const form = document.getElementById('server-form');
    const title = document.getElementById('form-title');
    
    if (!form || !title) return;

    this.editingId = server?.id || null;
    title.textContent = server ? 'Edit Server' : 'Add Server';

    // Fill form fields
    (document.getElementById('server-name') as HTMLInputElement).value = server?.name || '';
    (document.getElementById('server-host') as HTMLInputElement).value = server?.host || '';
    (document.getElementById('server-port') as HTMLInputElement).value = String(server?.port || 22);
    (document.getElementById('server-username') as HTMLInputElement).value = server?.username || '';
    (document.getElementById('server-auth-type') as HTMLSelectElement).value = server?.authType || 'password';
    (document.getElementById('server-password') as HTMLInputElement).value = '';
    (document.getElementById('server-private-key') as HTMLTextAreaElement).value = '';
    (document.getElementById('server-passphrase') as HTMLInputElement).value = '';

    // Show/hide auth fields
    const authType = server?.authType || 'password';
    document.getElementById('auth-password')?.classList.toggle('hidden', authType !== 'password');
    document.getElementById('auth-key')?.classList.toggle('hidden', authType !== 'key');

    form.classList.remove('hidden');
  }

  private hideServerForm(): void {
    document.getElementById('server-form')?.classList.add('hidden');
    this.editingId = null;
  }

  private async saveServer(): Promise<void> {
    const name = (document.getElementById('server-name') as HTMLInputElement).value.trim();
    const host = (document.getElementById('server-host') as HTMLInputElement).value.trim();
    const port = parseInt((document.getElementById('server-port') as HTMLInputElement).value) || 22;
    const username = (document.getElementById('server-username') as HTMLInputElement).value.trim();
    const authType = (document.getElementById('server-auth-type') as HTMLSelectElement).value as 'password' | 'key' | 'agent';
    const password = (document.getElementById('server-password') as HTMLInputElement).value;
    const privateKey = (document.getElementById('server-private-key') as HTMLTextAreaElement).value;
    const passphrase = (document.getElementById('server-passphrase') as HTMLInputElement).value;

    if (!name || !host || !username) {
      alert('Name, Host, and Username are required');
      return;
    }

    let credential: string | undefined;
    if (authType === 'password' && password) {
      credential = password;
    } else if (authType === 'key' && privateKey) {
      credential = privateKey;
    }

    try {
      if (this.editingId) {
        await ipcRenderer.invoke('ssh:update-server', {
          id: this.editingId,
          name,
          host,
          port,
          username,
          authType,
          credential,
          passphrase: passphrase || undefined,
        });
      } else {
        await ipcRenderer.invoke('ssh:add-server', {
          name,
          host,
          port,
          username,
          authType,
          credential,
          passphrase: passphrase || undefined,
        });
      }

      this.hideServerForm();
      await this.loadServers();
      this.renderUI();
    } catch (error) {
      console.error('Failed to save server:', error);
      alert('Failed to save server');
    }
  }

  private async editServer(id: string): Promise<void> {
    const server = this.servers.find(s => s.id === id);
    if (server) {
      this.showServerForm(server);
    }
  }

  private async deleteServer(id: string): Promise<void> {
    if (!confirm('Are you sure you want to delete this server?')) {
      return;
    }

    try {
      await ipcRenderer.invoke('ssh:delete-server', id);
      await this.loadServers();
      this.renderUI();
    } catch (error) {
      console.error('Failed to delete server:', error);
      alert('Failed to delete server');
    }
  }

  private async connectToServer(id: string): Promise<void> {
    try {
      // Switch to terminal view and create SSH connection
      await ipcRenderer.invoke('ssh:connect', id);
    } catch (error) {
      console.error('Failed to connect:', error);
      alert('Failed to connect to server');
    }
  }
}
