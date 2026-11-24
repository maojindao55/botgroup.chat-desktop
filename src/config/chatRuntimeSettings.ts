/**
 * 聊天运行时设置（本地持久化）。
 *
 * 目前只包含「单次回复等待时限」：不同模型首 token 延迟差异很大，
 * 固定 10s 会误伤 Kimi 等较慢模型。
 */

export const CHAT_REPLY_TIMEOUT_KEY = 'chat_reply_timeout_ms';
export const DEFAULT_CHAT_REPLY_TIMEOUT_MS = 15_000;
export const MIN_CHAT_REPLY_TIMEOUT_MS = 5_000;
export const MAX_CHAT_REPLY_TIMEOUT_MS = 180_000;

export function normalizeChatReplyTimeoutMs(value: unknown): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return DEFAULT_CHAT_REPLY_TIMEOUT_MS;
  return Math.min(MAX_CHAT_REPLY_TIMEOUT_MS, Math.max(MIN_CHAT_REPLY_TIMEOUT_MS, Math.round(num)));
}

export function loadChatReplyTimeoutMs(): number {
  try {
    const stored = localStorage.getItem(CHAT_REPLY_TIMEOUT_KEY);
    return stored === null
      ? DEFAULT_CHAT_REPLY_TIMEOUT_MS
      : normalizeChatReplyTimeoutMs(stored);
  } catch {
    return DEFAULT_CHAT_REPLY_TIMEOUT_MS;
  }
}

export function saveChatReplyTimeoutMs(value: number): number {
  const normalized = normalizeChatReplyTimeoutMs(value);
  try {
    localStorage.setItem(CHAT_REPLY_TIMEOUT_KEY, String(normalized));
  } catch {
    // ignore storage errors
  }
  return normalized;
}
