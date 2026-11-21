/**
 * 语音能力的抽象接口。实现有系统自带的 Web Speech 和千问云端两种，
 * 之后可再接移动端原生插件，页面只依赖这里的接口。
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
  /** 正在说话的伙伴 id，云端朗读据此选择音色 */
  speakerId?: string;
}

export interface SpeechSynthesizer {
  readonly supported: boolean;
  /** 朗读完成（或被取消）后 resolve */
  speak(text: string, options?: SpeakOptions): Promise<void>;
  cancel(): void;
}
