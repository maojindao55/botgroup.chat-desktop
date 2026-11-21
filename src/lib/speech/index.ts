import type { SpeechRecognizer, SpeechSynthesizer } from './types';
import { WebSpeechRecognizer, WebSpeechSynthesizer } from './webSpeech';

export type * from './types';
export { toSpeakableText } from './speechText';

let recognizer: SpeechRecognizer | null = null;
let synthesizer: SpeechSynthesizer | null = null;

export function getSpeechRecognizer(): SpeechRecognizer {
  recognizer ??= new WebSpeechRecognizer();
  return recognizer;
}

export function getSpeechSynthesizer(): SpeechSynthesizer {
  synthesizer ??= new WebSpeechSynthesizer();
  return synthesizer;
}
