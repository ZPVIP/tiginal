import { ipcRenderer } from 'electron';

type SendCallback = (command: string, execute: boolean) => void;

export class CommandInput {
  private textarea: HTMLTextAreaElement | null = null;
  private sendBtn: HTMLElement | null = null;
  private pasteBtn: HTMLElement | null = null;
  private onSend: SendCallback | null = null;

  constructor() {
    this.textarea = document.getElementById('command-input') as HTMLTextAreaElement;
    this.sendBtn = document.getElementById('cmd-send');
    this.pasteBtn = document.getElementById('cmd-paste');

    this.setupEventListeners();
    this.setupAutoResize();
  }

  private setupEventListeners(): void {
    // Send button - send command + execute
    this.sendBtn?.addEventListener('click', () => this.send(true));

    // Paste button - paste only, don't execute
    this.pasteBtn?.addEventListener('click', () => this.send(false));

    // Enter to send, Shift+Enter for multi-line
    this.textarea?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.send(true);
      }
    });
  }

  private setupAutoResize(): void {
    this.textarea?.addEventListener('input', () => {
      if (this.textarea) {
        this.textarea.style.height = 'auto';
        const newHeight = Math.min(Math.max(this.textarea.scrollHeight, 32), 120);
        this.textarea.style.height = newHeight + 'px';
      }
    });
  }

  private send(execute: boolean): void {
    const command = this.textarea?.value;
    if (!command) return;

    // Clear input
    if (this.textarea) {
      this.textarea.value = '';
      this.textarea.style.height = 'auto';
    }

    // Notify callback
    if (this.onSend) {
      this.onSend(command, execute);
    }
  }

  onSendCommand(callback: SendCallback): void {
    this.onSend = callback;
  }

  focus(): void {
    this.textarea?.focus();
  }

  setValue(value: string): void {
    if (this.textarea) {
      this.textarea.value = value;
      this.textarea.dispatchEvent(new Event('input'));
    }
  }
}
