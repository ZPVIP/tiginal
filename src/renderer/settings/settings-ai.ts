import { ipcRenderer } from 'electron';
import { ICONS } from './icons';

const OAI_API_PROVIDERS = [
  { label: "Custom", value: "custom", baseUrl: "" },
  { label: "Cerebras", value: "cerebras", baseUrl: "https://api.cerebras.ai/v1" },
  { label: "Ollama", value: "ollama", baseUrl: "http://localhost:11434/v1" },
  { label: "OpenAI", value: "openai", baseUrl: "https://api.openai.com/v1" },
  { label: "LLaMa.cpp", value: "llamacpp", baseUrl: "http://localhost:8080/v1" },
  { label: "LM Studio", value: "lmstudio", baseUrl: "http://localhost:1234/v1" },
  { label: "Llamafile", value: "llamafile", baseUrl: "http://127.0.0.1:8080/v1" },
  { label: "DeepSeek", value: "deepseek", baseUrl: "https://api.deepseek.com" },
  { label: "Groq", value: "groq", baseUrl: "https://api.groq.com/openai/v1" },
  { label: "Mistral", value: "mistral", baseUrl: "https://api.mistral.ai/v1" },
  { label: "Anthropic (Claude)", value: "anthropic", baseUrl: "https://api.anthropic.com/v1" },
  { label: "OpenRouter", value: "openrouter", baseUrl: "https://openrouter.ai/api/v1" },
  { label: "Google AI", value: "gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai" },
];

export interface ModelConfig {
  name: string;
  enabled: boolean;
}

export interface AIProvider {
  id: string;
  name: string;
  type: 'openai-compatible' | 'copilot';
  endpoint?: string;
  apiKeyEncrypted?: string;
  model: string;
  availableModels?: ModelConfig[];
  customHeaders?: Record<string, string>;
  autoCORSFix?: boolean;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
}

export class SettingsAI {
  private container: HTMLElement | null = null;
  private providers: AIProvider[] = [];
  private editingId: string | null = null;
  private availableModels: ModelConfig[] = [];
  private customHeaders: { key: string; value: string }[] = [];
  private abortController: AbortController | null = null;

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
      // Normalize legacy data if any
      this.providers.forEach(p => {
        if (!Array.isArray(p.availableModels)) {
            p.availableModels = [];
        } else if (p.availableModels.length > 0 && typeof p.availableModels[0] === 'string') {
            // Legacy string[] detected, treat as empty (or migrate if we wanted to, but user said treat as empty)
            // But actually preserving them as enabled is nicer if they exist? 
            // User said: "Backward compatibility will be handled code-side... 这里不需要... 当空的 json"
            // So we clear it.
            console.warn('Legacy model format detected, clearing.', p.availableModels);
            p.availableModels = [];
        }
      });
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
            Add Provider
          </button>
          <button class="btn btn-secondary" id="add-copilot-btn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path>
            </svg>
            Connect Copilot
          </button>
        </div>

        <!-- Provider Form Modal -->
        <div class="modal hidden" id="provider-modal" style="z-index: 1050;"> <!-- Lower z-index than model modal -->
          <div class="modal-content" style="width: 600px; max-height: 90vh;">
            <div class="modal-header">
              <h3 id="form-title">Add Provider</h3>
              <button class="btn-icon" id="close-form-btn">×</button>
            </div>
            
            <div class="modal-body">
              <div class="form-group" id="provider-preset-group">
                <label for="provider-preset">Preset</label>
                <!-- Custom Select Structure -->
                <div class="custom-select" id="provider-preset-select">
                  <div class="select-selected">
                    <div class="selected-content">
                      <span class="provider-icon">${ICONS.custom || ICONS.default}</span>
                      <span class="provider-label">Custom</span>
                    </div>
                  </div>
                  <div class="select-items select-hide">
                    ${OAI_API_PROVIDERS.map(p => `
                      <div class="select-item" data-value="${p.value}" data-url="${p.baseUrl}" data-label="${p.label}">
                        <span class="provider-icon">${ICONS[p.value] || ICONS.default}</span>
                        <span class="provider-label">${p.label}</span>
                      </div>
                    `).join('')}
                  </div>
                </div>
                <input type="hidden" id="provider-preset-value" value="custom">
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
                <div class="input-with-icon">
                  <input type="password" id="provider-api-key" placeholder="sk-...">
                  <button class="icon-btn toggle-password">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                      <circle cx="12" cy="12" r="3"></circle>
                    </svg>
                  </button>
                </div>
              </div>

