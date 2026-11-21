import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { buildVoiceDialogInstructions } from '@/config/childPrompt';
import type { AgeProfile } from '@/config/ageProfile';
import type { KidChatMessage } from '@/config/kidChatHistory';
import type { KidMemory } from '@/config/kidMemory';
import { dialogEnabled, dialogVoiceFor, loadSpeechConfig } from '@/config/speechConfig';
import { dialogSupported, RealtimeDialogTurn, type DialogHistoryTurn } from '@/lib/speech/realtimeDialog';
import type { SpeechRecognizer } from '@/lib/speech';
import type { KidCompanion } from '../KidContext';
import { KID_SPEAKER_ID, type useKidMessages } from './useKidMessages';

type ReplyHandle = ReturnType<ReturnType<typeof useKidMessages>['startReply']>;

const HISTORY_TURNS = 20;
const FALLBACK_HINT = '实时对话没连上，已经换回普通语音，再按住说一次吧～';

interface RealtimeTalkOptions {
  companion: KidCompanion;
  /** 单个伙伴的自由聊天才用实时对话 */
  allowed: boolean;
  autoReadAloud: boolean;
  profile: AgeProfile;
  memory: KidMemory;
  messagesRef: MutableRefObject<KidChatMessage[]>;
  startReply: (companion: KidCompanion) => ReplyHandle;
  /** 按下说话（停掉其他朗读） */
  onPress: () => void;
  /** 识别出了孩子说的话（可能为空），此时应先放上孩子的气泡 */
  onKidSpoke: (text: string) => void;
}

export function toDialogHistory(messages: KidChatMessage[]): DialogHistoryTurn[] {
  return messages
    .filter((m) => !m.isError && m.content.trim())
    .slice(-HISTORY_TURNS)
    .map((m) => ({ role: m.speakerId === KID_SPEAKER_ID ? 'user' : 'assistant', text: m.content }));
}

/**
 * 单个伙伴聊天时的实时语音对话（qwen-audio-3.0-realtime-plus）：返回一个替换默认识别的 recognizer，
 * 松手后孩子的话、伙伴的文字和声音都由同一个模型流式给出。连不上时自动退回原来的识别 + 文字模型 + 朗读。
 */
export function useRealtimeTalk(options: RealtimeTalkOptions) {
  const [fallback, setFallback] = useState(false);
  const [replying, setReplying] = useState(false);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const turnRef = useRef<RealtimeDialogTurn | null>(null);
  const replyRef = useRef<ReplyHandle | null>(null);

  const available = useMemo(
    () => options.allowed && !fallback && dialogEnabled(loadSpeechConfig()) && dialogSupported(),
    [options.allowed, fallback],
  );

  const recognizer = useMemo<SpeechRecognizer | null>(() => {
    if (!available) return null;
    const finishReply = (action: (reply: ReplyHandle) => void) => {
      if (replyRef.current) action(replyRef.current);
      replyRef.current = null;
      setReplying(false);
    };
    const interrupt = () => {
      turnRef.current?.close();
      turnRef.current = null;
      finishReply((reply) => reply.interrupt());
    };
    return {
      supported: true,
      start(handlers) {
        interrupt();
        const opts = optionsRef.current;
        opts.onPress();
        const config = loadSpeechConfig();
        const id = opts.companion.member.id;
        let heard = false;
        const turn: RealtimeDialogTurn = new RealtimeDialogTurn(
          {
            instructions: buildVoiceDialogInstructions({
              aiName: opts.companion.member.name,
              companionPrompt: opts.companion.member.customPrompt,
              profile: opts.profile,
              memory: opts.memory,
            }),
            voice: dialogVoiceFor(config, id),
            history: toDialogHistory(opts.messagesRef.current),
            rate: opts.profile.band === 'preschool' ? 0.9 : undefined,
            muted: !opts.autoReadAloud,
          },
          {
            onUserText: (text) => {
              if (turnRef.current !== turn) return;
              heard = true;
              handlers.onFinal(text);
              optionsRef.current.onKidSpoke(text);
              replyRef.current = optionsRef.current.startReply(optionsRef.current.companion);
              setReplying(true);
            },
            onReplyText: (text) => {
              if (turnRef.current === turn) replyRef.current?.text(text);
            },
            onReplyDone: (text) => {
              if (turnRef.current === turn) finishReply((reply) => reply.done(text));
            },
            onError: (code, message, connected) => {
              if (turnRef.current !== turn) return;
              turnRef.current = null;
              if (heard) {
                finishReply((reply) => reply.fail(message));
              } else if (code === 'network' && !connected) {
                setFallback(true);
                handlers.onError?.(code, FALLBACK_HINT);
              } else {
                handlers.onError?.(code);
              }
            },
          },
          config,
        );
        turnRef.current = turn;
        void turn.start();
      },
      stop() {
        turnRef.current?.release();
      },
      abort: interrupt,
    };
  }, [available]);

  useEffect(
    () => () => {
      turnRef.current?.close();
      replyRef.current?.interrupt();
    },
    [],
  );

  return {
    recognizer,
    /** 实时回复进行中：孩子可以随时按下说话打断 */
    replying,
    /** 关掉朗读时停止正在播放的回复 */
    stopSpeaking: () => turnRef.current?.stopSpeaking(),
  };
}
