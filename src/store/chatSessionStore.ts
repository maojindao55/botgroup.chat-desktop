import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  ChatSession,
  ChatSessionMessage,
  ChatSessionSettingsSnapshot,
} from '@/config/chatSessions';
import {
  createChatSession,
  clampSessionMessages,
  getGroupSessions,
  getSessionsToEvict,
} from '@/config/chatSessions';

interface CreateSessionInit {
  title?: string;
  fallbackTitle?: string;
  messages?: ChatSessionMessage[];
  settingsSnapshot?: ChatSessionSettingsSnapshot;
}

interface ChatSessionStore {
  sessions: ChatSession[];

  /** 当前群的会话（已排序：置顶优先 + updatedAt 倒序） */
  getSessionsByGroup: (groupId: string) => ChatSession[];
  getSession: (sessionId: string) => ChatSession | undefined;

  createSession: (groupId: string, init?: CreateSessionInit) => ChatSession;
  renameSession: (sessionId: string, title: string) => void;
  /** 服务端总结标题：仅当未被手动命名时生效 */
  setAutoTitle: (sessionId: string, title: string) => void;
  deleteSession: (sessionId: string) => void;
  deleteSessionsByGroup: (groupId: string) => void;
  togglePinned: (sessionId: string) => void;
  toggleArchived: (sessionId: string) => void;

  appendMessage: (sessionId: string, message: ChatSessionMessage) => void;
  updateMessage: (sessionId: string, messageId: string | number, patch: Partial<ChatSessionMessage>) => void;
  /** 安全点整体提交（避免逐 token 落盘）；内容无变化时不更新 updatedAt */
  replaceMessages: (sessionId: string, messages: ChatSessionMessage[]) => void;
}

function bumpNow(): string {
  return new Date().toISOString();
}

/** 轻量内容签名，用于判断 replaceMessages 是否真的发生了变化 */
function messagesSignature(messages: ChatSessionMessage[]): string {
  return JSON.stringify(
    messages.map(m => [m.id, m.content, m.isAI ? 1 : 0, m.isError ? 1 : 0]),
  );
}

export const useChatSessionStore = create<ChatSessionStore>()(
  persist(
    (set, get) => ({
      sessions: [],

      getSessionsByGroup: (groupId) => getGroupSessions(get().sessions, groupId),

      getSession: (sessionId) => get().sessions.find(s => s.id === sessionId),

      createSession: (groupId, init) => {
        const session = createChatSession({
          groupId,
          title: init?.title,
          fallbackTitle: init?.fallbackTitle,
          messages: init?.messages,
          settingsSnapshot: init?.settingsSnapshot,
        });
        set(state => {
          const next = [session, ...state.sessions];
          const evictIds = new Set(getSessionsToEvict(next, groupId));
          return {
            sessions: evictIds.size > 0 ? next.filter(s => !evictIds.has(s.id)) : next,
          };
        });
        return session;
      },

      renameSession: (sessionId, title) => {
        const trimmed = title.trim();
        if (!trimmed) return;
        set(state => ({
          sessions: state.sessions.map(s =>
            s.id === sessionId
              ? { ...s, title: trimmed, titleSource: 'manual', titleGenerated: true, updatedAt: bumpNow() }
              : s,
          ),
        }));
      },

      setAutoTitle: (sessionId, title) => {
        const trimmed = title.trim();
        if (!trimmed) return;
        set(state => ({
          sessions: state.sessions.map(s => {
            if (s.id !== sessionId) return s;
            if (s.titleSource === 'manual') return s;
            return { ...s, title: trimmed, titleSource: 'auto', titleGenerated: true };
          }),
        }));
      },

      deleteSession: (sessionId) => {
        set(state => ({ sessions: state.sessions.filter(s => s.id !== sessionId) }));
      },

      deleteSessionsByGroup: (groupId) => {
        set(state => ({ sessions: state.sessions.filter(s => s.groupId !== groupId) }));
      },

      togglePinned: (sessionId) => {
        set(state => ({
          sessions: state.sessions.map(s =>
            s.id === sessionId ? { ...s, pinned: !s.pinned, updatedAt: bumpNow() } : s,
          ),
        }));
      },

      toggleArchived: (sessionId) => {
        set(state => ({
          sessions: state.sessions.map(s =>
            s.id === sessionId ? { ...s, archived: !s.archived, updatedAt: bumpNow() } : s,
          ),
        }));
      },

      appendMessage: (sessionId, message) => {
        set(state => ({
          sessions: state.sessions.map(s => {
            if (s.id !== sessionId) return s;
            return {
              ...s,
              messages: clampSessionMessages([...s.messages, message]),
              updatedAt: bumpNow(),
            };
          }),
        }));
      },

      updateMessage: (sessionId, messageId, patch) => {
        set(state => ({
          sessions: state.sessions.map(s => {
            if (s.id !== sessionId) return s;
            return {
              ...s,
              messages: s.messages.map(m => (m.id === messageId ? { ...m, ...patch } : m)),
              updatedAt: bumpNow(),
            };
          }),
        }));
      },

      replaceMessages: (sessionId, messages) => {
        set(state => ({
          sessions: state.sessions.map(s => {
            if (s.id !== sessionId) return s;
            const clamped = clampSessionMessages(messages);
            // 内容无变化则不更新 updatedAt，避免会话列表无谓重排
            if (messagesSignature(s.messages) === messagesSignature(clamped)) {
              return s;
            }
            return { ...s, messages: clamped, updatedAt: bumpNow() };
          }),
        }));
      },
    }),
    {
      name: 'ai_chat_sessions',
      version: 1,
      partialize: (state) => ({ sessions: state.sessions }),
    },
  ),
);
