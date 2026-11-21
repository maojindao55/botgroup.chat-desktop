/**
 * 实时语音对话（qwen-audio-3.0-realtime-plus）的一轮：按下开始录音推流，松手提交，
 * 伙伴的回复音频边收边播，同时回调孩子说的话和回复文字。连接和 Key 在 Rust 侧（speech_dialog.rs）。
 */
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { loadSpeechConfig, type SpeechConfig } from '@/config/speechConfig';
import { PcmChunker, pcm16Base64ToFloat32 } from './pcm';
import { mapStartError, micSupported, startMicCapture } from './qwenSpeech';
import type { SpeechErrorCode } from './types';

const INPUT_RATE = 16000;
const OUTPUT_RATE = 24000;
/** 第一段音频稍微延后一点开始播，避免网络抖动造成断续 */
const START_LEAD_S = 0.08;

export interface DialogHistoryTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface DialogTurnOptions {
  instructions: string;
  voice: string;
  history: DialogHistoryTurn[];
  rate?: number;
  /** 不播放回复音频（孩子关了自动朗读） */
  muted?: boolean;
}

export interface DialogTurnHandlers {
  /** 孩子说的话（识别失败时为空） */
  onUserText: (text: string) => void;
  /** 回复文字，目前为止的全文 */
  onReplyText: (text: string) => void;
  /** 回复生成完毕（音频可能还在播） */
  onReplyDone: (text: string) => void;
  /** 出错，这一轮结束；connected 为 false 表示连不上服务（Key、网络、地址） */
  onError: (code: SpeechErrorCode, message: string, connected: boolean) => void;
  /** 音频播完或被打断 */
  onPlaybackEnd?: () => void;
}

interface DialogPayload {
  type: 'ready' | 'userText' | 'replyText' | 'audio' | 'replyDone' | 'error' | 'end';
  text?: string;
  pcm?: string;
  status?: string;
  message?: string;
}

/** 按时间排队播放流式 PCM，片段之间无缝衔接 */
export class PcmStreamPlayer {
  private context: AudioContext | null = null;
  private nextTime = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private ended = false;
  private onDrained: (() => void) | null = null;

  constructor(private readonly sampleRate = OUTPUT_RATE) {}

  private ensureContext(): AudioContext {
    if (!this.context) {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      this.context = new Ctx() as AudioContext;
    }
    return this.context;
  }

  push(samples: Float32Array): void {
    if (!samples.length) return;
    const context = this.ensureContext();
    const buffer = context.createBuffer(1, samples.length, this.sampleRate);
    buffer.getChannelData(0).set(samples);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    const startAt = Math.max(this.nextTime, context.currentTime + START_LEAD_S);
    source.start(startAt);
    this.nextTime = startAt + buffer.duration;
    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);
      this.checkDrained();
    };
  }

  get playing(): boolean {
    return this.sources.size > 0;
  }

  /** 不会再有新音频了；全部播完后回调 */
  finish(onDrained: () => void): void {
    this.ended = true;
    this.onDrained = onDrained;
    this.checkDrained();
  }

  private checkDrained(): void {
    if (this.ended && this.sources.size === 0 && this.onDrained) {
      const done = this.onDrained;
      this.onDrained = null;
      done();
    }
  }

  stop(): void {
    for (const source of this.sources) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // already stopped
      }
    }
    this.sources.clear();
    this.ended = true;
    this.checkDrained();
    const context = this.context;
    this.context = null;
    void context?.close().catch(() => undefined);
  }
}

export const dialogSupported = () =>
  micSupported() && typeof (window.AudioContext || (window as any).webkitAudioContext) === 'function';

type TurnState = 'recording' | 'waiting' | 'replying' | 'done';

