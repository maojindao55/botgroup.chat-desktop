/**
 * 群聊类型定义 - 三类群聊严格隔离
 * - ai: AI 群聊（多 LLM 角色闲聊/讨论）
 * - cli: CLI Agent 群（本地代码执行）
 * - agent: Agent 群聊（用户自建 LLM Agent 协作）
 */

export type GroupType = 'ai' | 'cli' | 'agent';

// ============ AI 群聊 ============
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

// ============ CLI Agent 群聊 ============
/** CLI Agent 群的执行策略（用户可见的预设模式） */
export type CLIStrategy =
  | 'sequential'     // 顺序执行：多个 CLI Agent 独立处理同一任务，按顺序节流
  | 'router'         // 智能路由：根据任务类型选择最合适的 CLI Agent
  | 'race'           // 竞争模式：多个 CLI Agent 并行竞争同一任务，默认隔离 worktree
  | 'pipeline'       // 流水线：Agent A 生成代码 → Agent B 审查 → Agent C 测试
  | 'discussion'     // 讨论模式：多 Agent 分轮讨论方案和风险，默认只读
  | 'review'         // 评审模式：生成 → 审查 → 修正
  | 'debate'         // 辩论模式：多 Agent 独立提案 → 互评 → 最终建议
  | 'mapreduce';     // 拆分-并行-汇总：拆任务 → 并行执行 → 合并结果

// ============ 执行计划模型（内部组合） ============
/** 选择哪些 Agent */
export type CLISelectionMode = 'all' | 'router' | 'manual';
/** 协作语义 */
export type CLICollaborationMode = 'independent' | 'pipeline' | 'discussion';
/** 调度方式 */
export type CLIScheduleMode = 'sequential' | 'parallel' | 'staged';
/** 执行环境隔离 */
export type CLIIsolationMode = 'sameWorkspace' | 'readOnly' | 'worktreePerAgent' | 'copyPerAgent';
/** 失败处理策略 */
export type CLIFailurePolicy = 'continue' | 'stopOnFailure' | 'stopOnCancelled';
/** 结果选择策略（race 等多结果场景） */
export type CLIResultPolicy = 'all' | 'firstSuccess' | 'fastest' | 'manualPick';

export interface CLIReviewLoopRoles {
  plannerId?: string;
  implementerId?: string;
  reviewerId?: string;
  maxReviewRounds?: number;
}

/**
 * CLI 执行计划：由若干正交维度组合而成，作为内部统一调度模型。
 * 每个 `CLIStrategy` 预设模式映射到一个默认 plan；用户可覆盖部分字段。
 */
export interface CLIExecutionPlan {
  preset: CLIStrategy;
  selection: CLISelectionMode;
  collaboration: CLICollaborationMode;
  schedule: CLIScheduleMode;
  isolation: CLIIsolationMode;
  failurePolicy: CLIFailurePolicy;
  /** staged 调度的轮次数；undefined 表示由协作模式决定（discussion 默认 2） */
  maxRounds?: number;
  /** 多结果调度时的取舍策略 */
  resultPolicy?: CLIResultPolicy;
}

export type CLISessionPolicy = 'task' | 'workspace' | 'template';

export interface CLIGroup {
  id: string;
  type: 'cli';
  name: string;
  description: string;
  memberIds: string[];                // 引用 ai_members 中的角色 id
  members?: string[];                // 兼容老版本
  workspacePath: string;            // 必填，CLI Agent 执行目录（绝对路径）
  approvalMode: 'auto' | 'ask';    // 执行审批模式
  timeout: number;                  // 单次执行超时(ms)，默认 300000
  showStderr: boolean;              // 是否展示 stderr 输出
  strategy: CLIStrategy;            // 执行策略，默认 sequential
  /** 用户选择的协作方式模板 id，用于区分共用同一 strategy 的产品模板 */
  workflowTemplateId?: string;
  coordinatorPrompt?: string;       // 路由/评判提示词（router/race 模式用）
  /** CLI tool session 复用策略，缺省为 task */
  sessionPolicy?: CLISessionPolicy;
  /** 规划实现复审模式的显式角色分工 */
  reviewLoopRoles?: CLIReviewLoopRoles;
  /** 执行细节：覆盖预设 plan 的部分字段；老数据可缺省 */
  executionPlan?: Partial<CLIExecutionPlan>;
}

/**
 * 把 `CLIStrategy` 预设模式映射为内部 `CLIExecutionPlan`。
 * 用户的 `group.executionPlan` 可覆盖部分字段（高级用法）。
 */
