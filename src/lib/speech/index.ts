import { loadSpeechConfig } from '@/config/speechConfig';
import { QwenRecognizer, QwenSynthesizer } from './qwenSpeech';
import type { SpeechRecognizer, SpeechSynthesizer } from './types';
import { WebSpeechRecognizer, WebSpeechSynthesizer } from './webSpeech';

export type * from './types';
export { toSpeakableText } from './speechText';

let webRecognizer: SpeechRecognizer | null = null;
let webSynthesizer: SpeechSynthesizer | null = null;
let qwenRecognizer: SpeechRecognizer | null = null;
let qwenSynthesizer: SpeechSynthesizer | null = null;

function getWebSynthesizer(): SpeechSynthesizer {
  webSynthesizer ??= new WebSpeechSynthesizer();
  return webSynthesizer;
}

/** 按家长设置选引擎；云端不可用（如在浏览器里预览）时退回系统语音 */
export function getSpeechRecognizer(): SpeechRecognizer {
  if (loadSpeechConfig().asr.engine === 'qwen') {
    qwenRecognizer ??= new QwenRecognizer();
    if (qwenRecognizer.supported) return qwenRecognizer;
  }
  webRecognizer ??= new WebSpeechRecognizer();
  return webRecognizer;
}

export function getSpeechSynthesizer(): SpeechSynthesizer {
  if (loadSpeechConfig().tts.engine === 'qwen') {
    qwenSynthesizer ??= new QwenSynthesizer(getWebSynthesizer());
    if (qwenSynthesizer.supported) return qwenSynthesizer;
  }
  return getWebSynthesizer();
}
