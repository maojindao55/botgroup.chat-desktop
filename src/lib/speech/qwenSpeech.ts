/**
 * 千问云端语音。连接和 API Key 都在 Rust 侧（speech.rs / speech_http.rs），这里只负责
 * 采集麦克风 PCM、播放合成的音频。云端失败时朗读会退回到系统朗读。
 * - Token Plan：合成走 HTTP；识别在松手后把整段录音编码成 WAV 一次提交
 * - 百炼实时：合成和识别都走 WebSocket，说话时就有中间结果
 */
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { loadSpeechConfig, splitForSynthesis, voiceForSpeaker, type SpeechConfig } from '@/config/speechConfig';
import { downsampleToPcm16, encodeWav, PcmChunker } from './pcm';
import type { RecognitionHandlers, SpeakOptions, SpeechErrorCode, SpeechRecognizer, SpeechSynthesizer } from './types';

const isTauri = () => typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__ !== undefined;
const ASR_SAMPLE_RATE = 16000;
const FINAL_WAIT_MS = 8000;
/** Token Plan 识别单次最长 5 分钟，按住说话用不了这么久 */
const MAX_RECORD_SAMPLES = ASR_SAMPLE_RATE * 120;

const micSupported = () =>
  isTauri()
  && typeof navigator !== 'undefined'
  && Boolean(navigator.mediaDevices?.getUserMedia)
  && typeof (window.AudioContext || (window as any).webkitAudioContext) === 'function';

/** 合成一段文本，返回音频字节（mp3） */
export async function synthesizeCloud(text: string, voice: string, config: SpeechConfig = loadSpeechConfig()): Promise<ArrayBuffer> {
  const providerId = config.providerId || undefined;
  if (config.tts.engine === 'qwen') {
    return invoke<ArrayBuffer>('speech_tts_synthesize', {
      args: { text, model: config.tts.model, voice, rate: config.tts.rate, format: 'mp3', sampleRate: 24000, endpoint: config.endpoint, providerId },
    });
  }
  return invoke<ArrayBuffer>('speech_http_tts', {
    args: {
      text,
      model: config.tts.model,
      voice,
      rate: config.tts.rate,
      sampleRate: 24000,
      instruction: config.tts.instruction || undefined,
      baseUrl: config.httpBase,
      providerId,
    },
  });
}

const MAX_PREFETCHED = 24;

export class CloudSynthesizer implements SpeechSynthesizer {
  private audio: HTMLAudioElement | null = null;
  private generation = 0;
  private stopCurrent: (() => void) | null = null;
  private warned = false;
  private prefetched = new Map<string, Promise<ArrayBuffer>>();

  constructor(private readonly fallback?: SpeechSynthesizer) {}

  get supported(): boolean {
    return isTauri() && typeof Audio !== 'undefined';
  }

  private fetch(sentence: string, voice: string, config: SpeechConfig): Promise<ArrayBuffer> {
    const key = `${config.tts.engine}\n${config.tts.model}\n${voice}\n${sentence}`;
    const cached = this.prefetched.get(key);
    if (cached) {
      this.prefetched.delete(key);
      return cached;
    }
    return synthesizeCloud(sentence, voice, config);
  }

  prefetch(text: string, options: SpeakOptions = {}): void {
    const content = (text || '').trim();
    if (!content || !this.supported) return;
    const config = loadSpeechConfig();
    const voice = voiceForSpeaker(config, options.speakerId, options.gameId);
    for (const sentence of splitForSynthesis(content)) {
      const key = `${config.tts.engine}\n${config.tts.model}\n${voice}\n${sentence}`;
      if (this.prefetched.has(key)) continue;
      if (this.prefetched.size >= MAX_PREFETCHED) this.prefetched.delete(this.prefetched.keys().next().value!);
      const pending = synthesizeCloud(sentence, voice, config);
      // 失败留给 speak 处理（退回系统朗读），这里避免未处理的 rejection
      pending.catch(() => undefined);
      this.prefetched.set(key, pending);
    }
  }

  async speak(text: string, options: SpeakOptions = {}): Promise<void> {
    const content = (text || '').trim();
    if (!content) return;
    this.stopPlayback();
    const gen = ++this.generation;
    const config = loadSpeechConfig();
    const voice = voiceForSpeaker(config, options.speakerId, options.gameId);
    const sentences = splitForSynthesis(content);
    try {
      // 播放当前句时预取下一句
      let next = this.fetch(sentences[0], voice, config);
      for (let i = 0; i < sentences.length; i += 1) {
        const bytes = await next;
        if (gen !== this.generation) return;
        if (i + 1 < sentences.length) next = this.fetch(sentences[i + 1], voice, config);
        await this.play(bytes, gen);
        if (gen !== this.generation) return;
      }
    } catch (error) {
      if (gen !== this.generation) return;
      if (!this.warned) {
        console.warn('[speech] cloud TTS failed, falling back to system voice', error);
        this.warned = true;
      }
      if (this.fallback?.supported) await this.fallback.speak(content, options);
    }
  }

