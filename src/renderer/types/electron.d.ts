import type { AudioRendererApi } from '../../shared/audio/types';
import type { ModelsRendererApi } from '../../shared/models/types';

export {};

declare global {
  interface Window {
    electron?: {
      invoke(channel: string, ...args: any[]): Promise<any>;
      send(channel: string, ...args: any[]): void;
      on(channel: string, func: (...args: any[]) => void): () => void;
      audio: AudioRendererApi;
      models: ModelsRendererApi;
    };
  }
}
