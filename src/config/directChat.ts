/**
 * 单聊（1 对 1）辅助函数。
 *
 * 单聊在数据层复用 `AIGroup`：一个只含单个成员的群，并通过 `directChat`
 * 标记与普通群区分。这样会话、消息持久化、路由等现有逻辑无需分叉。
 */
import type { AIMember } from './aiMembers';
import type { AIGroup, Group } from './groups';

export const DIRECT_CHAT_GROUP_PREFIX = 'dm:';

/** 单聊群的稳定 id：同一成员始终复用同一个群与会话列表 */
export function directChatGroupId(memberId: string): string {
  return `${DIRECT_CHAT_GROUP_PREFIX}${memberId}`;
}

/** 是否为单聊群（新数据看标记，旧数据兜底看 id 前缀 + 单成员） */
export function isDirectChatGroup(group: Group | null | undefined): boolean {
  if (!group) return false;
  if (group.directChat === true) return true;
  return (
    group.id.startsWith(DIRECT_CHAT_GROUP_PREFIX) &&
    (group.memberIds?.length ?? 0) === 1
  );
}

/**
 * 构造（或刷新）一个成员的单聊群。
 * - 单成员 + `schedulerStrategy: 'all'`，避免每次发消息多打一次调度 LLM
 * - `description` 留空，避免被拼进 system prompt
 */
export function createDirectChatGroup(member: Pick<AIMember, 'id' | 'name'>): AIGroup {
  return {
    id: directChatGroupId(member.id),
    type: 'ai',
    name: member.name,
    description: '',
    memberIds: [member.id],
    isGroupDiscussionMode: false,
    schedulerStrategy: 'all',
    directChat: true,
  };
}