export function resolveExecutionPlan(
  group: Pick<CLIGroup, 'strategy' | 'executionPlan'>,
  overrides?: Partial<CLIExecutionPlan>,
): CLIExecutionPlan {
  const preset = group.strategy ?? 'sequential';
  const base: CLIExecutionPlan = (() => {
    switch (preset) {
      case 'router':
        return {
          preset,
          selection: 'router',
          collaboration: 'independent',
          schedule: 'sequential',
          isolation: 'sameWorkspace',
          failurePolicy: 'stopOnFailure',
        };
      case 'sequential':
        return {
          preset,
          selection: 'all',
          collaboration: 'independent',
          schedule: 'sequential',
          isolation: 'sameWorkspace',
          failurePolicy: 'continue',
        };
      case 'pipeline':
        return {
          preset,
          selection: 'all',
          collaboration: 'pipeline',
          schedule: 'sequential',
          isolation: 'sameWorkspace',
          failurePolicy: 'continue',
        };
      case 'race':
        return {
          preset,
          selection: 'all',
          collaboration: 'independent',
          schedule: 'parallel',
          isolation: 'worktreePerAgent',
          failurePolicy: 'continue',
          resultPolicy: 'all',
        };
      case 'discussion':
        return {
          preset,
          selection: 'all',
          collaboration: 'discussion',
          schedule: 'staged',
          isolation: 'copyPerAgent',
          failurePolicy: 'continue',
          maxRounds: 2,
        };
      case 'review':
        // V3 planned: 生成→审查→修正. Currently maps to pipeline semantics.
        return {
          preset,
          selection: 'all',
          collaboration: 'pipeline',
          schedule: 'sequential',
          isolation: 'sameWorkspace',
          failurePolicy: 'continue',
        };
      case 'debate':
        // V3 planned: 多 Agent 独立→互评→最终建议. Currently maps to discussion with 3 rounds.
        return {
          preset,
          selection: 'all',
          collaboration: 'discussion',
          schedule: 'staged',
          isolation: 'copyPerAgent',
          failurePolicy: 'continue',
          maxRounds: 3,
          resultPolicy: 'manualPick',
        };
      case 'mapreduce':
        // V3 planned: 拆分→并行→汇总. Currently maps to parallel-all (no task splitting).
        return {
          preset,
          selection: 'all',
          collaboration: 'independent',
          schedule: 'parallel',
          isolation: 'sameWorkspace',
          failurePolicy: 'continue',
          resultPolicy: 'all',
        };
      default:
        // 穷尽性兜底：未知预设按 sequential 处理
        return {
          preset: 'sequential',
          selection: 'all',
          collaboration: 'independent',
          schedule: 'sequential',
          isolation: 'sameWorkspace',
          failurePolicy: 'continue',
        };
    }
  })();
  const safeExecutionPlan = { ...(group.executionPlan || {}) };
  delete safeExecutionPlan.selection;
  delete safeExecutionPlan.collaboration;
  delete safeExecutionPlan.schedule;
  delete safeExecutionPlan.isolation;
  delete safeExecutionPlan.preset;

  return {
    ...base,
    ...safeExecutionPlan,
    ...(overrides || {}),
    preset, // preset 不允许被覆盖，避免 UI 与内部状态错位
  };
}

// ============ Agent 群聊 ============

/** 每个 Agent 的 LLM 连接配置（PR4：密钥统一在 Provider 管理页） */
export interface AgentLLMConfig {
  providerId: string;
  model: string;
}

/** Agent 可用的内置工具 */
export interface AgentTool {
  name: string;
  description: string;
  enabled: boolean;
}

/** Agent 群的单个成员 */
export interface AgentMember {
  id: string;
  name: string;
  avatar?: string;
  role: string;
  systemPrompt: string;
  providerId: string;
  model: string;
  /** @deprecated 仅兼容旧数据，新代码勿用 */
  llm?: AgentLLMConfig & { baseURL?: string; apiKey?: string };
  tools: AgentTool[];
  maxTurns: number;
  temperature: number;
}

/** Agent 群的执行策略 */
export type AgentStrategy =
  | 'sequential'     // 顺序执行：按成员顺序依次执行，后者看到前者输出
  | 'react'          // ReAct：协调者分析→分派→执行→判断→循环
  | 'discussion'     // 全员讨论：所有Agent并行回复，再由协调者总结
  | 'router'         // 意图路由：根据用户输入智能选择1-N个Agent响应
  | 'pipeline'       // 流水线：按角色分工，产出作为下一环节输入
  | 'debate'         // 辩论：多 Agent 独立回答→互评→最终裁决
  | 'mapreduce'      // 拆分-并行-汇总：自动拆任务→并行执行→合并结果
  | 'supervisor';    // 监督者：一个 Agent 监督，可多轮分派+反馈修正

export interface AgentGroup {
  id: string;
  type: 'agent';
  name: string;
  description: string;
  memberIds: string[];              // 引用 ai_members 中的角色 id
  agents?: AgentMember[];            // 兼容老版本
  strategy: AgentStrategy;          // 执行策略
  coordinatorPrompt?: string;       // 协调者提示词（react/router/discussion 模式用）
  maxRounds: number;                // 多轮协作最大轮数，默认 3
}

// 联合类型
export type Group = AIGroup | CLIGroup | AgentGroup;

// ============ 预设群聊 ============
export const defaultGroups: Group[] = [];
