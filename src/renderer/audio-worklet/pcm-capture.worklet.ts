import { StreamingPcm16Framer } from '../../shared/audio/pcm';

declare const sampleRate: number;

declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  abstract process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}

declare function registerProcessor(
  name: string,
  processorCtor: new () => AudioWorkletProcessor,
): void;

type CaptureCommand = { kind: 'flush' };

class PcmCaptureProcessor extends AudioWorkletProcessor {
  private readonly framer = new StreamingPcm16Framer(sampleRate);
  private readonly monoBuffer = new Float32Array(128);

  constructor() {
    super();
    this.port.onmessage = event => this.handleCommand(event.data);
  }

  process(inputs: Float32Array[][]): boolean {
    const channels = inputs[0];
    if (!channels || channels.length === 0 || channels[0].length === 0) return true;

    const sampleCount = channels[0].length;
    const mono = this.monoBuffer.length === sampleCount
      ? this.monoBuffer
      : new Float32Array(sampleCount);
    let peak = 0;
    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
      let value = 0;
      for (const channel of channels) value += channel[sampleIndex] ?? 0;
      value /= channels.length;
      mono[sampleIndex] = value;
      peak = Math.max(peak, Math.abs(value));
    }

    for (const frame of this.framer.push(mono)) this.postFrame(frame);
    this.port.postMessage({ kind: 'peak', value: peak });
    return true;
  }

  private handleCommand(value: unknown): void {
    if (!this.isCaptureCommand(value) || value.kind !== 'flush') return;
    for (const frame of this.framer.flush()) this.postFrame(frame);
    this.port.postMessage({ kind: 'flushed' });
  }

  private isCaptureCommand(value: unknown): value is CaptureCommand {
    return typeof value === 'object'
      && value !== null
      && Reflect.get(value, 'kind') === 'flush';
  }

  private postFrame(frame: Int16Array): void {
    const buffer = frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength);
    this.port.postMessage({ kind: 'frame', frame: buffer }, [buffer]);
  }
}

registerProcessor('tiginal-pcm-capture', PcmCaptureProcessor);
