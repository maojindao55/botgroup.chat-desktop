/**
 * Web Speech API 实现。Linux WebKitGTK 等 webview 通常不支持识别，
 * 此时 supported 为 false，页面应隐藏麦克风按钮。
 * 本模块只有类型导入，方便 node 测试注入假的 window。
 */
import type {
  RecognitionHandlers,
  SpeakOptions,
  SpeechErrorCode,
  SpeechRecognizer,
  SpeechSynthesizer,
} from './types';

type SpeechWindow = {
  SpeechRecognition?: any;
  webkitSpeechRecognition?: any;
  speechSynthesis?: any;
  SpeechSynthesisUtterance?: any;
};

function currentWindow(): SpeechWindow {
  return (typeof window !== 'undefined' ? window : {}) as SpeechWindow;
}

function mapRecognitionError(error: unknown): SpeechErrorCode {
  switch (error) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'not-allowed';
    case 'no-speech':
      return 'no-speech';
    case 'network':
      return 'network';
    case 'aborted':
      return 'aborted';
    default:
      return 'unknown';
  }
}

export class WebSpeechRecognizer implements SpeechRecognizer {
  private readonly Ctor: any;
  private recognition: any = null;

  constructor(win: SpeechWindow = currentWindow()) {
    this.Ctor = win.SpeechRecognition || win.webkitSpeechRecognition || null;
  }

  get supported(): boolean {
    return Boolean(this.Ctor);
  }

  start(handlers: RecognitionHandlers, options: { lang?: string } = {}): void {
    if (!this.Ctor) {
      handlers.onError?.('unsupported');
      return;
    }
    this.abort();
    const recognition = new this.Ctor();
    recognition.lang = options.lang || 'zh-CN';
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.maxAlternatives = 1;

    let finalText = '';
    let latestText = '';
    let aborted = false;

    recognition.onresult = (event: any) => {
      let finals = '';
      let interim = '';
      for (let i = 0; i < event.results.length; i += 1) {
        const result = event.results[i];
        const transcript = result?.[0]?.transcript || '';
        if (result.isFinal) finals += transcript;
        else interim += transcript;
      }
      finalText = finals;
      latestText = finals + interim;
      handlers.onPartial?.(latestText);
    };
    recognition.onerror = (event: any) => {
      const code = mapRecognitionError(event?.error);
      if (code === 'aborted') aborted = true;
      else handlers.onError?.(code);
    };
    recognition.onend = () => {
      if (this.recognition === recognition) this.recognition = null;
      if (!aborted) handlers.onFinal((finalText || latestText).trim());
    };
    (recognition as any).__markAborted = () => {
      aborted = true;
    };

    this.recognition = recognition;
    try {
      recognition.start();
    } catch {
      this.recognition = null;
      handlers.onError?.('unknown');
    }
  }

  stop(): void {
    this.recognition?.stop();
  }

  abort(): void {
    const recognition = this.recognition;
    if (!recognition) return;
    recognition.__markAborted?.();
    this.recognition = null;
    recognition.abort();
  }
}

/** 优先选与语言完全匹配、且是本地语音的声音 */
export function pickVoice<T extends { lang: string; localService?: boolean }>(voices: T[], lang: string): T | undefined {
  const target = lang.toLowerCase();
  const prefix = target.split('-')[0];
  const exact = voices.filter((v) => v.lang?.toLowerCase().replace('_', '-') === target);
  const loose = voices.filter((v) => v.lang?.toLowerCase().startsWith(prefix));
  const pool = exact.length ? exact : loose;
  return pool.find((v) => v.localService) || pool[0];
}

export class WebSpeechSynthesizer implements SpeechSynthesizer {
  private readonly synth: any;
  private readonly Utterance: any;
  private pendingResolve: (() => void) | null = null;

  constructor(win: SpeechWindow = currentWindow()) {
    this.synth = win.speechSynthesis || null;
    this.Utterance = win.SpeechSynthesisUtterance || null;
  }

  get supported(): boolean {
    return Boolean(this.synth && this.Utterance);
  }

  speak(text: string, options: SpeakOptions = {}): Promise<void> {
    const content = (text || '').trim();
    if (!this.supported || !content) return Promise.resolve();
    this.cancel();
    const lang = options.lang || 'zh-CN';
    const utterance = new this.Utterance(content);
    utterance.lang = lang;
    utterance.rate = options.rate ?? 0.95;
    utterance.pitch = options.pitch ?? 1.1;
    const voice = pickVoice(this.synth.getVoices?.() || [], lang);
    if (voice) utterance.voice = voice;

    return new Promise<void>((resolve) => {
      const done = () => {
        if (this.pendingResolve === done) this.pendingResolve = null;
        resolve();
      };
      this.pendingResolve = done;
      utterance.onend = done;
      utterance.onerror = done;
      this.synth.speak(utterance);
    });
  }

  cancel(): void {
    if (!this.synth) return;
    const resolve = this.pendingResolve;
    this.pendingResolve = null;
    this.synth.cancel();
    resolve?.();
  }
}
