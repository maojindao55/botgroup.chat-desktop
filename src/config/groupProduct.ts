import type { CLICustomWorkflow, CLIExecutionPlan, CLIStrategy, GroupType } from './groups';
import type { AgentWorkflowEffort, AgentWorkflowIntent } from './agentWorkflow';

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

/** Agent 群默认协作强度选项 */
export interface AgentWorkflowEffortOption {
  value: AgentWorkflowEffort;
  label: string;
  description: string;
  recommendedMaxPhases: number;
  recommendedMaxParallelAgents: number;
}

/** Agent 群输入区快捷意图 */
export interface AgentWorkflowIntentPreset {
  id: 'smart' | 'discuss' | 'multi_solution' | 'review' | 'isolated';
  label: string;
  description: string;
  intent: AgentWorkflowIntent;
}

export interface CLIWorkflowTemplate {
  id: 'quick_response' | 'diagnose_fix_review' | 'implement_review' | 'review_fix' | 'multi_solution' | 'isolated_race' | 'discussion';
  label: string;
  description: string;
  strategy: CLIStrategy;
  executionPlan?: Partial<CLIExecutionPlan>;
  customWorkflow?: CLICustomWorkflow;
  defaultStages: string[];
}

export interface CLIWorkflowTemplateGroup {
  id: 'common' | 'advanced';
  label: string;
  description: string;
  templateIds: CLIWorkflowTemplate['id'][];
}