  private play(bytes: ArrayBuffer, gen: number): Promise<void> {
    return new Promise<void>((resolve) => {
      if (gen !== this.generation) return resolve();
      const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }));
      const audio = new Audio(url);
      this.audio = audio;
      const done = () => {
        URL.revokeObjectURL(url);
        if (this.audio === audio) this.audio = null;
        if (this.stopCurrent === done) this.stopCurrent = null;
        resolve();
      };
      this.stopCurrent = done;
      audio.onended = done;
      audio.onerror = done;
      audio.play().catch(done);
    });
  }

  private stopPlayback(): void {
    this.generation += 1;
    this.audio?.pause();
    this.stopCurrent?.();
    this.fallback?.cancel();
  }

  cancel(): void {
    this.prefetched.clear();
    this.stopPlayback();
  }
}

function mapStartError(error: unknown): SpeechErrorCode {
  const name = (error as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'not-allowed';
  if (name === 'NotFoundError') return 'unsupported';
  return 'network';
}

/** 打开麦克风，把采样转成 16k PCM 回调出去；返回关闭函数 */
async function startMicCapture(onPcm: (pcm: Int16Array) => void): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  const Ctx = window.AudioContext || (window as any).webkitAudioContext;
  const context = new Ctx() as AudioContext;
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(4096, 1, 1);
  const inputRate = context.sampleRate;
  processor.onaudioprocess = (event) => {
    onPcm(downsampleToPcm16(event.inputBuffer.getChannelData(0), inputRate, ASR_SAMPLE_RATE));
  };
  source.connect(processor);
  processor.connect(context.destination);
  return () => {
    processor.onaudioprocess = null;
    processor.disconnect();
    source.disconnect();
    stream.getTracks().forEach((track) => track.stop());
    void context.close().catch(() => undefined);
  };
}

/** Token Plan：按住时录音，松手后整段识别 */
export class TokenPlanRecognizer implements SpeechRecognizer {
  private session: { stop: () => void; abort: () => void } | null = null;

  get supported(): boolean {
    return micSupported();
  }

  start(handlers: RecognitionHandlers): void {
    this.abort();
    const config = loadSpeechConfig();
    const chunks: Int16Array[] = [];
    let samples = 0;
    let stopCapture: (() => void) | null = null;
    let state: 'opening' | 'recording' | 'stopping' | 'done' = 'opening';

    const transcribe = async () => {
      stopCapture?.();
      stopCapture = null;
      const pcm = new Int16Array(samples);
      let offset = 0;
      for (const chunk of chunks) {
        pcm.set(chunk, offset);
        offset += chunk.length;
      }
      try {
        const text = samples
          ? await invoke<string>('speech_http_asr', encodeWav(pcm, ASR_SAMPLE_RATE), {
              headers: {
                'x-speech-model': config.asr.model,
                'x-speech-base': config.httpBase,
                'x-speech-provider': config.providerId,
              },
            })
          : '';
        if (state === 'done') return;
        state = 'done';
        handlers.onFinal((text || '').trim());
      } catch (error) {
        if (state === 'done') return;
        state = 'done';
        console.warn('[speech] Token Plan ASR failed', error);
        handlers.onError?.('network');
      } finally {
        if (this.session === control) this.session = null;
      }
    };

    const control = {
      stop: () => {
        if (state === 'recording') {
          state = 'stopping';
          void transcribe();
        } else if (state === 'opening') {
          state = 'stopping';
        }
      },
      abort: () => {
        state = 'done';
        stopCapture?.();
        stopCapture = null;
        if (this.session === control) this.session = null;
      },
    };
    this.session = control;

    startMicCapture((pcm) => {
      if (state !== 'recording' || samples >= MAX_RECORD_SAMPLES) return;
      chunks.push(pcm);
      samples += pcm.length;
    }).then(
      (stop) => {
        stopCapture = stop;
        if (state === 'done') return control.abort();
        if (state === 'stopping') return void transcribe();
        state = 'recording';
      },
      (error) => {
        if (state === 'done') return;
        state = 'done';
        console.warn('[speech] microphone unavailable', error);
        handlers.onError?.(mapStartError(error));
        if (this.session === control) this.session = null;
      },
    );
  }

