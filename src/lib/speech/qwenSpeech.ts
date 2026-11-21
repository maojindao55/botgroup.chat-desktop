/**
 * 千问云端语音：WebSocket 连接和 API Key 都在 Rust 侧（speech.rs），这里只负责
 * 采集麦克风 PCM、播放合成的音频。云端失败时朗读会退回到系统朗读。
 */
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { loadSpeechConfig, splitForSynthesis, voiceForSpeaker, type SpeechConfig } from '@/config/speechConfig';
import { downsampleToPcm16, PcmChunker } from './pcm';
import type { RecognitionHandlers, SpeakOptions, SpeechErrorCode, SpeechRecognizer, SpeechSynthesizer } from './types';

const isTauri = () => typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__ !== undefined;
const ASR_SAMPLE_RATE = 16000;
const FINAL_WAIT_MS = 8000;

function auth(config: SpeechConfig) {
  return { endpoint: config.endpoint, providerId: config.providerId || undefined };
}

/** 合成一段文本，返回音频字节（mp3） */
export async function synthesizeWithQwen(text: string, voice: string, config: SpeechConfig = loadSpeechConfig()): Promise<ArrayBuffer> {
  return invoke<ArrayBuffer>('speech_tts_synthesize', {
    args: {
      text,
      model: config.tts.model,
      voice,
      rate: config.tts.rate,
      format: 'mp3',
      sampleRate: 24000,
      ...auth(config),
    },
  });
}

export class QwenSynthesizer implements SpeechSynthesizer {
  private audio: HTMLAudioElement | null = null;
  private generation = 0;
  private stopCurrent: (() => void) | null = null;
  private warned = false;

  constructor(private readonly fallback?: SpeechSynthesizer) {}

  get supported(): boolean {
    return isTauri() && typeof Audio !== 'undefined';
  }

  async speak(text: string, options: SpeakOptions = {}): Promise<void> {
    const content = (text || '').trim();
    if (!content) return;
    this.cancel();
    const gen = ++this.generation;
    const config = loadSpeechConfig();
    const voice = voiceForSpeaker(config, options.speakerId);
    const sentences = splitForSynthesis(content);
    try {
      // 播放当前句时预取下一句
      let next = synthesizeWithQwen(sentences[0], voice, config);
      for (let i = 0; i < sentences.length; i += 1) {
        const bytes = await next;
        if (gen !== this.generation) return;
        if (i + 1 < sentences.length) next = synthesizeWithQwen(sentences[i + 1], voice, config);
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

  cancel(): void {
    this.generation += 1;
    this.audio?.pause();
    this.stopCurrent?.();
    this.fallback?.cancel();
  }
}

function mapStartError(error: unknown): SpeechErrorCode {
  const name = (error as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'not-allowed';
  if (name === 'NotFoundError') return 'unsupported';
  return 'network';
}

interface AsrPayload {
  type: 'partial' | 'final' | 'error' | 'end';
  text?: string;
  message?: string;
}

export class QwenRecognizer implements SpeechRecognizer {
  private session: { stop: () => void; abort: () => void } | null = null;

  get supported(): boolean {
    return (
      isTauri()
      && typeof navigator !== 'undefined'
      && Boolean(navigator.mediaDevices?.getUserMedia)
      && typeof (window.AudioContext || (window as any).webkitAudioContext) === 'function'
    );
  }

  start(handlers: RecognitionHandlers): void {
    this.abort();
    const config = loadSpeechConfig();
    const sessionId = `asr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const chunker = new PcmChunker(ASR_SAMPLE_RATE / 10);

    let unlisten: UnlistenFn | null = null;
    let media: MediaStream | null = null;
    let context: AudioContext | null = null;
    let processor: ScriptProcessorNode | null = null;
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
      processor?.disconnect();
      if (processor) processor.onaudioprocess = null;
      media?.getTracks().forEach((track) => track.stop());
      void context?.close().catch(() => undefined);
      processor = null;
      media = null;
      context = null;
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

      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      const capture = navigator.mediaDevices
        .getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
        .then((stream) => {
          if (finished || stopping) {
            stream.getTracks().forEach((track) => track.stop());
            return;
          }
          media = stream;
          context = new Ctx() as AudioContext;
          const source = context.createMediaStreamSource(stream);
          processor = context.createScriptProcessor(4096, 1, 1);
          const inputRate = context.sampleRate;
          processor.onaudioprocess = (event) => {
            const pcm = downsampleToPcm16(event.inputBuffer.getChannelData(0), inputRate, ASR_SAMPLE_RATE);
            chunker.push(pcm).forEach(send);
          };
          source.connect(processor);
          processor.connect(context.destination);
        });

      const connect = invoke('speech_asr_start', {
        args: { sessionId, model: config.asr.model, sampleRate: ASR_SAMPLE_RATE, languageHints: ['zh'], ...auth(config) },
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
