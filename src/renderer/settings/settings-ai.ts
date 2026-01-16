import { ipcRenderer } from 'electron';

export interface AIProvider {
  id: string;
  name: string;
  type: 'openai-compatible' | 'copilot';
  endpoint?: string;
  apiKeyEncrypted?: string;
  model: string;
  availableModels?: string[];
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
}

export class SettingsAI {
  private container: HTMLElement | null = null;
  private providers: AIProvider[] = [];
  private editingId: string | null = null;
  private availableModels: string[] = [];

  constructor() {
    this.container = document.getElementById('settings-content');
  }

  async render(container: HTMLElement): Promise<void> {
    this.container = container;
    await this.loadProviders();
    this.renderUI();
  }

  private async loadProviders(): Promise<void> {
    try {
      this.providers = await ipcRenderer.invoke('ai:get-providers');
    } catch (error) {
      console.error('Failed to load AI providers:', error);
      this.providers = [];
    }
  }

  private renderUI(): void {
    if (!this.container) return;

    this.container.innerHTML = `
      <div class="settings-section">
        <h2 class="settings-title">AI Providers</h2>
        
        <div class="provider-list" id="provider-list">
          ${this.renderProviderList()}
        </div>

        <div class="settings-actions">
          <button class="btn btn-primary" id="add-openai-btn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            Add OpenAI-compatible
          </button>
          <button class="btn btn-secondary" id="add-copilot-btn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path>
            </svg>
            Connect Copilot
          </button>
        </div>

        <div class="provider-form hidden" id="provider-form">
          <div class="form-header">
            <h3 id="form-title">Add Provider</h3>
            <button class="btn-icon" id="close-form-btn">×</button>
          </div>
          
          <div class="form-group">
            <label for="provider-name">Name</label>
            <input type="text" id="provider-name" placeholder="My OpenAI Provider">
          </div>

          <div class="form-group">
            <label for="provider-endpoint">Endpoint URL</label>
            <input type="url" id="provider-endpoint" placeholder="https://api.openai.com/v1">
          </div>

          <div class="form-group">
            <label for="provider-api-key">API Key (optional)</label>
            <input type="password" id="provider-api-key" placeholder="sk-...">
          </div>

          <div class="form-group flex-row" style="gap: 8px; align-items: flex-end;">
             <div class="flex-grow">
               <label for="provider-model">Model</label>
               <input type="text" id="provider-model" placeholder="gpt-4o" list="model-list">
               <datalist id="model-list"></datalist>
             </div>
             <button class="btn btn-secondary" id="test-connection-btn" style="margin-bottom: 2px;">
               Test Connection
             </button>
          </div>
          <div id="test-status" class="test-status hidden"></div>

          <div class="form-group checkbox">
            <label>
              <input type="checkbox" id="provider-default">
              Set as default
            </label>
          </div>

          <div class="form-actions">
            <button class="btn btn-secondary" id="cancel-form-btn">Cancel</button>
            <button class="btn btn-primary" id="save-form-btn">Save</button>
          </div>
        </div>

        <div class="copilot-auth hidden" id="copilot-auth">
          <div class="copilot-auth-content">
            <h3>GitHub Copilot Login</h3>
            <p>Enter this code on GitHub:</p>
            <div class="device-code" id="device-code">XXXX-XXXX</div>
            <a href="#" class="verification-link" id="verification-link" target="_blank">Open GitHub</a>
            <p class="auth-status" id="auth-status">Waiting for authorization...</p>
            <button class="btn btn-secondary" id="cancel-copilot-btn">Cancel</button>
          </div>
        </div>
      </div>
    `;

    this.setupEventListeners();
  }

