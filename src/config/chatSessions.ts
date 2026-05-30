/**
 * 角色群聊（AI 群）会话模型与纯函数
 *
 * 设计说明见 docs/superpowers/specs/2026-05-30-role-group-chat-sessions-design.md
 *
 * 本模块保持「零依赖」（不 import i18n / store / 组件），方便单元测试与复用。
 * 所有需要展示给用户的兜底文案（如默认标题）都以参数传入，由 UI 层提供译文。
 */

export type ChatSessionTitleSource = 'auto' | 'manual';

/** 单条会话消息（与 ChatUI 渲染用的消息形状保持兼容） */
export interface ChatSessionMessage {
  /** 兼容历史：ChatUI 旧逻辑使用数字 id，这里允许 string | number */
  id: string | number;
  sender: { id: string; name: string; avatar?: string };
  content: string;
  isAI: boolean;
  isError?: boolean;
  createdAt?: string;
}

/** 创建会话时的群行为快照，避免后续改群设置影响历史会话语义 */
export interface ChatSessionSettingsSnapshot {
  isGroupDiscussionMode: boolean;
  schedulerStrategy: 'tag' | 'round_robin' | 'all';
}

export interface ChatSession {
  id: string;
  /** 所属角色群 id（稳定引用，非 index） */
  groupId: string;
  title: string;
  titleSource: ChatSessionTitleSource;
  /** 服务端总结标题是否已生成过，避免重复生成 */
  titleGenerated?: boolean;
  pinned?: boolean;
  archived?: boolean;
  createdAt: string;
  updatedAt: string;
  messages: ChatSessionMessage[];
  settingsSnapshot?: ChatSessionSettingsSnapshot;
}

/** 每个会话保留的最大消息数（超出从头部裁剪，保留最近 N 条） */
export const MAX_MESSAGES_PER_SESSION = 200;
/** 每个群保留的最大会话数（超出淘汰未置顶的最旧会话） */
export const MAX_SESSIONS_PER_GROUP = 50;
/** 标题最大长度（截断 / 总结都遵守） */
export const MAX_SESSION_TITLE_LEN = 48;

/** 默认会话标题兜底（UI 通常会传入译文覆盖） */
export const DEFAULT_SESSION_TITLE = 'New chat';

