import * as fs from 'fs';
import * as path from 'path';
import { suppressRepetitiveLoops } from '../../shared/audio/textUtils';

export interface ChunkTimelineEntry {
  timestampMs: number;
  text: string;
}

export class ChunkTimelineWriter {
  private readonly entries: ChunkTimelineEntry[] = [];
  private isFinalized = false;

  constructor(
    public readonly filePath: string,
    public readonly chunkSizeMs: number,
  ) {}

  recordDelta(audioMs: number, deltaText: string): void {
    if (this.isFinalized) return;
    const cleanText = suppressRepetitiveLoops(deltaText.replace(/[\r\n\t]+/g, ' ')).trim();
    if (!cleanText) return;

    // Suppress endless repetition flood: if the last 2 entries have the exact same text, skip recording more
    const len = this.entries.length;
    if (len >= 2 && this.entries[len - 1].text === cleanText && this.entries[len - 2].text === cleanText) {
      return;
    }

    // Round to nearest chunk boundary or keep exact audio ms
    this.entries.push({
      timestampMs: Math.max(0, Math.round(audioMs)),
      text: cleanText,
    });
  }

  getEntries(): readonly ChunkTimelineEntry[] {
    return this.entries;
  }

  getTextContent(): string {
    return this.entries.map(entry => `${entry.timestampMs}\t${entry.text}`).join('\n') + (this.entries.length > 0 ? '\n' : '');
  }

  finalize(): void {
    if (this.isFinalized) return;
    this.isFinalized = true;
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.filePath, this.getTextContent(), 'utf-8');
    } catch (err) {
      console.error(`Failed to write chunk timeline to ${this.filePath}:`, err);
    }
  }
}
