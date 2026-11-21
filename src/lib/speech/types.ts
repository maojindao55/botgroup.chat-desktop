/**
 * 语音能力的抽象接口。桌面端先用 Web Speech API 实现，
 * 第二期可以换成云端 ASR/TTS 或移动端原生插件，页面只依赖这里的接口。
 */

export type SpeechErrorCode = 'not-allowed' | 'no-speech' | 'network' | 'unsupported' | 'aborted' | 'unknown';

export interface RecognitionHandlers {
  /** 说话过程中的临时结果 */
  onPartial?: (text: string) => void;
  /** 一次识别结束时的最终文本（可能为空字符串） */
  onFinal: (text: string) => void;
  onError?: (error: SpeechErrorCode) => void;
}

export interface SpeechRecognizer {
  readonly supported: boolean;
  start(handlers: RecognitionHandlers, options?: { lang?: string }): void;
  /** 停止收音，已识别的内容会通过 onFinal 返回 */
  stop(): void;
  /** 丢弃本次识别 */
  abort(): void;
}

export interface SpeakOptions {
  lang?: string;
  rate?: number;
  pitch?: number;
}

export interface SpeechSynthesizer {
  readonly supported: boolean;
  /** 朗读完成（或被取消）后 resolve */
  speak(text: string, options?: SpeakOptions): Promise<void>;
  cancel(): void;
}