function genId(prefix: string): string {
  const unique =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${unique}`;
}

/** 生成会话 id */
export function newChatSessionId(): string {
  return genId('chatsession');
}

/** 生成消息 id */
export function newChatMessageId(): string {
  return genId('msg');
}

/**
 * 把一段文本截断为标题：取首个非空行，超长加省略号。
 * @param fallback 文本为空时的兜底标题（UI 传译文）
 */
export function truncateSessionTitle(
  text: string,
  maxLen: number = MAX_SESSION_TITLE_LEN,
  fallback: string = DEFAULT_SESSION_TITLE,
): string {
  const firstLine = (text || '')
    .split('\n')
    .map(line => line.trim())
    .find(line => line.length > 0);
  const base = firstLine || fallback;
  if (base.length <= maxLen) return base;
  return `${base.slice(0, Math.max(1, maxLen - 1))}…`;
}

/**
 * 清洗 LLM 返回的标题：去掉首尾空白、包裹引号、换行、结尾标点，并限长。
 * 返回空串表示不可用（调用方应回退到截断标题）。
 */
export function cleanGeneratedTitle(raw: string, maxLen: number = MAX_SESSION_TITLE_LEN): string {
  if (!raw) return '';
  let title = raw.trim();
  // 取首行（模型偶尔会输出多行或解释）
  title = title.split('\n').map(l => l.trim()).find(l => l.length > 0) || '';
  if (!title) return '';
  // 去掉常见包裹引号 / 书名号 / 反引号
  title = title.replace(/^["'“”『「《`\s]+/, '').replace(/["'“”』」》`\s]+$/, '');
  // 去掉「标题：」「Title:」之类前缀
  title = title.replace(/^(标题|title)\s*[:：]\s*/i, '');
  // 去掉结尾标点
  title = title.replace(/[。.!！?？，,；;、\s]+$/, '');
  title = title.trim();
  if (!title) return '';
  if (title.length > maxLen) title = `${title.slice(0, Math.max(1, maxLen - 1))}…`;
  return title;
}

/** 限制单会话消息数量：保留最近 N 条 */
export function clampSessionMessages(
  messages: ChatSessionMessage[],
  max: number = MAX_MESSAGES_PER_SESSION,
): ChatSessionMessage[] {
  if (messages.length <= max) return messages;
  return messages.slice(messages.length - max);
}

export interface CreateChatSessionParams {
  groupId: string;
  title?: string;
  titleSource?: ChatSessionTitleSource;
  messages?: ChatSessionMessage[];
  settingsSnapshot?: ChatSessionSettingsSnapshot;
  /** title 缺省时的兜底标题（UI 传译文） */
  fallbackTitle?: string;
}

/** 创建一个新会话对象 */
export function createChatSession(params: CreateChatSessionParams): ChatSession {
  const now = new Date().toISOString();
  return {
    id: newChatSessionId(),
    groupId: params.groupId,
    title: params.title || params.fallbackTitle || DEFAULT_SESSION_TITLE,
    titleSource: params.titleSource || 'auto',
    titleGenerated: false,
    pinned: false,
    archived: false,
    createdAt: now,
    updatedAt: now,
    messages: params.messages ? clampSessionMessages(params.messages) : [],
    settingsSnapshot: params.settingsSnapshot,
  };
}

/** 排序：置顶优先，其次按 updatedAt 倒序 */
export function sortChatSessions(sessions: ChatSession[]): ChatSession[] {
  return [...sessions].sort((a, b) => {
    const pa = a.pinned ? 1 : 0;
    const pb = b.pinned ? 1 : 0;
    if (pa !== pb) return pb - pa;
    return (b.updatedAt || '').localeCompare(a.updatedAt || '');
  });
}

export interface ChatSessionListFilter {
  search?: string;
  showArchived?: boolean;
}

/** 列表筛选：默认隐藏归档；search 匹配标题与消息内容 */
export function filterChatSessions(
  sessions: ChatSession[],
  filter: ChatSessionListFilter = {},
): ChatSession[] {
  const search = filter.search?.trim().toLowerCase();
  return sessions.filter(session => {
    if (!filter.showArchived && session.archived) return false;
    if (search) {
      const haystack = `${session.title}\n${session.messages.map(m => m.content).join('\n')}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
}

/** 当前群的会话（已排序） */
export function getGroupSessions(sessions: ChatSession[], groupId: string): ChatSession[] {
  return sortChatSessions(sessions.filter(s => s.groupId === groupId));
}

/**
 * 控制单个群的会话数量上限：超出时淘汰「未置顶、最旧」的会话。
 * 返回需要删除的会话 id 列表（不直接修改入参）。
 */
export function getSessionsToEvict(
  sessions: ChatSession[],
  groupId: string,
  max: number = MAX_SESSIONS_PER_GROUP,
): string[] {
  const groupSessions = sessions.filter(s => s.groupId === groupId);
  if (groupSessions.length <= max) return [];
  const evictable = groupSessions
    .filter(s => !s.pinned)
    // 最旧优先淘汰
    .sort((a, b) => (a.updatedAt || '').localeCompare(b.updatedAt || ''));
  const overflow = groupSessions.length - max;
  return evictable.slice(0, overflow).map(s => s.id);
}

/** 会话是否仍是未命名占位（用于判断是否需要生成标题） */
export function isUntitledSession(session: ChatSession, fallbackTitles: string[] = []): boolean {
  if (session.titleSource === 'manual') return false;
  if (session.titleGenerated) return false;
  const placeholders = new Set([DEFAULT_SESSION_TITLE, ...fallbackTitles]);
  return placeholders.has(session.title);
}

/** 取首条用户消息文本（用于回退标题 / 总结输入） */
export function getFirstUserMessage(session: ChatSession): ChatSessionMessage | undefined {
  return session.messages.find(m => !m.isAI);
}

/** 取首条 AI 回复文本（用于总结输入） */
export function getFirstAIMessage(session: ChatSession): ChatSessionMessage | undefined {
  return session.messages.find(m => m.isAI && !m.isError && m.content.trim().length > 0);
}

/**
 * 判断会话是否到了「可以生成标题」的时机：
 * 至少有 1 条用户消息 + 1 条有内容的 AI 回复，且尚未生成过、未被手动命名。
 */
export function shouldGenerateTitle(session: ChatSession, fallbackTitles: string[] = []): boolean {
  if (session.titleSource === 'manual' || session.titleGenerated) return false;
  if (!isUntitledSession(session, fallbackTitles)) {
    // 标题已不是占位（可能是首条截断），仍允许用总结覆盖一次
    if (session.titleGenerated) return false;
  }
  return !!getFirstUserMessage(session) && !!getFirstAIMessage(session);
}