export const productGroupTypes: ProductGroupType[] = [
  {
    type: 'ai',
    label: '角色群',
    shortLabel: '角色',
    description: '邀请不同角色和模型一起聊天、脑暴、做观点碰撞。',
  },
  {
    type: 'agent',
    label: '专家群',
    shortLabel: '专家',
    description: '邀请具备职责分工的专家群友协作，产出方案、评审和结论。',
  },
  {
    type: 'cli',
    label: '开发群',
    shortLabel: '开发',
    description: '邀请 Codex、Claude Code、OpenCode、KimiCode、PI 等开发成员协作改代码。',
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

export const agentWorkflowEfforts: AgentWorkflowEffortOption[] = [
  {
    value: 'fast',
    label: '快速',
    description: '尽量单成员一次完成，最少阶段，适合小任务和快速答复。',
    recommendedMaxPhases: 2,
    recommendedMaxParallelAgents: 1,
  },
  {
    value: 'standard',
    label: '标准',
    description: '默认协作强度：分析→执行/复审，自动选择 1-3 位成员协作。',
    recommendedMaxPhases: 4,
    recommendedMaxParallelAgents: 3,
  },
  {
    value: 'deep',
    label: '深入',
    description: '允许更多阶段和并行成员，适合复杂任务、多方案比较或大范围审计。',
    recommendedMaxPhases: 6,
    recommendedMaxParallelAgents: 4,
  },
];

export const workflowIntentPresets: AgentWorkflowIntentPreset[] = [
  {
    id: 'smart',
    label: '智能协作',
    description: '默认。由系统根据消息内容自动决定单人快速处理还是多人协作。',
    intent: 'quick',
  },
  {
    id: 'discuss',
    label: '只读讨论',
    description: '多位成员只读分析与讨论，不会修改 workspace。',
    intent: 'discuss',
  },
  {
    id: 'multi_solution',
    label: '多方案对比',
    description: '多位成员各自给出方案，再综合比较。',
    intent: 'multi_solution',
  },
  {
    id: 'review',
    label: '改完复审',
    description: '先实现再复审，复审默认只读。',
    intent: 'review',
  },
  {
    id: 'isolated',
    label: '隔离执行',
    description: '需要写入但又想审慎，第一版默认改为需要计划审批后再执行。',
    intent: 'implement',
  },
];

export const diagnoseFixReviewWorkflow: CLICustomWorkflow = {
  id: 'diagnose_fix_review',
  name: '排查修复复审',
  description: '定位问题根因并完成修复，再由评审者检查修复质量；评审不通过时返回修正。',
  maxLoops: 2,
  stages: [
    {
      id: 'diagnose_fix',
      label: '定位修复',
      role: 'implementer',
      mode: 'write',
      prompt: '请根据用户描述定位问题根因，完成最小必要修复，并运行必要验证。输出中说明根因、改动、验证结果和剩余风险。',
      nextStageId: 'review',
    },
    {
      id: 'review',
      label: '复审',
      role: 'reviewer',
      mode: 'readOnly',
      prompt: '请审查上一阶段修复是否命中根因、是否有副作用、测试是否充分。不要修改文件；如发现阻塞问题，请给出具体修正反馈。',
      reviewDecision: {
        approved: 'done',
        revise: 'revise',
      },
    },
    {
      id: 'revise',
      label: '修正',
      role: 'implementer',
      mode: 'write',
      prompt: '请只针对复审反馈中的阻塞问题做必要修正，并重新运行必要验证。输出修正内容、验证结果和仍需关注的风险。',
      nextStageId: 'review',
    },
  ],
};

export const cliWorkflowTemplates: CLIWorkflowTemplate[] = [
  {
    id: 'quick_response',
    label: '快速响应',
    description: '自动选择一位开发成员直接处理，适合小改动、简单修复和一次性请求。',
    strategy: 'router',
    defaultStages: ['分派', '执行'],
  },
  {
    id: 'diagnose_fix_review',
    label: '排查修复复审',
    description: '定位修复者先排查并改代码，复审者再检查修复质量；适合只描述现象的 bug 修复。',
    strategy: 'review',
    customWorkflow: diagnoseFixReviewWorkflow,
    defaultStages: ['定位修复', '复审', '修正'],
  },
  {
    id: 'implement_review',
    label: '规划实现复审',
    description: '先规划、再实现、再复审；适合新功能、重构和跨模块改动。',
    strategy: 'review',
    defaultStages: ['规划', '实现', '复审', '修正'],
  },
  {
    id: 'review_fix',
    label: '审核修正',
    description: '先审查已有改动或当前代码，再按意见修正；适合 review 后补修。',
    strategy: 'review',
    defaultStages: ['审核', '修正', '验证'],
  },
  {
    id: 'discussion',
    label: '只读讨论',
    description: '只分析方案、风险和排查思路，不改 workspace；适合动手前确认方向。',
    strategy: 'discussion',
    defaultStages: ['分析', '补充', '结论'],
    executionPlan: { isolation: 'copyPerAgent' },
  },
  {
    id: 'multi_solution',
    label: '多人出方案',
    description: '多位开发成员分别给出实现或方案并列展示；适合不确定思路时比较。',
    strategy: 'sequential',
    defaultStages: ['方案 A', '方案 B', '对比'],
  },
  {
    id: 'isolated_race',
    label: '隔离竞赛',
    description: '多位开发成员在独立 worktree 并行实现，最后选择采纳；适合复杂问题或多模型竞赛。',
    strategy: 'race',
    defaultStages: ['并行实现', '结果对比', '用户采纳'],
  },
];

export const cliWorkflowTemplateGroups: CLIWorkflowTemplateGroup[] = [
  {
    id: 'common',
    label: '常用',
    description: '覆盖多数日常开发任务，优先从这里选择。',
    templateIds: ['quick_response', 'diagnose_fix_review', 'implement_review', 'discussion'],
  },
  {
    id: 'advanced',
    label: '高级',
    description: '适合已有 review、多方案比较或隔离并行实现。',
    templateIds: ['review_fix', 'multi_solution', 'isolated_race'],
  },
];

export function getCLIWorkflowTemplatesByGroup(group: CLIWorkflowTemplateGroup): CLIWorkflowTemplate[] {
  return group.templateIds
    .map(id => cliWorkflowTemplates.find(template => template.id === id))
    .filter((template): template is CLIWorkflowTemplate => Boolean(template));
}

/** 展示团队模板的协作方式名称（优先 workflowTemplateId，其次 strategy） */
export function getCLIWorkflowLabel(strategy: CLIStrategy, workflowTemplateId?: string): string {
  if (workflowTemplateId) {
    const byId = cliWorkflowTemplates.find((t) => t.id === workflowTemplateId);
    if (byId) return byId.label;
  }
  const byStrategy = cliWorkflowTemplates.find((t) => t.strategy === strategy);
  if (byStrategy) return byStrategy.label;
  return strategy;
}

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
