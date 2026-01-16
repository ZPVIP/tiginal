import { createWorker } from 'tesseract.js';

export class OCRService {
  private worker: Tesseract.Worker | null = null;
  private isProcessing = false;

  async initialize() {
    // Tesseract worker initialization can be lazy
  }

  async recognize(image: string | File): Promise<string> {
    if (this.isProcessing) {
      throw new Error('OCR is already processing');
    }

    this.isProcessing = true;
    try {
      this.worker = await createWorker('eng');
      const ret = await this.worker.recognize(image);
      await this.worker.terminate();
      return ret.data.text;
    } catch (error) {
      console.error('OCR Error:', error);
      return '';
    } finally {
      this.isProcessing = false;
      this.worker = null;
    }
  }

  static async extractTextFromImage(imageUrl: string): Promise<string> {
    const service = new OCRService();
    return await service.recognize(imageUrl);
  }
}
