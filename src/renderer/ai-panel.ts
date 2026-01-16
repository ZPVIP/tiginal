import { ipcRenderer } from 'electron';

export class AIPanel {
  private isOpen = false;
  private toggleBtn: HTMLElement | null = null;
  private panel: HTMLElement | null = null;
  private messagesContainer: HTMLElement | null = null;
  private inputField: HTMLTextAreaElement | null = null;
  private sendBtn: HTMLElement | null = null;
  private modelSelect: HTMLSelectElement | null = null;

  constructor() {
    this.toggleBtn = document.getElementById('ai-toggle');
    this.panel = document.getElementById('ai-panel');
    this.messagesContainer = document.getElementById('ai-messages');
    this.inputField = document.getElementById('ai-input') as HTMLTextAreaElement;
    this.sendBtn = document.getElementById('ai-send');
    this.modelSelect = document.getElementById('ai-model-select') as HTMLSelectElement;

    this.setupEventListeners();
    this.setupAutoResize();
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

  private async sendMessage(): Promise<void> {
    const message = this.inputField?.value.trim();
    if (!message) return;

    // Clear input
    if (this.inputField) {
      this.inputField.value = '';
      this.inputField.style.height = 'auto';
    }

    // Add user message to UI
    this.addMessage('user', message);

    // TODO: Send to AI service and get response
    // For now, just show a placeholder
    this.addMessage('assistant', 'AI functionality will be implemented in Phase 5.');
  }

  addMessage(role: 'user' | 'assistant', content: string): void {
    const messageEl = document.createElement('div');
    messageEl.className = `ai-message ai-message-${role}`;
    messageEl.innerHTML = `
      <div class="ai-message-content">${this.escapeHtml(content)}</div>
    `;
    this.messagesContainer?.appendChild(messageEl);
    this.messagesContainer?.scrollTo(0, this.messagesContainer.scrollHeight);
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  private showHistory(): void {
    // TODO: Implement conversation history
    console.log('Show history - to be implemented');
  }

  setModels(models: { id: string; name: string }[]): void {
    if (!this.modelSelect) return;

    this.modelSelect.innerHTML = '<option value="">Select model...</option>';
    models.forEach(model => {
      const option = document.createElement('option');
      option.value = model.id;
      option.textContent = model.name;
      this.modelSelect?.appendChild(option);
    });
  }
}
