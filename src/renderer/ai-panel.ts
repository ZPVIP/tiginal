import { ipcRenderer } from 'electron';

interface AIProvider {
  id: string;
  name: string;
  type: 'openai-compatible' | 'copilot';
  model: string;
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

export class AIPanel {
  private isOpen = false;
  private toggleBtn: HTMLElement | null = null;
  private panel: HTMLElement | null = null;
  private messagesContainer: HTMLElement | null = null;
  private inputField: HTMLTextAreaElement | null = null;
  private sendBtn: HTMLElement | null = null;
  private modelSelect: HTMLSelectElement | null = null;

  private currentConversation: Conversation | null = null;
  private providers: AIProvider[] = [];
  private isLoading = false;

  constructor() {
    this.toggleBtn = document.getElementById('ai-toggle');
    this.panel = document.getElementById('ai-panel');
    this.messagesContainer = document.getElementById('ai-messages');
    this.inputField = document.getElementById('ai-input') as HTMLTextAreaElement;
    this.sendBtn = document.getElementById('ai-send');
    this.modelSelect = document.getElementById('ai-model-select') as HTMLSelectElement;

    this.setupEventListeners();
    this.setupAutoResize();
    this.loadProviders();
  }

  private async loadProviders(): Promise<void> {
    try {
      this.providers = await ipcRenderer.invoke('ai:get-providers');
      this.updateModelSelect();
    } catch (error) {
      console.error('Failed to load providers:', error);
    }
  }

  private updateModelSelect(): void {
    if (!this.modelSelect) return;

    this.modelSelect.innerHTML = '<option value="">Select model...</option>';
    this.providers.forEach(provider => {
      const option = document.createElement('option');
      option.value = provider.id;
      option.textContent = `${provider.name} (${provider.model})`;
      if (provider.isDefault) {
        option.selected = true;
      }
      this.modelSelect?.appendChild(option);
    });
  }

  private setupEventListeners(): void {
    // Toggle button
    this.toggleBtn?.addEventListener('click', () => this.toggle());

    // Send button
    this.sendBtn?.addEventListener('click', () => this.sendMessage());

    // Enter to send (Cmd+Enter)
    this.inputField?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    // History button
    document.getElementById('ai-history-btn')?.addEventListener('click', () => {
      this.showHistory();
    });

    // Keyboard shortcut Cmd+Shift+A
    document.addEventListener('keydown', (e) => {
      if (e.key === 'a' && e.metaKey && e.shiftKey) {
        e.preventDefault();
        this.toggle();
      }
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
    this.panel?.classList.toggle('collapsed', !this.isOpen);
    this.toggleBtn?.classList.toggle('active', this.isOpen);

    if (this.isOpen) {
      setTimeout(() => this.inputField?.focus(), 100);
      // Reload providers in case they changed
      this.loadProviders();
    }
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

  private async ensureConversation(): Promise<Conversation> {
    if (!this.currentConversation) {
      const providerId = this.modelSelect?.value || undefined;
      this.currentConversation = await ipcRenderer.invoke('chat:create-conversation', providerId);
    }
    return this.currentConversation!;
  }

  private async sendMessage(): Promise<void> {
    const message = this.inputField?.value.trim();
    const providerId = this.modelSelect?.value;

    if (!message) return;
    if (!providerId) {
      alert('Please select an AI model first');
      return;
    }
    if (this.isLoading) return;

    // Clear input
    if (this.inputField) {
      this.inputField.value = '';
      this.inputField.style.height = 'auto';
    }

    // Ensure we have a conversation
    const conversation = await this.ensureConversation();

    // Add user message to UI
    this.addMessage('user', message);

    // Show loading
    this.isLoading = true;
    this.setLoading(true);

    try {
      // Send to AI
      const result = await ipcRenderer.invoke(
        'chat:send-message',
        conversation.id,
        providerId,
        message
      );

      if (result.error) {
        this.addMessage('assistant', `Error: ${result.error}`);
      } else {
        this.addMessage('assistant', result.response);
      }
    } catch (error) {
      this.addMessage('assistant', `Error: ${(error as Error).message}`);
    } finally {
      this.isLoading = false;
      this.setLoading(false);
    }
  }

  private setLoading(loading: boolean): void {
    if (this.sendBtn) {
      this.sendBtn.classList.toggle('loading', loading);
      (this.sendBtn as HTMLButtonElement).disabled = loading;
    }
  }

  addMessage(role: 'user' | 'assistant', content: string): void {
    const messageEl = document.createElement('div');
    messageEl.className = `ai-message ai-message-${role}`;
    messageEl.innerHTML = `
      <div class="ai-message-content">${this.formatMessage(content)}</div>
    `;
    this.messagesContainer?.appendChild(messageEl);
    this.messagesContainer?.scrollTo(0, this.messagesContainer.scrollHeight);
  }

  private formatMessage(text: string): string {
    // Basic markdown-like formatting
    return this.escapeHtml(text)
      .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\n/g, '<br>');
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  private async showHistory(): Promise<void> {
    try {
      const conversations = await ipcRenderer.invoke('chat:get-conversations');
      this.renderHistoryModal(conversations);
    } catch (error) {
      console.error('Failed to load history:', error);
    }
  }

  private renderHistoryModal(conversations: Conversation[]): void {
    // Remove existing modal
    document.getElementById('history-modal')?.remove();

    const modal = document.createElement('div');
    modal.id = 'history-modal';
    modal.className = 'history-modal';
    modal.innerHTML = `
      <div class="history-content">
        <div class="history-header">
          <h3>Conversation History</h3>
          <button class="btn-icon" id="close-history">×</button>
        </div>
        <div class="history-list">
          ${conversations.length === 0 
            ? '<div class="empty-state">No conversations yet</div>'
            : conversations.map(c => `
              <div class="history-item" data-id="${c.id}">
                <div class="history-title">${c.title || 'Untitled'}</div>
                <div class="history-date">${new Date(c.updatedAt).toLocaleDateString()}</div>
              </div>
            `).join('')}
        </div>
        <div class="history-actions">
          <button class="btn btn-primary" id="new-conversation-btn">New Conversation</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Close button
    document.getElementById('close-history')?.addEventListener('click', () => {
      modal.remove();
    });

    // Click outside to close
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });

    // New conversation
    document.getElementById('new-conversation-btn')?.addEventListener('click', () => {
      this.startNewConversation();
      modal.remove();
    });

    // Click on history item
    document.querySelectorAll('.history-item').forEach(item => {
      item.addEventListener('click', async () => {
        const id = item.getAttribute('data-id');
        if (id) {
          await this.loadConversation(id);
          modal.remove();
        }
      });
    });
  }

  private startNewConversation(): void {
    this.currentConversation = null;
    if (this.messagesContainer) {
      this.messagesContainer.innerHTML = '';
    }
  }

  private async loadConversation(id: string): Promise<void> {
    try {
      const messages = await ipcRenderer.invoke('chat:get-messages', id);
      
      // Get conversation details
      const conversations = await ipcRenderer.invoke('chat:get-conversations');
      this.currentConversation = conversations.find((c: Conversation) => c.id === id) || null;

      // Clear and render messages
      if (this.messagesContainer) {
        this.messagesContainer.innerHTML = '';
      }
      
      messages.forEach((msg: Message) => {
        if (msg.role !== 'system') {
          this.addMessage(msg.role, msg.content);
        }
      });
    } catch (error) {
      console.error('Failed to load conversation:', error);
    }
  }
}
