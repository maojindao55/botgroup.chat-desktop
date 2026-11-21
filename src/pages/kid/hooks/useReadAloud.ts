import { useCallback, useEffect, useRef } from 'react';
import { toSpeakableText } from '@/lib/speech';
import { useKid } from '../KidContext';

/** 按顺序朗读，多个伙伴的回复不会互相打断 */
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
    (text: string, speakerId?: string) => {
      const speakable = toSpeakableText(text);
      if (!synthesizer.supported || !speakable) return;
      const gen = generation.current;
      queue.current = queue.current.then(() =>
        gen === generation.current ? synthesizer.speak(speakable, { lang: 'zh-CN', speakerId }) : undefined,
      );
    },
    [synthesizer],
  );

  const speakNow = useCallback(
    (text: string, speakerId?: string) => {
      cancel();
      enqueue(text, speakerId);
    },
    [cancel, enqueue],
  );

  return { supported: synthesizer.supported, enqueue, speakNow, cancel };
}
