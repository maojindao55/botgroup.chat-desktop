import { create } from 'zustand';

/**
 * 按群持久化的「禁言成员」状态。
 *
 * 旧实现里 mutedUsers 是 AgentChatUI 内部的 useState，刷新页面 / 切换群 / 重开
 * 应用都会丢失，用户会困惑「禁言的专家又回来了」。这里改为 localStorage 持久化、
 * 以 groupId 为键，跨会话稳定保留。
 */
export interface MutedMembersStore {
  byGroup: Record<string, string[]>;
  toggle: (groupId: string, memberId: string) => void;
  setMuted: (groupId: string, memberIds: string[]) => void;
  clear: (groupId: string) => void;
}

const STORAGE_KEY = 'muted_members_by_group';

function safeRead(): Record<string, string[]> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const result: Record<string, string[]> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(value) && value.every(v => typeof v === 'string')) {
        result[key] = value;
      }
    }
    return result;
  } catch {
    return {};
  }
}

function safeWrite(value: Record<string, string[]>) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    /* quota / private mode */
  }
}

export const useMutedMembersStore = create<MutedMembersStore>((set, get) => ({
  byGroup: safeRead(),
  toggle: (groupId, memberId) => {
    const current = get().byGroup;
    const list = current[groupId] || [];
    const nextList = list.includes(memberId)
      ? list.filter(id => id !== memberId)
      : [...list, memberId];
    const next = { ...current, [groupId]: nextList };
    safeWrite(next);
    set({ byGroup: next });
  },
  setMuted: (groupId, memberIds) => {
    const current = get().byGroup;
    const deduped = Array.from(new Set(memberIds));
    const next = { ...current, [groupId]: deduped };
    safeWrite(next);
    set({ byGroup: next });
  },
  clear: (groupId) => {
    const current = get().byGroup;
    if (!(groupId in current)) return;
    const next = { ...current };
    delete next[groupId];
    safeWrite(next);
    set({ byGroup: next });
  },
}));

/** 同步读取某群的禁言列表（非 React 代码可用） */
export function getMutedMembers(groupId: string): string[] {
  return useMutedMembersStore.getState().byGroup[groupId] || [];
}
