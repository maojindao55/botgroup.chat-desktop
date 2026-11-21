/**
 * 群聊类型定义：仅保留角色群（多 LLM 角色陪伴聊天）。
 */

export type GroupType = 'ai';

export interface AIGroup {
  id: string;
  type: 'ai';
  name: string;
  description: string;
  memberIds: string[];                // 引用 ai_members 中的角色 id
  members?: string[];                // 兼容老版本
  isGroupDiscussionMode: boolean;   // 全员讨论 vs 智能调度
  schedulerStrategy: 'tag' | 'round_robin' | 'all'; // 调度策略
  maxRespondents?: number;          // 单轮最大回复人数（tag/round_robin 模式）
}

export type Group = AIGroup;

/** 旧版本遗留的开发群 / 专家群类型，读取历史数据时需要过滤掉 */
export const REMOVED_GROUP_TYPES = ['cli', 'agent'] as const;

export function isSupportedGroup(group: unknown): group is Group {
  if (!group || typeof group !== 'object') return false;
  const type = (group as { type?: unknown }).type;
  return type === undefined || type === 'ai';
}

// ============ 预设群聊 ============
export const KID_PLAYGROUND_GROUP_ID = 'kid-playground';

export const defaultGroups: Group[] = [
  {
    id: KID_PLAYGROUND_GROUP_ID,
    type: 'ai',
    name: '小伙伴乐园',
    description: '好奇博士、故事精灵、数学小熊和画画兔都在这里，一起聊天、讲故事、玩游戏。',
    memberIds: ['kid-curious-doctor', 'kid-story-fairy', 'kid-math-bear', 'kid-drawing-bunny'],
    isGroupDiscussionMode: false,
    schedulerStrategy: 'tag',
  },
];