              <div class="form-group flex-row" style="gap: 8px; align-items: flex-end;">
                 <div class="flex-grow">
                   <label for="provider-model">Model</label>
                   <div class="flex-row" style="gap: 4px;">
                     <div class="model-picker settings-model-picker flex-grow" id="settings-model-picker">
                       <button class="model-picker-trigger" id="settings-model-trigger" type="button">
                         <span class="model-picker-label" id="settings-model-label">Select model...</span>
                         <svg class="model-picker-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                           <polyline points="6 9 12 15 18 9"></polyline>
                         </svg>
                       </button>
                       <div class="model-picker-list hidden" id="settings-model-list"></div>
                     </div>
                     <button class="btn btn-sm btn-secondary" id="manage-models-btn" title="Manage Models">
                       <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                          <polyline points="7 10 12 15 17 10"></polyline>
                          <line x1="12" y1="15" x2="12" y2="3"></line>
                       </svg>
                     </button>
                   </div>
                   <input type="hidden" id="provider-model" value="">
                 </div>
                 <button class="btn btn-secondary" id="test-connection-btn">
                   Test Connection
                 </button>
              </div>
              <div id="test-status" class="test-status hidden"></div>
              
              <!-- Custom Headers -->
              <div class="form-group">
                <label>Custom Headers</label>
                <div id="custom-headers-list" class="custom-headers-list"></div>
                <button class="btn btn-sm btn-secondary" id="add-header-btn" style="margin-top: 5px;">+ Add Header</button>
              </div>

              <!-- Auto CORS Fix -->
              <div class="checkbox-group">
                 <input type="checkbox" id="provider-auto-cors" checked>
                 <label for="provider-auto-cors" style="color: #ccc; font-size: 13px;">
                   Enable Auto CORS Fix (Ollama / Local Providers)
                 </label>
              </div>
            </div>
            
            <div class="modal-footer">
              <button class="btn btn-secondary" id="cancel-form-btn">Cancel</button>
              <button class="btn btn-primary" id="save-form-btn">Save</button>
            </div>
          </div>
        </div>
        
        <!-- Model Management Modal -->
        <div class="modal hidden" id="model-modal">
          <div class="modal-content" style="max-height: 80vh; display: flex; flex-direction: column;">
            <div class="modal-header">
              <h3>Manage Models</h3>
              <button class="btn-icon" id="close-model-modal">×</button>
            </div>
            <div class="modal-body" style="flex: 1; overflow-y: auto;">
              <div class="model-actions-bar" style="margin-bottom: 10px; display: flex; gap: 10px;">
                  <button class="btn btn-sm btn-secondary" id="select-all-models-btn">Select All</button>
                  <button class="btn btn-sm btn-secondary" id="deselect-all-models-btn">Deselect All</button>
              </div>
              <div class="model-list-editor" id="model-list-editor"></div>
            </div>
            <div class="modal-footer">
              <button class="btn btn-secondary" id="cancel-model-modal">Cancel</button>
              <button class="btn btn-primary" id="done-model-modal">Save</button>
            </div>
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

