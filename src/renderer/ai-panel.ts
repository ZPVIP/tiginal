import { ipcRenderer } from 'electron';

interface ModelConfig {
  name: string;
  enabled: boolean;
}

interface AIProvider {
  id: string;
  name: string;
  type: 'openai-compatible' | 'copilot';
  model: string;
  availableModels?: ModelConfig[] | string[]; // Allow both for safety, but we expect ModelConfig[]
  isDefault: boolean;
}

interface Conversation {
  id: string;
  title: string | null;
  providerId: string | null;
  createdAt: number;
  updatedAt: number;
}

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: number;
}

interface ModelOption {
  providerId: string;
  providerName: string;
  model: string;
  isDefault: boolean;
}

export class AIPanel {
  private isOpen = false;
  private toggleBtn: HTMLElement | null = null;
  private panel: HTMLElement | null = null;
  private messagesContainer: HTMLElement | null = null;
  private inputField: HTMLTextAreaElement | null = null;
  private sendBtn: HTMLElement | null = null;
  
  // New buttons
  private newChatBtn: HTMLElement | null = null;
  private incognitoBtn: HTMLElement | null = null;

  // New model picker elements
  private modelPickerTrigger: HTMLElement | null = null;
  private modelPickerList: HTMLElement | null = null;
  private modelPickerLabel: HTMLElement | null = null;

  private currentConversation: Conversation | null = null;
  private providers: AIProvider[] = [];
  private isLoading = false;
  private isPickerOpen = false;
  private isTransientMode = false;

  // Selected model
  private selectedProviderId: string | null = null;
  private selectedModel: string | null = null;

  constructor() {
    this.toggleBtn = document.getElementById('ai-toggle');
    this.panel = document.getElementById('ai-panel');
    this.messagesContainer = document.getElementById('ai-messages');
    this.inputField = document.getElementById('ai-input') as HTMLTextAreaElement;
    this.sendBtn = document.getElementById('ai-send');
    
    // Header buttons
    this.newChatBtn = document.getElementById('ai-new-chat-btn');
    this.incognitoBtn = document.getElementById('ai-incognito-btn');

    // Model picker elements
    this.modelPickerTrigger = document.getElementById('model-picker-trigger');
    this.modelPickerList = document.getElementById('model-picker-list');
    this.modelPickerLabel = document.querySelector('.model-picker-label');

    this.setupEventListeners();
    this.setupAutoResize();
    this.loadProviders();
  }

  private async loadProviders(): Promise<void> {
    try {
      this.providers = await ipcRenderer.invoke('ai:get-providers');
      this.updateModelPicker();
    } catch (error) {
      console.error('Failed to load providers:', error);
    }
  }

  private getAllModelOptions(): ModelOption[] {
    const options: ModelOption[] = [];
    
    this.providers.forEach(provider => {
      // Add default model
      options.push({
        providerId: provider.id,
        providerName: provider.name,
        model: provider.model,
        isDefault: provider.isDefault,
      });
      
      // Add available models (excluding default)
      if (provider.availableModels) {
        provider.availableModels.forEach(m => {
          let modelName: string;
          let isEnabled = true;

          if (typeof m === 'string') {
             modelName = m;
          } else {
             modelName = m.name;
             isEnabled = m.enabled;
          }

          if (isEnabled && modelName !== provider.model) {
            options.push({
              providerId: provider.id,
              providerName: provider.name,
              model: modelName,
              isDefault: false,
            });
          }
        });
      }
    });
    
    return options;
  }

  private updateModelPicker(): void {
    if (!this.modelPickerList) return;

    const options = this.getAllModelOptions();
    this.modelPickerList.innerHTML = '';

    if (options.length === 0) {
      const emptyItem = document.createElement('div');
      emptyItem.className = 'model-picker-item empty';
      emptyItem.textContent = 'No models available';
      this.modelPickerList.appendChild(emptyItem);
      return;
    }

    options.forEach(opt => {
      const item = document.createElement('div');
      item.className = 'model-picker-item';
      item.dataset.providerId = opt.providerId;
      item.dataset.model = opt.model;
      item.textContent = `${opt.providerName} / ${opt.model}`;
      
      item.addEventListener('click', () => {
        this.selectModel(opt.providerId, opt.model, `${opt.providerName} / ${opt.model}`);
      });
      
      this.modelPickerList?.appendChild(item);
    });

    // Auto-select:
    // 1. Try to restore from localStorage
    // 2. Fallback to default model
    // 3. Fallback to first available model
    
    if (!this.selectedProviderId) {
      const savedProviderId = localStorage.getItem('ai_selected_provider_id');
      const savedModel = localStorage.getItem('ai_selected_model');
      
      let targetOpt: ModelOption | undefined;
      
      if (savedProviderId && savedModel) {
        targetOpt = options.find(o => o.providerId === savedProviderId && o.model === savedModel);
      }
      
      if (!targetOpt) {
        targetOpt = options.find(o => o.isDefault);
      }
      
      if (!targetOpt && options.length > 0) {
        targetOpt = options[0];
      }

      if (targetOpt) {
        this.selectModel(targetOpt.providerId, targetOpt.model, `${targetOpt.providerName} / ${targetOpt.model}`);
      }
    }
  }

