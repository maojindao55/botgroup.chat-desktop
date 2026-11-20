import type { GroupType } from './groups';

export type AISpeechMode = 'smart' | 'round_robin' | 'all';

export interface ProductGroupType {
  type: GroupType;
  label: string;
  shortLabel: string;
  description: string;
}

export interface AISpeechModeOption {
  value: AISpeechMode;
  label: string;
  description: string;
}

export const productGroupTypes: ProductGroupType[] = [
  {
    type: 'ai',
    label: '角色群',
    shortLabel: '角色',
    description: '邀请不同角色和模型一起聊天、脑暴、做观点碰撞。',
  },
];

export const aiSpeechModes: AISpeechModeOption[] = [
  {
    value: 'smart',
    label: '智能点名',
    description: '根据消息内容选择最相关的角色发言，适合日常聊天。',
  },
  {
    value: 'round_robin',
    label: '轮流发言',
    description: '群友按顺序轮流回复，适合长期陪伴式对话。',
  },
  {
    value: 'all',
    label: '全员圆桌',
    description: '每轮所有角色都发言，适合脑暴和多模型观点对比。',
  },
];

export function resolveAISpeechMode(group: {
  isGroupDiscussionMode?: boolean;
  schedulerStrategy?: 'tag' | 'round_robin' | 'all';
}): AISpeechMode {
  if (group.isGroupDiscussionMode) return 'all';
  if (group.schedulerStrategy === 'round_robin') return 'round_robin';
  if (group.schedulerStrategy === 'all') return 'all';
  return 'smart';
}

export function applyAISpeechMode(mode: AISpeechMode): {
  isGroupDiscussionMode: boolean;
  schedulerStrategy: 'tag' | 'round_robin' | 'all';
} {
  if (mode === 'all') {
    return { isGroupDiscussionMode: true, schedulerStrategy: 'all' };
  }
  if (mode === 'round_robin') {
    return { isGroupDiscussionMode: false, schedulerStrategy: 'round_robin' };
  }
  return { isGroupDiscussionMode: false, schedulerStrategy: 'tag' };
}

export function getProductGroupType(type: GroupType): ProductGroupType {
  return productGroupTypes.find((item) => item.type === type) || productGroupTypes[0];
}
