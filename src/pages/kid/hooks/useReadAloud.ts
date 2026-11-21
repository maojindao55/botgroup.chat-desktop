import { useCallback, useEffect, useRef } from 'react';
import { createSentenceStream } from '@/config/speechConfig';
import { toSpeakableText } from '@/lib/speech';
import { useKid } from '../KidContext';

/** 按顺序朗读，多个伙伴的回复不会互相打断；排队的句子会提前合成 */
export function useReadAloud() {
  const { synthesizer } = useKid();
  const queue = useRef<Promise<void>>(Promise.resolve());
  const generation = useRef(0);

  const cancel = useCallback(() => {
    generation.current += 1;
    queue.current = Promise.resolve();
    synthesizer.cancel();
  }, [synthesizer]);

  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // StrictMode 会立即卸载再挂载，延后一拍确认真的离开页面再停止朗读
      setTimeout(() => {
        if (!mounted.current) cancel();
      }, 0);
    };
  }, [cancel]);

  const enqueue = useCallback(
    (text: string, speakerId?: string, gameId?: string) => {
      const speakable = toSpeakableText(text);
      if (!synthesizer.supported || !speakable) return;
      const gen = generation.current;
      const options = { lang: 'zh-CN', speakerId, gameId };
      synthesizer.prefetch?.(speakable, options);
      queue.current = queue.current.then(() => (gen === generation.current ? synthesizer.speak(speakable, options) : undefined));
    },
    [synthesizer],
  );

  /** 回复还在生成时就逐句朗读：onText 传目前为止的全文，结束时调用 finish */
  const stream = useCallback(
    (speakerId?: string, gameId?: string) => {
      const sentences = createSentenceStream();
      const gen = generation.current;
      const feed = (pieces: string[]) => {
        if (gen !== generation.current) return;
        pieces.forEach((piece) => enqueue(piece, speakerId, gameId));
      };
      return {
        onText: (text: string) => feed(sentences.push(text)),
        finish: (text: string | null) => feed(text ? sentences.finish(text) : []),
      };
    },
    [enqueue],
  );

  const speakNow = useCallback(
    (text: string, speakerId?: string, gameId?: string) => {
      cancel();
      enqueue(text, speakerId, gameId);
    },
    [cancel, enqueue],
  );

  return { supported: synthesizer.supported, enqueue, stream, speakNow, cancel };
}