  stop(): void {
    this.session?.stop();
  }

  abort(): void {
    this.session?.abort();
  }
}

interface AsrPayload {
  type: 'partial' | 'final' | 'error' | 'end';
  text?: string;
  message?: string;
}

/** 百炼实时识别：边说边推流，返回中间结果 */
export class RealtimeRecognizer implements SpeechRecognizer {
  private session: { stop: () => void; abort: () => void } | null = null;

  get supported(): boolean {
    return micSupported();
  }

  start(handlers: RecognitionHandlers): void {
    this.abort();
    const config = loadSpeechConfig();
    const sessionId = `asr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const chunker = new PcmChunker(ASR_SAMPLE_RATE / 10);

    let unlisten: UnlistenFn | null = null;
    let stopMic: (() => void) | null = null;
    let started = false;
    let stopping = false;
    let finished = false;
    let hadError = false;
    let lastText = '';
    let pending: Uint8Array[] = [];
    let sendChain: Promise<unknown> = Promise.resolve();
    let finalTimer: ReturnType<typeof setTimeout> | undefined;

    const send = (bytes: Uint8Array) => {
      if (!started) {
        pending.push(bytes);
        return;
      }
      sendChain = sendChain
        .then(() => invoke('speech_asr_send', bytes, { headers: { 'x-asr-session': sessionId } }))
        .catch(() => undefined);
    };

    const stopCapture = () => {
      stopMic?.();
      stopMic = null;
    };

    const cleanup = () => {
      clearTimeout(finalTimer);
      stopCapture();
      unlisten?.();
      unlisten = null;
      if (this.session === control) this.session = null;
    };

    const finish = (text: string) => {
      if (finished) return;
      finished = true;
      cleanup();
      if (!hadError || text) handlers.onFinal(text.trim());
    };

    const fail = (code: SpeechErrorCode) => {
      if (finished) return;
      hadError = true;
      handlers.onError?.(code);
    };

    const sendStop = () => {
      const tail = chunker.flush();
      if (tail) send(tail);
      sendChain = sendChain.then(() => invoke('speech_asr_stop', { sessionId })).catch(() => undefined);
      finalTimer = setTimeout(() => finish(lastText), FINAL_WAIT_MS);
    };

    const control = {
      stop: () => {
        if (stopping || finished) return;
        stopping = true;
        stopCapture();
        if (started) sendStop();
        else finalTimer = setTimeout(() => finish(lastText), FINAL_WAIT_MS);
      },
      abort: () => {
        if (finished) return;
        finished = true;
        if (started) void invoke('speech_asr_abort', { sessionId }).catch(() => undefined);
        cleanup();
      },
    };
    this.session = control;

    const run = async () => {
      unlisten = await listen<AsrPayload>(`asr://${sessionId}`, ({ payload }) => {
        if (payload.type === 'partial') {
          lastText = payload.text || '';
          if (!finished) handlers.onPartial?.(lastText);
        } else if (payload.type === 'final') {
          lastText = payload.text || lastText;
        } else if (payload.type === 'error') {
          console.warn('[speech] cloud ASR error', payload.message);
          fail('network');
        } else if (payload.type === 'end') {
          finish(lastText);
        }
      });
      if (finished) return cleanup();

      const capture = startMicCapture((pcm) => chunker.push(pcm).forEach(send)).then((stop) => {
        if (finished || stopping) stop();
        else stopMic = stop;
      });

      const connect = invoke('speech_asr_start', {
        args: {
          sessionId,
          model: config.asr.model,
          sampleRate: ASR_SAMPLE_RATE,
          languageHints: ['zh'],
          endpoint: config.endpoint,
          providerId: config.providerId || undefined,
        },
      }).then(() => {
        if (finished) {
          void invoke('speech_asr_abort', { sessionId }).catch(() => undefined);
          return;
        }
        started = true;
        const queued = pending;
        pending = [];
        queued.forEach(send);
        if (stopping) sendStop();
      });
      connect.catch(() => undefined);

      try {
        await capture;
      } catch (error) {
        console.warn('[speech] microphone unavailable', error);
        fail(mapStartError(error));
        control.abort();
        return;
      }
      try {
        await connect;
      } catch (error) {
        console.warn('[speech] cloud ASR start failed', error);
        fail('network');
        finished = true;
        cleanup();
      }
    };
    void run();
  }

  stop(): void {
    this.session?.stop();
  }

  abort(): void {
    this.session?.abort();
  }
}