export class RealtimeDialogTurn {
  private readonly sessionId = `dlg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  private state: TurnState = 'recording';
  private unlisten: UnlistenFn | null = null;
  private stopMic: (() => void) | null = null;
  private released = false;
  private sendChain: Promise<unknown> = Promise.resolve();
  private readonly chunker = new PcmChunker(INPUT_RATE / 10);
  private readonly player = new PcmStreamPlayer();
  private userTextSent = false;
  private connected = false;
  private silenced: boolean;
  private replyText = '';

  constructor(
    private readonly options: DialogTurnOptions,
    private readonly handlers: DialogTurnHandlers,
    private readonly config: SpeechConfig = loadSpeechConfig(),
  ) {
    this.silenced = Boolean(options.muted);
  }

  private get finished(): boolean {
    return this.state === 'done';
  }

  get speaking(): boolean {
    return this.player.playing;
  }

  async start(): Promise<void> {
    this.unlisten = await listen<DialogPayload>(`dialog://${this.sessionId}`, (event) => this.onEvent(event.payload));
    if (this.finished) return this.cleanup();
    try {
      await invoke('speech_dialog_start', {
        args: {
          sessionId: this.sessionId,
          model: this.config.dialog.model,
          endpoint: this.config.dialog.endpoint,
          voice: this.options.voice,
          instructions: this.options.instructions,
          speechRate: this.options.rate,
          history: this.options.history,
          providerId: this.config.providerId || undefined,
        },
      });
    } catch (error) {
      return this.fail('network', String(error));
    }
    if (this.finished) return void invoke('speech_dialog_close', { sessionId: this.sessionId }).catch(() => undefined);
    try {
      const stop = await startMicCapture((pcm) => {
        if (this.released) return;
        for (const chunk of this.chunker.push(pcm)) this.send(chunk);
      });
      if (this.released || this.finished) stop();
      else this.stopMic = stop;
    } catch (error) {
      this.fail(mapStartError(error), String(error));
    }
  }

  /** 松手：发出剩余音频，请模型回复 */
  release(): void {
    if (this.released || this.finished) return;
    this.released = true;
    this.stopMic?.();
    this.stopMic = null;
    const rest = this.chunker.flush();
    if (rest) this.send(rest);
    this.state = 'waiting';
    this.sendChain = this.sendChain.then(() => invoke('speech_dialog_commit', { sessionId: this.sessionId })).catch(() => undefined);
  }

  /** 停止播放回复音频，文字照常回调 */
  stopSpeaking(): void {
    this.silenced = true;
    this.player.stop();
  }

  /** 中途打断（孩子又按下说话、离开页面） */
  close(): void {
    if (this.finished) return;
    this.state = 'done';
    void invoke('speech_dialog_close', { sessionId: this.sessionId }).catch(() => undefined);
    this.player.stop();
    this.cleanup();
  }

  private send(bytes: Uint8Array): void {
    this.sendChain = this.sendChain
      .then(() => invoke('speech_dialog_send', bytes, { headers: { 'x-dialog-session': this.sessionId } }))
      .catch(() => undefined);
  }

  private onEvent(payload: DialogPayload): void {
    if (this.finished) return;
    switch (payload.type) {
      case 'ready':
        this.connected = true;
        break;
      case 'userText':
        this.userTextSent = true;
        this.handlers.onUserText(payload.text || '');
        break;
      case 'replyText':
        this.state = 'replying';
        this.replyText = payload.text || '';
        this.handlers.onReplyText(this.replyText);
        break;
      case 'audio':
        this.state = 'replying';
        if (payload.pcm && !this.silenced) this.player.push(pcm16Base64ToFloat32(payload.pcm));
        break;
      case 'replyDone':
        if (!this.userTextSent) {
          this.userTextSent = true;
          this.handlers.onUserText('');
        }
        this.replyText = payload.text || this.replyText;
        this.handlers.onReplyDone(this.replyText);
        this.state = 'done';
        this.cleanup();
        this.player.finish(() => this.handlers.onPlaybackEnd?.());
        break;
      case 'error':
        this.fail(this.connected && !this.userTextSent ? 'no-speech' : 'network', payload.message || '');
        break;
      case 'end':
        if (!this.finished) this.fail('network', '实时对话意外结束');
        break;
    }
  }

  private fail(code: SpeechErrorCode, message: string): void {
    if (this.finished) return;
    this.state = 'done';
    console.warn('[speech] realtime dialog failed', message);
    this.player.stop();
    this.cleanup();
    this.handlers.onError(code, message, this.connected);
  }

  private cleanup(): void {
    this.stopMic?.();
    this.stopMic = null;
    this.unlisten?.();
    this.unlisten = null;
  }
}
