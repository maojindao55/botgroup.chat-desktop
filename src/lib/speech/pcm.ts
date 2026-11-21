/** 麦克风采样（通常 44.1k/48k float32）转成识别服务要的 16k 单声道 16-bit PCM */
export function downsampleToPcm16(input: Float32Array, inputRate: number, outputRate = 16000): Int16Array {
  if (!input.length) return new Int16Array(0);
  const ratio = inputRate / outputRate;
  if (ratio < 1) throw new Error('input sample rate must be >= output sample rate');
  const length = Math.floor(input.length / ratio);
  const out = new Int16Array(length);
  for (let i = 0; i < length; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.max(start + 1, Math.floor((i + 1) * ratio)));
    let sum = 0;
    for (let j = start; j < end; j += 1) sum += input[j];
    const sample = Math.max(-1, Math.min(1, sum / (end - start)));
    out[i] = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
  }
  return out;
}

/** 攒够一定字节数再发送，避免每个音频回调都调用一次 IPC */
export class PcmChunker {
  private parts: Int16Array[] = [];
  private size = 0;

  constructor(private readonly chunkSamples = 1600) {}

  push(samples: Int16Array): Uint8Array[] {
    if (samples.length) {
      this.parts.push(samples);
      this.size += samples.length;
    }
    const ready: Uint8Array[] = [];
    while (this.size >= this.chunkSamples) ready.push(this.take(this.chunkSamples));
    return ready;
  }

  flush(): Uint8Array | null {
    return this.size ? this.take(this.size) : null;
  }

  private take(count: number): Uint8Array {
    const out = new Int16Array(count);
    let filled = 0;
    while (filled < count) {
      const head = this.parts[0];
      const n = Math.min(head.length, count - filled);
      out.set(head.subarray(0, n), filled);
      filled += n;
      if (n === head.length) this.parts.shift();
      else this.parts[0] = head.subarray(n);
    }
    this.size -= count;
    return new Uint8Array(out.buffer);
  }
}