  private selectModel(providerId: string, model: string, label: string): void {
    this.selectedProviderId = providerId;
    this.selectedModel = model;
    
    // Persist selection
    localStorage.setItem('ai_selected_provider_id', providerId);
    localStorage.setItem('ai_selected_model', model);
    
    if (this.modelPickerLabel) {
      this.modelPickerLabel.textContent = label;
    }
    
    // Update selected state in list
    this.modelPickerList?.querySelectorAll('.model-picker-item').forEach(item => {
      const el = item as HTMLElement;
      if (el.dataset.providerId === providerId && el.dataset.model === model) {
        el.classList.add('selected');
      } else {
        el.classList.remove('selected');
      }
    });
    
    this.closePicker();
  }

  private togglePicker(): void {
    if (this.isPickerOpen) {
      this.closePicker();
    } else {
      this.openPicker();
    }
  }

  private openPicker(): void {
    this.modelPickerList?.classList.remove('hidden');
    this.modelPickerTrigger?.classList.add('open');
    this.isPickerOpen = true;
    
    // Close on outside click
    setTimeout(() => {
      document.addEventListener('click', this.handleOutsideClick);
    }, 0);
  }

  private closePicker(): void {
    this.modelPickerList?.classList.add('hidden');
    this.modelPickerTrigger?.classList.remove('open');
    this.isPickerOpen = false;
    document.removeEventListener('click', this.handleOutsideClick);
  }

  private handleOutsideClick = (e: MouseEvent): void => {
    const picker = document.getElementById('model-picker');
    if (picker && !picker.contains(e.target as Node)) {
      this.closePicker();
    }
  };

  private setupResizeHandle(): void {
    const resizeHandle = document.getElementById('ai-panel-resize');
    if (!resizeHandle || !this.panel) return;

    let startX = 0;
    let startWidth = 0;

    const onMouseMove = (e: MouseEvent) => {
      if (!this.panel) return;
      const delta = startX - e.clientX;
      const maxWidth = window.innerWidth * 0.8;
      const newWidth = Math.min(maxWidth, Math.max(200, startWidth + delta));
      this.panel.style.width = `${newWidth}px`;
    };

    const onMouseUp = () => {
      resizeHandle.classList.remove('dragging');
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    resizeHandle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      startX = e.clientX;
      startWidth = this.panel?.offsetWidth || 320;
      resizeHandle.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }

  private setupAutoResize(): void {
    this.inputField?.addEventListener('input', () => {
      if (this.inputField) {
        this.inputField.style.height = 'auto';
        this.inputField.style.height = Math.min(this.inputField.scrollHeight, 80) + 'px';
      }
    });
  }

  toggle(): void {
    this.isOpen = !this.isOpen;
    
    if (this.isOpen) {
      // Remove collapsed class first
      this.panel?.classList.remove('collapsed');
      // Restore saved width or use default
      if (this.panel) {
        const savedWidth = this.panel.dataset.savedWidth;
        this.panel.style.width = savedWidth || '';
      }
      setTimeout(() => this.inputField?.focus(), 100);
      // Reload providers in case they changed
      this.loadProviders();
    } else {
      // Save current width before collapsing
      if (this.panel) {
        this.panel.dataset.savedWidth = this.panel.style.width || '';
        this.panel.style.width = ''; // Clear inline style so CSS can take effect
      }
      this.panel?.classList.add('collapsed');
    }
    
    this.toggleBtn?.classList.toggle('active', this.isOpen);
  }

  open(): void {
    if (!this.isOpen) {
      this.toggle();
    }
  }

  close(): void {
    if (this.isOpen) {
      this.toggle();
    }
  }

  private setupEventListeners(): void {
    // Toggle button
    this.toggleBtn?.addEventListener('click', () => this.toggle());

    // Send button
    this.sendBtn?.addEventListener('click', () => this.sendMessage());

    // Enter to send, Shift+Enter for newline
    this.inputField?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    // History button
    document.getElementById('ai-history-btn')?.addEventListener('click', () => {
      this.showHistory();
    });

    // New Chat button
    this.newChatBtn?.addEventListener('click', () => {
      this.startNewChat();
    });

    // Incognito button
    this.incognitoBtn?.addEventListener('click', () => {
      this.startIncognitoChat();
    });

    // Keyboard shortcut Cmd+Shift+A
    document.addEventListener('keydown', (e) => {
      if (e.key === 'a' && e.metaKey && e.shiftKey) {
        e.preventDefault();
        this.toggle();
      }
    });
    
    // Model picker trigger
    this.modelPickerTrigger?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.togglePicker();
    });

