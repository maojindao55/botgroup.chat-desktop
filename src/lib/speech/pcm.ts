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

/** Base64 编码的 16-bit 小端 PCM 转成 Web Audio 用的 float32 */
export function pcm16Base64ToFloat32(base64: string): Float32Array {
  const binary = atob(base64);
  const count = Math.floor(binary.length / 2);
  const out = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    let value = binary.charCodeAt(i * 2) | (binary.charCodeAt(i * 2 + 1) << 8);
    if (value >= 0x8000) value -= 0x10000;
    out[i] = value / 0x8000;
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

/** 16-bit 单声道 PCM 加上 44 字节 WAV 头 */
export function encodeWav(samples: Int16Array, sampleRate = 16000): Uint8Array {
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i += 1) view.setInt16(44 + i * 2, samples[i], true);
  return new Uint8Array(buffer);
}
