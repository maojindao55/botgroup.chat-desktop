import { loadSpeechConfig } from '@/config/speechConfig';
import { CloudSynthesizer, RealtimeRecognizer, TokenPlanRecognizer } from './qwenSpeech';
import type { SpeechRecognizer, SpeechSynthesizer } from './types';
import { WebSpeechRecognizer, WebSpeechSynthesizer } from './webSpeech';

export type * from './types';
export { toSpeakableText } from './speechText';

let webRecognizer: SpeechRecognizer | null = null;
let webSynthesizer: SpeechSynthesizer | null = null;
let tokenPlanRecognizer: SpeechRecognizer | null = null;
let realtimeRecognizer: SpeechRecognizer | null = null;
let cloudSynthesizer: SpeechSynthesizer | null = null;

function getWebSynthesizer(): SpeechSynthesizer {
  webSynthesizer ??= new WebSpeechSynthesizer();
  return webSynthesizer;
}

/** 按家长设置选引擎；云端不可用（如在浏览器里预览）时退回系统语音 */
export function getSpeechRecognizer(): SpeechRecognizer {
  const engine = loadSpeechConfig().asr.engine;
  if (engine === 'tokenplan') {
    tokenPlanRecognizer ??= new TokenPlanRecognizer();
    if (tokenPlanRecognizer.supported) return tokenPlanRecognizer;
  } else if (engine === 'qwen') {
    realtimeRecognizer ??= new RealtimeRecognizer();
    if (realtimeRecognizer.supported) return realtimeRecognizer;
  }
  webRecognizer ??= new WebSpeechRecognizer();
  return webRecognizer;
}

export function getSpeechSynthesizer(): SpeechSynthesizer {
  if (loadSpeechConfig().tts.engine !== 'system') {
    cloudSynthesizer ??= new CloudSynthesizer(getWebSynthesizer());
    if (cloudSynthesizer.supported) return cloudSynthesizer;
  }
  return getWebSynthesizer();
}