  private renderProviderList(): string {
    if (this.providers.length === 0) {
      return '<div class="empty-state">No AI providers configured</div>';
    }

    return this.providers.map(p => `
      <div class="provider-item" data-id="${p.id}">
        <div class="provider-info">
          <div class="provider-name">
            ${p.name}
            ${p.isDefault ? '<span class="badge">Default</span>' : ''}
          </div>
          <div class="provider-meta">
            <span class="provider-type">${p.type}</span>
            <span class="provider-model">${p.model}</span>
          </div>
        </div>
        <div class="provider-actions">
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
    // Add OpenAI-compatible button
    document.getElementById('add-openai-btn')?.addEventListener('click', () => {
      this.showProviderForm();
    });

    // Add Copilot button
    document.getElementById('add-copilot-btn')?.addEventListener('click', () => {
      this.startCopilotAuth();
    });

    // Close form button
    document.getElementById('close-form-btn')?.addEventListener('click', () => {
      this.hideProviderForm();
    });

    // Cancel form button
    document.getElementById('cancel-form-btn')?.addEventListener('click', () => {
      this.hideProviderForm();
    });

    // Save form button
    document.getElementById('save-form-btn')?.addEventListener('click', () => {
      this.saveProvider();
    });

    // Test connection button
    document.getElementById('test-connection-btn')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.testConnection();
    });

    // Model input change
    document.getElementById('provider-model')?.addEventListener('change', (e) => {
       const input = e.target as HTMLInputElement;
       // If selected from datalist, it might be one of availableModels
    });

    // Cancel Copilot auth
    document.getElementById('cancel-copilot-btn')?.addEventListener('click', () => {
      this.hideCopilotAuth();
    });

    // Provider item actions
    document.querySelectorAll('.provider-item').forEach(item => {
      const id = item.getAttribute('data-id');
      if (!id) return;

      item.querySelector('.edit-btn')?.addEventListener('click', () => {
        this.editProvider(id);
      });

      item.querySelector('.delete-btn')?.addEventListener('click', () => {
        this.deleteProvider(id);
      });
    });
  }

  private showProviderForm(provider?: AIProvider): void {
    const form = document.getElementById('provider-form');
    const title = document.getElementById('form-title');
    
    if (!form || !title) return;

    this.editingId = provider?.id || null;
    title.textContent = provider ? 'Edit Provider' : 'Add Provider';

    // Fill form fields
    (document.getElementById('provider-name') as HTMLInputElement).value = provider?.name || '';
    (document.getElementById('provider-endpoint') as HTMLInputElement).value = provider?.endpoint || 'https://api.openai.com/v1';
    (document.getElementById('provider-api-key') as HTMLInputElement).value = '';
    (document.getElementById('provider-model') as HTMLInputElement).value = provider?.model || 'gpt-4o';
    (document.getElementById('provider-default') as HTMLInputElement).checked = provider?.isDefault || false;
    
    this.availableModels = provider?.availableModels || [];
    this.updateModelList();
    this.setTestStatus('', 'hidden');

    form.classList.remove('hidden');
  }

  private hideProviderForm(): void {
    document.getElementById('provider-form')?.classList.add('hidden');
    this.editingId = null;
    this.availableModels = [];
  }

  private async testConnection(): Promise<void> {
    const endpoint = (document.getElementById('provider-endpoint') as HTMLInputElement).value.trim();
    const apiKey = (document.getElementById('provider-api-key') as HTMLInputElement).value;
    const btn = document.getElementById('test-connection-btn') as HTMLButtonElement;

    if (!endpoint) {
      this.setTestStatus('Endpoint is required', 'error');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Testing...';
    this.setTestStatus('Testing connection...', 'info');

    try {
      const result = await ipcRenderer.invoke('ai:test-connection', {
        type: 'openai-compatible',
        endpoint,
        apiKey: apiKey || undefined
      });

      if (result.success) {
        this.setTestStatus(`Success! Found ${result.models?.length || 0} models.`, 'success');
        if (result.models && result.models.length > 0) {
           this.availableModels = result.models;
           this.updateModelList();
           
           // If current model is empty, auto-select first one or gpt-4o if present
           const modelInput = document.getElementById('provider-model') as HTMLInputElement;
           if (!modelInput.value) {
             if (this.availableModels.includes('gpt-4o')) modelInput.value = 'gpt-4o';
             else if (this.availableModels.includes('gpt-4')) modelInput.value = 'gpt-4';
             else modelInput.value = this.availableModels[0];
           }
        }
      } else {
        this.setTestStatus(`Failed: ${result.error}`, 'error');
      }
    } catch (error) {
      this.setTestStatus(`Error: ${(error as Error).message}`, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Test Connection';
    }
  }

  private setTestStatus(message: string, type: 'success' | 'error' | 'info' | 'hidden'): void {
    const statusDiv = document.getElementById('test-status');
    if (!statusDiv) return;

    if (type === 'hidden') {
      statusDiv.classList.add('hidden');
      statusDiv.textContent = '';
      statusDiv.className = 'test-status hidden';
      return;
    }

    statusDiv.textContent = message;
    statusDiv.className = `test-status ${type}`;
    statusDiv.classList.remove('hidden');
  }

  private updateModelList(): void {
    const dataList = document.getElementById('model-list');
    if (!dataList) return;

    dataList.innerHTML = '';
    this.availableModels.forEach(model => {
      const option = document.createElement('option');
      option.value = model;
      dataList.appendChild(option);
    });
  }

  private async saveProvider(): Promise<void> {
    const name = (document.getElementById('provider-name') as HTMLInputElement).value.trim();
    const endpoint = (document.getElementById('provider-endpoint') as HTMLInputElement).value.trim();
    const apiKey = (document.getElementById('provider-api-key') as HTMLInputElement).value;
    const model = (document.getElementById('provider-model') as HTMLInputElement).value.trim();
    const isDefault = (document.getElementById('provider-default') as HTMLInputElement).checked;

    if (!name || !model) {
      alert('Name and Model are required');
      return;
    }

    try {
      if (this.editingId) {
        await ipcRenderer.invoke('ai:update-provider', {
          id: this.editingId,
          name,
          endpoint,
          apiKey: apiKey || undefined,
          model,
          availableModels: this.availableModels.length > 0 ? this.availableModels : undefined,
          isDefault,
        });
      } else {
        await ipcRenderer.invoke('ai:add-provider', {
          name,
          type: 'openai-compatible',
          endpoint,
          apiKey: apiKey || undefined,
          model,
          availableModels: this.availableModels.length > 0 ? this.availableModels : undefined,
          isDefault,
        });
      }

      this.hideProviderForm();
      await this.loadProviders();
      this.renderUI();
    } catch (error) {
      console.error('Failed to save provider:', error);
      alert('Failed to save provider');
    }
  }

  private async editProvider(id: string): Promise<void> {
    const provider = this.providers.find(p => p.id === id);
    if (provider) {
      this.showProviderForm(provider);
    }
  }

  private async deleteProvider(id: string): Promise<void> {
    if (!confirm('Are you sure you want to delete this provider?')) {
      return;
    }

    try {
      await ipcRenderer.invoke('ai:delete-provider', id);
      await this.loadProviders();
      this.renderUI();
    } catch (error) {
      console.error('Failed to delete provider:', error);
      alert('Failed to delete provider');
    }
  }

  private async startCopilotAuth(): Promise<void> {
    const authDiv = document.getElementById('copilot-auth');
    if (!authDiv) return;

    authDiv.classList.remove('hidden');

    try {
      // Start device flow
      const { userCode, verificationUri } = await ipcRenderer.invoke('copilot:start-auth');
      
      document.getElementById('device-code')!.textContent = userCode;
      const link = document.getElementById('verification-link') as HTMLAnchorElement;
      link.href = verificationUri;

      // Poll for token
      const pollResult = await ipcRenderer.invoke('copilot:poll-auth');
      
      if (pollResult.success) {
        document.getElementById('auth-status')!.textContent = 'Connected successfully!';
        setTimeout(() => {
          this.hideCopilotAuth();
          this.loadProviders().then(() => this.renderUI());
        }, 1500);
      } else {
        document.getElementById('auth-status')!.textContent = 'Authorization failed: ' + pollResult.error;
      }
    } catch (error) {
      console.error('Copilot auth failed:', error);
      document.getElementById('auth-status')!.textContent = 'Authorization failed';
    }
  }

  private hideCopilotAuth(): void {
    document.getElementById('copilot-auth')?.classList.add('hidden');
  }
}