    // Resize handle
    this.setupResizeHandle();
  }

  // ...

  private startNewChat(): void {
    this.currentConversation = null;
    this.isTransientMode = false;
    if (this.messagesContainer) {
      this.messagesContainer.innerHTML = '';
    }
    this.appendMessage('system', 'Started a new conversation.');
    this.inputField?.focus();
    
    // Update UI to show standard mode
    this.panel?.classList.remove('incognito-mode');
  }

  private startIncognitoChat(): void {
    this.currentConversation = null;
    this.isTransientMode = true;
    if (this.messagesContainer) {
      this.messagesContainer.innerHTML = '';
    }
    this.appendMessage('system', 'Started an incognito conversation. Messages will not be saved.');
    this.inputField?.focus();
    
    // Update UI to show incognito mode (optional, but good UX)
    this.panel?.classList.add('incognito-mode');
  }

  private async ensureConversation(): Promise<Conversation | null> {
    if (this.currentConversation) {
      return this.currentConversation;
    }

    if (!this.selectedProviderId) {
      this.appendMessage('system', 'Please select a model first.');
      return null;
    }

    try {
      this.currentConversation = await ipcRenderer.invoke(
        'chat:create-conversation',
        this.selectedProviderId,
        this.isTransientMode // Pass transient flag
      );
      return this.currentConversation;
    } catch (error) {
      console.error('Failed to create conversation:', error);
      this.appendMessage('system', 'Failed to start conversation.');
      return null;
    }
  }

  private async sendMessage(): Promise<void> {
    const message = this.inputField?.value.trim();
    if (!message || this.isLoading) return;

    if (!this.selectedProviderId || !this.selectedModel) {
      this.appendMessage('system', 'Please select a model first.');
      return;
    }

    const conversation = await this.ensureConversation();
    if (!conversation) return;

    // Clear input
    if (this.inputField) {
      this.inputField.value = '';
      this.inputField.style.height = 'auto';
    }

    // Show user message
    this.appendMessage('user', message);

    // Show loading
    this.isLoading = true;
    const loadingId = this.appendMessage('assistant', '...');
    this.toggleLoading(true);

    try {
      const result = await ipcRenderer.invoke(
        'chat:send-message',
        conversation.id,
        this.selectedProviderId,
        message,
        this.selectedModel
      );

      // Remove loading message
      this.removeMessage(loadingId);

      if (result.error) {
        this.appendMessage('system', `Error: ${result.error}`);
      } else {
        this.appendMessage('assistant', result.response);
      }
    } catch (error) {
      this.removeMessage(loadingId);
      this.appendMessage('system', `Error: ${(error as Error).message}`);
    } finally {
      this.isLoading = false;
      this.toggleLoading(false);
    }
  }

  private appendMessage(role: 'user' | 'assistant' | 'system', content: string): string {
    const id = `msg-${Date.now()}`;
    const messageEl = document.createElement('div');
    messageEl.id = id;
    messageEl.className = `ai-message ${role}`;
    
    const contentEl = document.createElement('div');
    contentEl.className = 'ai-message-content';
    contentEl.textContent = content;
    
    messageEl.appendChild(contentEl);
    this.messagesContainer?.appendChild(messageEl);
    
    // Scroll to bottom
    if (this.messagesContainer) {
      this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
    }

    return id;
  }

  private removeMessage(id: string): void {
    document.getElementById(id)?.remove();
  }

  private toggleLoading(loading: boolean): void {
    if (this.sendBtn) {
      (this.sendBtn as HTMLButtonElement).disabled = loading;
    }
  }

  private async showHistory(): Promise<void> {
    try {
      const conversations = await ipcRenderer.invoke('chat:get-conversations', 20);
      
      if (!this.messagesContainer) return;
      
      // Show history view
      this.messagesContainer.innerHTML = `
        <div class="ai-history">
          <h3>Recent Conversations</h3>
          ${conversations.length === 0 ? '<p class="empty">No conversations yet</p>' : ''}
          ${conversations.map((c: Conversation) => `
            <div class="history-item" data-id="${c.id}">
              <span class="history-title">${c.title || 'Untitled'}</span>
              <span class="history-date">${new Date(c.updatedAt).toLocaleDateString()}</span>
            </div>
          `).join('')}
          <button class="btn btn-secondary" id="history-back">Back</button>
        </div>
      `;
      
      // Add click handlers
      this.messagesContainer.querySelectorAll('.history-item').forEach(item => {
        item.addEventListener('click', async () => {
          const id = item.getAttribute('data-id');
          if (id) {
            await this.loadConversation(id);
          }
        });
      });
      
      document.getElementById('history-back')?.addEventListener('click', () => {
        if (this.messagesContainer) {
          this.messagesContainer.innerHTML = '';
        }
        this.currentConversation = null;
      });
    } catch (error) {
      console.error('Failed to load history:', error);
    }
  }

  private async loadConversation(id: string): Promise<void> {
    try {
      const messages = await ipcRenderer.invoke('chat:get-messages', id);
      
      if (!this.messagesContainer) return;
      this.messagesContainer.innerHTML = '';
      
      messages.forEach((msg: Message) => {
        this.appendMessage(msg.role, msg.content);
      });
      
      // Set current conversation
      const conversations = await ipcRenderer.invoke('chat:get-conversations', 100);
      this.currentConversation = conversations.find((c: Conversation) => c.id === id) || null;
    } catch (error) {
      console.error('Failed to load conversation:', error);
    }
  }
}
