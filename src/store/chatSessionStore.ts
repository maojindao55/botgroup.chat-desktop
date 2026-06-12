import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
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
  sanitizeMessageForStorage,
  sanitizeMessagesForStorage,
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
    messages.map(m => [
      m.id,
      m.content,
      m.isAI ? 1 : 0,
      m.isError ? 1 : 0,
      m.workflowRun?.id,
      m.workflowRun?.status,
      m.workflowRun?.updatedAt,
    ]),
  );
}

function isQuotaError(e: unknown): boolean {
  if (typeof DOMException !== 'undefined' && e instanceof DOMException) {
    return (
      e.name === 'QuotaExceededError' ||
      e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      e.code === 22 ||
      e.code === 1014
    );
  }
  return e instanceof Error && /quota/i.test(e.message);
}

/**
 * 配额超限时收缩持久化负载：删除「最旧、未置顶」的会话，逐步重试。
 * 返回收缩后的字符串；无法继续收缩时返回 null。
 */
function shrinkPersistedEnvelope(raw: string): string | null {
  try {
    const env = JSON.parse(raw);
    const sessions: ChatSession[] | undefined = env?.state?.sessions;
    if (!Array.isArray(sessions) || sessions.length === 0) return null;

    let dropAt = -1;
    let dropKey = '';
    sessions.forEach((s, i) => {
      // 未置顶优先；其次最旧（updatedAt 最小）
      const key = `${s.pinned ? '1' : '0'}|${s.updatedAt || ''}`;
      if (dropAt === -1 || key < dropKey) {
        dropAt = i;
        dropKey = key;
      }
    });
    if (dropAt === -1) return null;
    sessions.splice(dropAt, 1);
    env.state.sessions = sessions;
    return JSON.stringify(env);
  } catch {
    return null;
  }
}

/**
 * 配额安全的 localStorage 封装：
 * - 写入超限时，逐步删除最旧/未置顶会话后重试，绝不抛出导致应用崩溃；
 * - 读写异常一律静默降级。
 */
const quotaSafeStorage: StateStorage = {
  getItem: (name) => {
    try {
      return localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      localStorage.setItem(name, value);
      return;
    } catch (e) {
      if (!isQuotaError(e)) {
        console.warn('[chatSessions] persist failed:', e);
        return;
      }
      let shrunk = shrinkPersistedEnvelope(value);
      let guard = 0;
      while (shrunk && guard < 200) {
        try {
          localStorage.setItem(name, shrunk);
          console.warn('[chatSessions] storage quota exceeded; evicted oldest chat sessions to fit.');
          return;
        } catch (e2) {
          if (!isQuotaError(e2)) {
            console.warn('[chatSessions] persist failed:', e2);
            return;
          }
          shrunk = shrinkPersistedEnvelope(shrunk);
          guard += 1;
        }
      }
      console.warn('[chatSessions] storage quota exceeded; dropping chat session write.');
    }
  },
  removeItem: (name) => {
    try {
      localStorage.removeItem(name);
    } catch {
      /* noop */
    }
  },
};

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
              messages: clampSessionMessages([...s.messages, sanitizeMessageForStorage(message)]),
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
        set(state => {
          let changed = false;
          const sessions = state.sessions.map(s => {
            if (s.id !== sessionId) return s;
            const clamped = clampSessionMessages(sanitizeMessagesForStorage(messages));
            // 内容无变化则不更新 updatedAt，避免会话列表无谓重排
            if (messagesSignature(s.messages) === messagesSignature(clamped)) {
              return s;
            }
            changed = true;
            return { ...s, messages: clamped, updatedAt: bumpNow() };
          });
          return changed ? { sessions } : state;
        });
      },
    }),
    {
      name: 'ai_chat_sessions',
      version: 1,
      storage: createJSONStorage(() => quotaSafeStorage),
      partialize: (state) => ({ sessions: state.sessions }),
      // 历史数据可能在每条消息里存了 base64 头像，撑爆配额；加载时一次性清洗掉，
      // 之后任意写入都会以瘦身后的体积落盘（配合 quotaSafeStorage 兜底）。
      onRehydrateStorage: () => (state) => {
        if (!state?.sessions?.length) return;
        state.sessions = state.sessions.map(s => ({
          ...s,
          messages: sanitizeMessagesForStorage(s.messages || []),
        }));
      },
    },
  ),
);
