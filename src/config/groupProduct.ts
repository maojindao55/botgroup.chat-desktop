import type { AgentStrategy, CLICustomWorkflow, CLIExecutionPlan, CLIStrategy, GroupType } from './groups';

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

export interface AgentWorkflowTemplate {
  id: 'expert_consult' | 'proposal' | 'decision_review' | 'relay_edit' | 'auto_delegate';
  label: string;
  description: string;
  strategy: AgentStrategy;
  maxRounds: number;
  coordinatorPrompt?: string;
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

export const agentWorkflowTemplates: AgentWorkflowTemplate[] = [
  {
    id: 'expert_consult',
    label: '专家会诊',
    description: '多位专家群友独立分析同一问题，再形成综合意见。',
    strategy: 'discussion',
    maxRounds: 2,
    coordinatorPrompt: '请组织专家群友围绕用户问题分别给出判断、风险和建议，最后汇总成清晰结论。',
  },
  {
    id: 'proposal',
    label: '方案产出',
    description: '按调研、起草、审查、定稿的方式协作产出方案。',
    strategy: 'pipeline',
    maxRounds: 3,
  },
  {
    id: 'decision_review',
    label: '评审决策',
    description: '从多角色视角提出收益、风险、约束和最终建议。',
    strategy: 'debate',
    maxRounds: 3,
    coordinatorPrompt: '请让不同专家群友先提出独立意见，再互相指出风险，最后给出可执行建议。',
  },
  {
    id: 'relay_edit',
    label: '接力修改',
    description: '一个专家起草，一个专家审核，一个专家修订。',
    strategy: 'pipeline',
    maxRounds: 3,
  },
  {
    id: 'auto_delegate',
    label: '自动处理',
    description: '由协调者多轮分派任务，适合目标明确但步骤未定的问题。',
    strategy: 'react',
    maxRounds: 4,
    coordinatorPrompt: '请作为群内协调者，根据用户目标分派下一位专家群友处理，并在任务完成时给出总结。',
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
    description: '自动选择一位开发成员处理当前代码任务。',
    strategy: 'router',
    defaultStages: ['分派', '执行'],
  },
  {
    id: 'implement_review',
    label: '规划实现复审',
    description: '规划者先拆解方案，实现者按方案改代码；评审不通过时继续修正并复审。',
    strategy: 'review',
    defaultStages: ['规划', '实现', '复审', '修正'],
  },
  {
    id: 'diagnose_fix_review',
    label: '排查修复复审',
    description: '一位开发成员定位并修复问题，另一位开发成员复审；不通过则按反馈修正。',
    strategy: 'review',
    customWorkflow: diagnoseFixReviewWorkflow,
    defaultStages: ['定位修复', '复审', '修正'],
  },
  {
    id: 'review_fix',
    label: '审核修正',
    description: '先审查现有改动，再让开发成员按意见修正。',
    strategy: 'review',
    defaultStages: ['审核', '修正', '验证'],
  },
  {
    id: 'multi_solution',
    label: '多人出方案',
    description: '多个开发成员分别处理同一任务，结果在群里并列展示。',
    strategy: 'sequential',
    defaultStages: ['方案 A', '方案 B', '对比'],
  },
  {
    id: 'isolated_race',
    label: '隔离竞赛',
    description: '多个开发成员在独立 worktree 中并行实现，用户选择采纳。',
    strategy: 'race',
    defaultStages: ['并行实现', '结果对比', '用户采纳'],
  },
  {
    id: 'discussion',
    label: '只读讨论',
    description: '只分析代码方案和风险，不要求开发成员修改文件。',
    strategy: 'discussion',
    defaultStages: ['分析', '补充', '结论'],
    executionPlan: { isolation: 'copyPerAgent' },
  },
];

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
