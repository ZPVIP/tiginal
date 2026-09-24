import { R2T2_FRAME_SAMPLES, R2T2_SAMPLE_RATE } from './r2t2';

export function floatToPcm16(samples: Float32Array): Int16Array {
  const output = new Int16Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    output[index] = sample < 0
      ? Math.round(sample * 0x8000)
      : Math.round(sample * 0x7fff);
  }
  return output;
}

export class StreamingLinearResampler {
  private readonly step: number;
  private carry = new Float32Array(0);
  private position = 0;
  private inputSamples = 0;
  private outputSamples = 0;

  constructor(
    private readonly sourceRate: number,
    private readonly targetRate: number = R2T2_SAMPLE_RATE,
  ) {
    if (!Number.isFinite(sourceRate) || sourceRate <= 0) {
      throw new Error('Source sample rate must be positive');
    }
    if (!Number.isFinite(targetRate) || targetRate <= 0) {
      throw new Error('Target sample rate must be positive');
    }
    this.step = sourceRate / targetRate;
  }

  push(input: Float32Array): Float32Array {
    if (input.length === 0) return new Float32Array(0);
    this.inputSamples += input.length;
    if (this.sourceRate === this.targetRate) {
      this.outputSamples += input.length;
      return input.slice();
    }

    const merged = new Float32Array(this.carry.length + input.length);
    merged.set(this.carry);
    merged.set(input, this.carry.length);

    const values: number[] = [];
    while (this.position + 1 < merged.length) {
      const left = Math.floor(this.position);
      const fraction = this.position - left;
      values.push(merged[left] + ((merged[left + 1] - merged[left]) * fraction));
      this.position += this.step;
    }

    const consumed = Math.min(Math.floor(this.position), Math.max(0, merged.length - 1));
    this.carry = merged.slice(consumed);
    this.position -= consumed;
    const output = Float32Array.from(values);
    this.outputSamples += output.length;
    return output;
  }

  flush(): Float32Array {
    const expectedSamples = Math.round((this.inputSamples * this.targetRate) / this.sourceRate);
    const remainingSamples = Math.max(0, expectedSamples - this.outputSamples);
    const values: number[] = [];
    while (values.length < remainingSamples && this.carry.length > 0) {
      const left = Math.min(Math.floor(this.position), this.carry.length - 1);
      const right = Math.min(left + 1, this.carry.length - 1);
      const fraction = this.position - left;
      values.push(this.carry[left] + ((this.carry[right] - this.carry[left]) * fraction));
      this.position += this.step;
    }
    this.carry = new Float32Array(0);
    this.position = 0;
    this.inputSamples = 0;
    this.outputSamples = 0;
    return Float32Array.from(values);
  }
}

export class StreamingPcm16Framer {
  private readonly resampler: StreamingLinearResampler;
  private pending = new Int16Array(0);

  constructor(
    sourceRate: number,
    private readonly frameSamples: number = R2T2_FRAME_SAMPLES,
  ) {
    if (!Number.isInteger(frameSamples) || frameSamples <= 0) {
      throw new Error('Frame sample count must be a positive integer');
    }
    this.resampler = new StreamingLinearResampler(sourceRate);
  }

  push(input: Float32Array): Int16Array[] {
    return this.append(floatToPcm16(this.resampler.push(input)));
  }

  flush(): Int16Array[] {
    const remaining = floatToPcm16(this.resampler.flush());
    const frames = this.append(remaining);
    if (this.pending.length === 0) return frames;
    frames.push(this.pending);
    this.pending = new Int16Array(0);
    return frames;
  }

  private append(samples: Int16Array): Int16Array[] {
    const merged = new Int16Array(this.pending.length + samples.length);
    merged.set(this.pending);
    merged.set(samples, this.pending.length);

    const frames: Int16Array[] = [];
    let offset = 0;
    while (offset + this.frameSamples <= merged.length) {
      frames.push(merged.slice(offset, offset + this.frameSamples));
      offset += this.frameSamples;
    }
    this.pending = merged.slice(offset);
    return frames;
  }
}
