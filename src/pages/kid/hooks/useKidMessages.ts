import { useCallback, useEffect, useRef, useState } from 'react';
import { loadKidChat, newKidMessageId, saveKidChat, type KidChatMessage } from '@/config/kidChatHistory';
import { streamCompanionReply, type KidChatTurn } from '@/lib/companionChat';
import { KID_MODEL_MISSING_MESSAGE } from '@/utils/companionCredentials';
import type { KidCompanion } from '../KidContext';

export const KID_SPEAKER_ID = 'kid';

function friendlyError(companionName: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || '');
  if (message.includes(KID_MODEL_MISSING_MESSAGE) || message.includes('API Key') || message.includes('模型')) {
    return `${companionName}还没准备好，请爸爸妈妈在设置里帮忙选好模型哦。`;
  }
  return `哎呀，${companionName}刚刚走神了，等一下再试试吧。`;
}

export interface CompanionReplyRequest {
  companion: KidCompanion;
  message: string;
  gamePrompt?: string;
  allNames?: string[];
  /** 流式回调目前为止的全文，用于边生成边朗读 */
  onText?: (fullText: string) => void;
}

/**
 * 儿童端消息列表。persistId 为空时不落盘（游戏局）。
 * askCompanion 会先放一个“正在想”的气泡，流式填充，失败时换成友好的提示。
 */
export function useKidMessages(persistId?: string) {
  const [messages, setMessages] = useState<KidChatMessage[]>(() => (persistId ? loadKidChat(persistId) : []));
  const messagesRef = useRef(messages);
  const [pendingId, setPendingId] = useState<string | null>(null);

  useEffect(() => {
    messagesRef.current = messages;
    if (persistId && !pendingId) saveKidChat(persistId, messages);
  }, [messages, persistId, pendingId]);

  const update = useCallback((updater: (prev: KidChatMessage[]) => KidChatMessage[]) => {
    setMessages((prev) => {
      const next = updater(prev);
      messagesRef.current = next;
      return next;
    });
  }, []);

  const push = useCallback(
    (message: Omit<KidChatMessage, 'id' | 'createdAt'>) => {
      const full: KidChatMessage = { ...message, id: newKidMessageId(), createdAt: Date.now() };
      update((prev) => [...prev, full]);
      return full;
    },
    [update],
  );

  const toTurns = (list: KidChatMessage[]): KidChatTurn[] =>
    list.filter((m) => !m.isError).map((m) => ({ speakerId: m.speakerId, speakerName: m.speakerName, content: m.content }));

  /**
   * 孩子刚发的那条从 history 里拿出来单独作为 message，本轮已回复的伙伴排在它之后，
   * 对应 /api/chat 的 index 约定（message 插在倒数第 index 条之前）。
   */
  const askCompanion = useCallback(
    async ({ companion, message, gamePrompt, allNames, onText }: CompanionReplyRequest): Promise<string | null> => {
      const placeholder = push({ speakerId: companion.member.id, speakerName: companion.member.name, content: '' });
      setPendingId(placeholder.id);
      const history = toTurns(messagesRef.current.filter((m) => m.id !== placeholder.id));
      const lastKidIndex = history.map((t) => t.speakerId).lastIndexOf(KID_SPEAKER_ID);
      const kidMessageInHistory = lastKidIndex >= 0 && history[lastKidIndex].content === message;
      const priorHistory = kidMessageInHistory
        ? [...history.slice(0, lastKidIndex), ...history.slice(lastKidIndex + 1)]
        : history;
      const repliesAfterMessage = kidMessageInHistory ? history.length - lastKidIndex - 1 : 0;
      try {
        const text = await streamCompanionReply({
          companion: companion.member,
          message,
          history: priorHistory,
          index: repliesAfterMessage,
          gamePrompt,
          allNames,
          onDelta: (full) => {
            update((prev) => prev.map((m) => (m.id === placeholder.id ? { ...m, content: full } : m)));
            onText?.(full);
          },
        });
        update((prev) => prev.map((m) => (m.id === placeholder.id ? { ...m, content: text } : m)));
        return text;
      } catch (error) {
        console.warn('[kid] companion reply failed', error);
        update((prev) =>
          prev.map((m) => (m.id === placeholder.id ? { ...m, content: friendlyError(companion.member.name, error), isError: true } : m)),
        );
        return null;
      } finally {
        setPendingId(null);
      }
    },
    [push, update],
  );

  /** 由外部（实时语音对话）填充的回复气泡 */
  const startReply = useCallback(
    (companion: KidCompanion) => {
      const placeholder = push({ speakerId: companion.member.id, speakerName: companion.member.name, content: '' });
      setPendingId(placeholder.id);
      const set = (patch: Partial<KidChatMessage>) =>
        update((prev) => prev.map((m) => (m.id === placeholder.id ? { ...m, ...patch } : m)));
      let open = true;
      const close = () => {
        if (!open) return false;
        open = false;
        setPendingId((id) => (id === placeholder.id ? null : id));
        return true;
      };
      return {
        text: (full: string) => open && set({ content: full }),
        done: (full: string) => {
          if (!full.trim()) return void (close() && set({ content: friendlyError(companion.member.name, ''), isError: true }));
          if (close()) set({ content: full });
        },
        fail: (error: unknown) => close() && set({ content: friendlyError(companion.member.name, error), isError: true }),
        /** 被打断：保留已经说出的部分，什么都没说就去掉气泡 */
        interrupt: () => {
          if (!close()) return;
          const current = messagesRef.current.find((m) => m.id === placeholder.id);
          if (!current?.content.trim()) update((prev) => prev.filter((m) => m.id !== placeholder.id));
        },
      };
    },
    [push, update],
  );

  const reset = useCallback((initial: KidChatMessage[] = []) => update(() => initial), [update]);

  return { messages, messagesRef, push, askCompanion, startReply, pendingId, busy: pendingId !== null, reset };
}