    return this.providers.map(p => {
      // Logic to show filter models
      const enabledModels = Array.isArray(p.availableModels) 
          ? p.availableModels.filter(m => m.enabled) 
          : [];
      
      let modelsDisplay = '';
      if (enabledModels.length === 0) {
         // Fallback if no enabled models but 'model' field is set (legacy or simple)
         if (p.model) {
             modelsDisplay = `<span style="color: var(--text-muted);">${p.model}</span>`;
         } else {
             modelsDisplay = '<span style="color: var(--text-muted); font-style: italic;">No models enabled</span>';
         }
      } else {
         const showCount = 3;
         const firstFew = enabledModels.slice(0, showCount).map(m => m.name).join(', ');
         modelsDisplay = `<span style="color: var(--text-muted);">${firstFew}</span>`;
         if (enabledModels.length > showCount) {
            modelsDisplay += `<span class="more-models-btn" data-id="${p.id}" style="cursor: pointer; color: var(--accent-primary); margin-left: 4px;">more...</span>`;
         }
      }

      return `
      <div class="provider-item" data-id="${p.id}">
        <div class="provider-info">
          <div class="provider-name">
            ${p.name}
            ${p.isDefault ? '<span class="badge">Default</span>' : ''}
          </div>
          <div class="provider-meta">
            <span class="provider-models-list">${modelsDisplay}</span>
          </div>
        </div>
        <div class="provider-actions">
          <button class="btn-icon edit-btn" title="Edit">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
          </button>
          <button class="btn-icon download-btn" title="Manage Models">
             <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
               <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
               <polyline points="7 10 12 15 17 10"></polyline>
               <line x1="12" y1="15" x2="12" y2="3"></line>
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
    `;
    }).join('');
  }

  private setupEventListeners(): void {
    // Buttons (Delegation)
    if (!this.container) return;

    // Cleanup previous listeners
    this.abortController?.abort();
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    // Use event delegation for provider list actions
    this.container.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;

        // Handle specific non-button elements first
        if (target.classList.contains('more-models-btn')) {
            const id = target.getAttribute('data-id');
            if (id) this.openModelManager(id);
            return;
        }

        const btn = target.closest('button');
        if (!btn) return;

        // Provider Actions
        if (btn.classList.contains('edit-btn')) {
            const item = btn.closest('.provider-item');
            const id = item?.getAttribute('data-id');
            if (id) this.editProvider(id);
        } else if (btn.classList.contains('download-btn')) {
            const item = btn.closest('.provider-item');
            const id = item?.getAttribute('data-id');
            if (id) this.openModelManager(id);
        } else if (btn.classList.contains('delete-btn')) {
            const item = btn.closest('.provider-item');
            const id = item?.getAttribute('data-id');
            if (id) this.deleteProvider(id);
        } 
        
        // Static Buttons
        else if (btn.id === 'add-openai-btn') {
            this.showProviderForm();
        } else if (btn.id === 'add-copilot-btn') {
            this.startCopilotAuth();
        } else if (btn.id === 'close-form-btn' || btn.id === 'cancel-form-btn') {
            this.hideProviderForm();
        } else if (btn.id === 'save-form-btn') {
            this.saveProvider();
        } else if (btn.id === 'test-connection-btn') {
            e.preventDefault();
            this.testConnection();
        } else if (btn.id === 'manage-models-btn') {
             e.preventDefault();
             this.showModelModal();
        }
    }, { signal });

    // Custom Preset Selection Logic
    const customSelect = document.querySelector('.custom-select');
    const selectedDiv = customSelect?.querySelector('.select-selected');
    const itemsDiv = customSelect?.querySelector('.select-items');
    
    if (customSelect && selectedDiv && itemsDiv) {
      // Toggle dropdown
      selectedDiv.addEventListener('click', (e) => {
        e.stopPropagation();
        itemsDiv.classList.toggle('select-hide');
        selectedDiv.classList.toggle('select-arrow-active');
      }, { signal });

      // Handle item selection
      customSelect.querySelectorAll('.select-item').forEach(item => {
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          const target = e.currentTarget as HTMLElement;
          const value = target.dataset.value;
          const url = target.dataset.url;
          const label = target.dataset.label;
          const icon = target.querySelector('.provider-icon')?.innerHTML;

          if (value && icon && label) {
            // Update selected view
            const selectedContent = selectedDiv.querySelector('.selected-content');
            if (selectedContent) {
               selectedContent.innerHTML = `<span class="provider-icon">${icon}</span><span class="provider-label">${label}</span>`;
            }

            // Update hidden input
            (document.getElementById('provider-preset-value') as HTMLInputElement).value = value;

            // Fill form fields
            const nameInput = document.getElementById('provider-name') as HTMLInputElement;
            const endpointInput = document.getElementById('provider-endpoint') as HTMLInputElement;

            if (url) endpointInput.value = url;
            if (label && (!nameInput.value || OAI_API_PROVIDERS.some(p => p.label === nameInput.value))) {
              nameInput.value = label;
            }
          }

          // Close dropdown
          itemsDiv.classList.add('select-hide');
          selectedDiv.classList.remove('select-arrow-active');
        }, { signal });
      });

      // Close when clicking outside
      document.addEventListener('click', (e) => {
        if (!customSelect.contains(e.target as Node)) {
          itemsDiv.classList.add('select-hide');
          selectedDiv.classList.remove('select-arrow-active');
        }
      }, { signal });
    }

    document.getElementById('add-header-btn')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.addHeaderInput();
    }, { signal });

    // Model Management Modal Events
    document.getElementById('close-model-modal')?.addEventListener('click', () => this.hideModelModal(), { signal });
    document.getElementById('cancel-model-modal')?.addEventListener('click', () => this.hideModelModal(), { signal });
    document.getElementById('done-model-modal')?.addEventListener('click', () => this.handleModelModalDone(), { signal });
    document.getElementById('select-all-models-btn')?.addEventListener('click', () => this.toggleAllModels(true), { signal });
    document.getElementById('deselect-all-models-btn')?.addEventListener('click', () => this.toggleAllModels(false), { signal });

    // Toggle password visibility
    document.querySelector('.toggle-password')?.addEventListener('click', (e) => {
      e.preventDefault();
      const btn = e.currentTarget as HTMLElement;
      const input = document.getElementById('provider-api-key') as HTMLInputElement;
      
      if (input.type === 'password') {
        input.type = 'text';
        btn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
            <line x1="1" y1="1" x2="23" y2="23"></line>
          </svg>
        `;
      } else {
        input.type = 'password';
        btn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
            <circle cx="12" cy="12" r="3"></circle>
          </svg>
        `;
      }
    }, { signal });

    // Cancel Copilot auth
    document.getElementById('cancel-copilot-btn')?.addEventListener('click', () => {
      this.hideCopilotAuth();
    }, { signal });

    // Settings model picker
    document.getElementById('settings-model-trigger')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleSettingsModelPicker();
    }, { signal });

    // Close picker on outside click
    document.addEventListener('click', (e) => {
      const picker = document.getElementById('settings-model-picker');
      if (picker && !picker.contains(e.target as Node)) {
        this.closeSettingsModelPicker();
      }
    }, { signal });
  }

  // --- Helper Methods ---

  private addHeaderInput(key: string = '', value: string = ''): void {
    const container = document.getElementById('custom-headers-list');
    if (!container) return;
    
    const row = document.createElement('div');
    row.className = 'header-row';
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '5px';
    row.style.marginBottom = '5px';
    
    row.innerHTML = `
      <input type="text" placeholder="Key" class="header-key" value="${key}" style="flex: 1;">
      <input type="text" placeholder="Value" class="header-value" value="${value}" style="flex: 1;">
      <button class="btn-icon remove-header-btn">×</button>
    `;

    row.querySelector('.remove-header-btn')?.addEventListener('click', () => {
      row.remove();
    });

    container.appendChild(row);
  }

  private getCustomHeadersFromUI(): Record<string, string> {
     const headers: Record<string, string> = {};
     document.querySelectorAll('.header-row').forEach(row => {
       const key = (row.querySelector('.header-key') as HTMLInputElement).value.trim();
       const value = (row.querySelector('.header-value') as HTMLInputElement).value.trim();
       if (key) headers[key] = value;
     });
     return headers;
  }

  // --- Model Management ---

  private showModelModal(): void {
    const modal = document.getElementById('model-modal');
    if (modal) modal.classList.remove('hidden');
    this.renderModelListEditor();
  }

  private hideModelModal(): void {
    const modal = document.getElementById('model-modal');
    if (modal) modal.classList.add('hidden');
  }
  
  private async handleModelModalDone(): Promise<void> {
    const form = document.getElementById('provider-modal');
    // If provider-modal is hidden, we are in direct "List Edit Mode"
    const isMainFormHidden = form?.classList.contains('hidden');

    // Collect states from checkboxes
    const container = document.getElementById('model-list-editor');
    if (container) {
      container.querySelectorAll('.model-item-checkbox').forEach(box => {
         const cb = box as HTMLInputElement;
         const name = cb.dataset.model;
         if (name) {
             const model = this.availableModels.find(m => m.name === name);
             if (model) model.enabled = cb.checked;
         }
      });
    }

    if (isMainFormHidden && this.editingId) {
       const provider = this.providers.find(p => p.id === this.editingId);
       if (provider) {
          try {
             await ipcRenderer.invoke('ai:update-provider', {
               id: this.editingId,
               name: provider.name,
               endpoint: provider.endpoint,
               apiKeyEncrypted: provider.apiKeyEncrypted,
               model: provider.model, 
               availableModels: this.availableModels, // Save object array
               customHeaders: provider.customHeaders,
               autoCORSFix: provider.autoCORSFix
             });
             
             await this.loadProviders();
             this.renderUI(); 
          } catch(e) {
             console.error("Failed to save models", e);
             alert("Failed to save models: " + (e as Error).message);
          }
       }
       this.editingId = null; 
    } else {
       // Just update internal state (for the form save)
       this.updateModelList();
    }
    
    this.hideModelModal();
  }
  
  private async openModelManager(id: string): Promise<void> {
     const provider = this.providers.find(p => p.id === id);
     if (!provider) return;

     this.editingId = id;
     // Deep copy to allow editing before save
     this.availableModels = JSON.parse(JSON.stringify(provider.availableModels || []));
     this.showModelModal();
  }

  private toggleAllModels(select: boolean): void {
      this.availableModels.forEach(m => m.enabled = select);
      this.renderModelListEditor();
  }

  private renderModelListEditor(): void {
    const container = document.getElementById('model-list-editor');
    if (!container) return;
    
    container.innerHTML = '';
    
    if (this.availableModels.length === 0) {
      container.innerHTML = '<div style="color: #888; padding: 10px;">No models available. Please run "Test Connection" first.</div>';
    } else {
      this.availableModels.forEach(model => {
        const item = document.createElement('div');
        item.className = 'model-edit-item';
        item.style.display = 'flex';
        item.style.alignItems = 'center';
        item.style.padding = '8px 12px';
        item.style.borderBottom = '1px solid var(--border-color)';
        
        item.innerHTML = `
          <input type="checkbox" class="model-item-checkbox" data-model="${model.name}" ${model.enabled ? 'checked' : ''} id="model-cb-${model.name}">
          <label for="model-cb-${model.name}" style="margin-left: 10px; cursor: pointer; flex: 1;">${model.name}</label>
        `;
        container.appendChild(item);
      });
    }
  }

  // --- Forms & Actions ---

  private toggleSettingsModelPicker(): void {
    const list = document.getElementById('settings-model-list');
    const trigger = document.getElementById('settings-model-trigger');
    if (list?.classList.contains('hidden')) {
      list.classList.remove('hidden');
      trigger?.classList.add('open');
    } else {
      list?.classList.add('hidden');
      trigger?.classList.remove('open');
    }
  }

  private closeSettingsModelPicker(): void {
    document.getElementById('settings-model-list')?.classList.add('hidden');
    document.getElementById('settings-model-trigger')?.classList.remove('open');
  }

  private selectSettingsModel(model: string): void {
    (document.getElementById('provider-model') as HTMLInputElement).value = model;
    const label = document.getElementById('settings-model-label');
    if (label) label.textContent = model || 'Select model...';
    
    // Update selected state
    document.querySelectorAll('#settings-model-list .model-picker-item').forEach(item => {
      if ((item as HTMLElement).dataset.model === model) {
        item.classList.add('selected');
      } else {
        item.classList.remove('selected');
      }
    });
    
    this.closeSettingsModelPicker();
  }

  private async showProviderForm(provider?: AIProvider): Promise<void> {
    const form = document.getElementById('provider-modal');
    const title = document.getElementById('form-title');
    const presetGroup = document.getElementById('provider-preset-group');
    
    if (!form || !title) return;

    this.editingId = provider?.id || null;
    title.textContent = provider ? 'Edit Provider' : 'Add Provider';
    
    // Hide preset selector if editing
    if (presetGroup) presetGroup.style.display = provider ? 'none' : 'block';

    // Reset Custom Select
    (document.getElementById('provider-preset-value') as HTMLInputElement).value = 'custom';
    const selectedContent = document.querySelector('.selected-content');
    if (selectedContent) {
        selectedContent.innerHTML = `<span class="provider-icon">${ICONS.custom || ICONS.default}</span><span class="provider-label">Custom</span>`;
    }

    // Fill fields
    (document.getElementById('provider-name') as HTMLInputElement).value = provider?.name || '';
    (document.getElementById('provider-endpoint') as HTMLInputElement).value = provider?.endpoint || '';
    (document.getElementById('provider-auto-cors') as HTMLInputElement).checked = provider ? (provider.autoCORSFix ?? true) : true;

    // Headers
    const headersContainer = document.getElementById('custom-headers-list');
    if (headersContainer) headersContainer.innerHTML = '';
    if (provider?.customHeaders) {
      Object.entries(provider.customHeaders).forEach(([k, v]) => this.addHeaderInput(k, v));
    }

    // API Key logic (locked etc)
    const apiKeyInput = document.getElementById('provider-api-key') as HTMLInputElement;
    if (provider?.id) {
      const decryptedKey = await ipcRenderer.invoke('ai:get-api-key', provider.id);
      if (decryptedKey) {
        apiKeyInput.value = decryptedKey;
      } else if (provider.apiKeyEncrypted) {
        apiKeyInput.placeholder = '(encrypted - unlock to view)';
        apiKeyInput.value = '';
      } else {
        apiKeyInput.value = '';
        apiKeyInput.placeholder = 'sk-...';
      }
    } else {
      apiKeyInput.value = '';
      apiKeyInput.placeholder = 'sk-...';
    }

    // Reset password toggle
    apiKeyInput.type = 'password';

    // Load Available Models
    this.availableModels = provider?.availableModels ? JSON.parse(JSON.stringify(provider.availableModels)) : [];

    // Setup Model Picker (Filtered by enabled)
    this.updateModelList();
    
    // Set current model
    const modelValue = provider?.model || '';
    (document.getElementById('provider-model') as HTMLInputElement).value = modelValue;
    const modelLabel = document.getElementById('settings-model-label');
    if (modelLabel) {
      modelLabel.textContent = modelValue || 'Select model...';
    }
    // Highlight
    this.selectSettingsModel(modelValue);

    this.setTestStatus('', 'hidden');
    form.classList.remove('hidden');
  }

  private hideProviderForm(): void {
    document.getElementById('provider-modal')?.classList.add('hidden');
    this.editingId = null;
    this.availableModels = [];
  }

  private async testConnection(): Promise<void> {
    const endpoint = (document.getElementById('provider-endpoint') as HTMLInputElement).value.trim();
    const apiKey = (document.getElementById('provider-api-key') as HTMLInputElement).value;
    const autoCORSFix = (document.getElementById('provider-auto-cors') as HTMLInputElement).checked;
    const customHeaders = this.getCustomHeadersFromUI();
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
        apiKey: apiKey || undefined,
        customHeaders,
        autoCORSFix
      });

      if (result.success) {
        const fetchedModels: string[] = result.models || [];
        this.setTestStatus(`Success! Found ${fetchedModels.length} models.`, 'success');

        // Merge Logic
        const newAvailableModels: ModelConfig[] = [];
        
        // Preserve existing enabled states
        fetchedModels.forEach(modelName => {
           const existing = this.availableModels.find(m => m.name === modelName);
           if (existing) {
               newAvailableModels.push(existing);
           } else {
               newAvailableModels.push({ name: modelName, enabled: true });
           }
        });

        this.availableModels = newAvailableModels;
        this.updateModelList();
        
        // Auto-select logic if current invalid
        const modelInput = document.getElementById('provider-model') as HTMLInputElement;
        const currentModel = modelInput.value;
        const currentEnabled = this.availableModels.find(m => m.name === currentModel && m.enabled);
        
        if (!currentModel || !currentEnabled) {
             const defaultModel = this.availableModels.find(m => m.enabled && (m.name.includes('gpt-4') || m.name.includes('claude'))) 
                               || this.availableModels.find(m => m.enabled);
             if (defaultModel) {
                 this.selectSettingsModel(defaultModel.name);
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
    const list = document.getElementById('settings-model-list');
    if (!list) return;

    list.innerHTML = '';
    
    const enabledModels = this.availableModels.filter(m => m.enabled);

    if (enabledModels.length === 0) {
      const emptyItem = document.createElement('div');
      emptyItem.className = 'model-picker-item empty';
      emptyItem.textContent = 'No enabled models.';
      list.appendChild(emptyItem);
      return;
    }

    enabledModels.forEach(modelConf => {
      const item = document.createElement('div');
      item.className = 'model-picker-item';
      item.dataset.model = modelConf.name;
      item.textContent = modelConf.name;
      item.addEventListener('click', () => {
        this.selectSettingsModel(modelConf.name);
      });
      list.appendChild(item);
    });
    
    // Highlight current
    const currentModel = (document.getElementById('provider-model') as HTMLInputElement).value;
    if (currentModel) {
       this.selectSettingsModel(currentModel);
    }
  }

  private async saveProvider(): Promise<void> {
    try {
      const name = (document.getElementById('provider-name') as HTMLInputElement).value.trim();
      const endpoint = (document.getElementById('provider-endpoint') as HTMLInputElement).value.trim();
      const apiKey = (document.getElementById('provider-api-key') as HTMLInputElement).value;
      const model = (document.getElementById('provider-model') as HTMLInputElement).value.trim();
      const autoCORSFix = (document.getElementById('provider-auto-cors') as HTMLInputElement).checked;
      const customHeaders = this.getCustomHeadersFromUI();

      if (!name || !model) {
        alert('Name and Model are required');
        return;
      }

      const providerData = {
        name,
        endpoint,
        apiKey: apiKey || undefined,
        model,
        availableModels: this.availableModels, // Save object array
        customHeaders: Object.keys(customHeaders).length > 0 ? customHeaders : undefined,
        autoCORSFix
      };

      if (this.editingId) {
        await ipcRenderer.invoke('ai:update-provider', {
          id: this.editingId,
          ...providerData
        });
      } else {
        await ipcRenderer.invoke('ai:add-provider', {
          type: 'openai-compatible',
          ...providerData
        });
      }

      this.hideProviderForm();
      await this.loadProviders();
      this.renderUI();
    } catch (error) {
      console.error('Failed to save provider:', error);
      alert('Failed to save provider: ' + (error as Error).message);
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
        // ... Copilot auth logic ...
        // Keeping it simple as previous implementation
      const { userCode, verificationUri } = await ipcRenderer.invoke('copilot:start-auth');
      
      document.getElementById('device-code')!.textContent = userCode;
      const link = document.getElementById('verification-link') as HTMLAnchorElement;
      link.href = verificationUri;

      const pollResult = await ipcRenderer.invoke('copilot:poll-auth');

      if (pollResult.success) {
        alert('Successfully authenticated with GitHub Copilot!');
        this.hideCopilotAuth();
        await this.loadProviders();
        this.renderUI();
      } else {
        alert('Authentication failed: ' + pollResult.error);
        this.hideCopilotAuth();
      }

    } catch (error) {
      console.error('Copilot auth error:', error);
      alert('Authentication error: ' + (error as Error).message);
      this.hideCopilotAuth();
    }
  }
  
  private hideCopilotAuth(): void {
    document.getElementById('copilot-auth')?.classList.add('hidden');
  }
}
