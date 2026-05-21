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
  members: string[];                // 引用 aiCharacters 中 runtime !== 'cli' 的角色 id
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
  | 'discussion';    // 讨论模式：多 Agent 分轮讨论方案和风险，默认只读

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

export interface CLIGroup {
  id: string;
  type: 'cli';
  name: string;
  description: string;
  members: string[];                // 引用 aiCharacters 中 runtime === 'cli' 的角色 id
  workspacePath: string;            // 必填，CLI Agent 执行目录（绝对路径）
  approvalMode: 'auto' | 'ask';    // 执行审批模式
  timeout: number;                  // 单次执行超时(ms)，默认 300000
  showStderr: boolean;              // 是否展示 stderr 输出
  strategy: CLIStrategy;            // 执行策略，默认 sequential
  coordinatorPrompt?: string;       // 路由/评判提示词（router/race 模式用）
  /** 高级配置：覆盖预设 plan 的部分字段；老数据可缺省 */
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
          isolation: 'readOnly',
          failurePolicy: 'continue',
          maxRounds: 2,
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

  return {
    ...base,
    ...(group.executionPlan || {}),
    ...(overrides || {}),
    preset, // preset 不允许被覆盖，避免 UI 与内部状态错位
  };
}

// ============ Agent 群聊 ============

/** 每个 Agent 的 LLM 连接配置 */
export interface AgentLLMConfig {
  baseURL: string;                  // API 地址，如 https://api.deepseek.com/v1
  apiKey: string;                   // API Key（环境变量名或直接值）
  model: string;                    // 模型名，如 deepseek-chat
}

/** Agent 可用的内置工具 */
export interface AgentTool {
  name: string;                     // 工具标识：web_search / code_interpreter / http_request / memory
  description: string;              // 工具描述（用于 function calling）
  enabled: boolean;                 // 是否启用
}

/** Agent 群的单个成员 */
export interface AgentMember {
  id: string;                       // 唯一标识
  name: string;                     // Agent 名称，如 "产品经理"
  avatar?: string;                  // 头像 URL
  role: string;                     // 角色定位简述
  systemPrompt: string;             // 完整系统提示词
  llm: AgentLLMConfig;              // LLM 配置
  tools: AgentTool[];               // 可用工具列表
  maxTurns: number;                 // 单次最大思考轮数（防止循环），默认 5
  temperature: number;              // 温度，默认 0.7
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
  agents: AgentMember[];            // Agent 成员列表
  strategy: AgentStrategy;          // 执行策略
  coordinatorPrompt?: string;       // 协调者提示词（react/router/discussion 模式用）
  maxRounds: number;                // 多轮协作最大轮数，默认 3
}

// 联合类型
export type Group = AIGroup | CLIGroup | AgentGroup;

// ============ 预设群聊 ============
export const defaultGroups: Group[] = [
  {
    id: 'group1',
    type: 'ai',
    name: '硅碳生命体交流群',
    description: '群消息关注度权重："user"的最新消息>其他成员最新消息>"user"的历史消息>其他成员历史消息>',
    members: ['ai8', 'ai6', 'ai7', 'ai9', 'ai10', 'ai5'],
    isGroupDiscussionMode: false,
    schedulerStrategy: 'tag',
  },
  {
    id: 'group-coding',
    type: 'cli',
    name: 'AI Coding 工作组',
    description: '多 CLI Agent 协作编码：你给需求，Agent 直接在本地 workspace 里执行修改。请先在群设置里指定 workspacePath。',
    members: ['cli-codex', 'cli-claude-code', 'cli-opencode'],
    workspacePath: '',
    approvalMode: 'auto',
    timeout: 300000,
    showStderr: true,
    strategy: 'sequential',
  },
  {
    id: 'group-agent-demo',
    type: 'agent',
    name: 'Agent 协作示例群',
    description: '自定义 Agent 群示例：产品经理 + 架构师协作讨论方案',
    agents: [
      {
        id: 'agent-pm',
        name: '产品经理',
        role: '负责需求分析、方案评审、用户体验把控',
        systemPrompt: '你是一位资深产品经理，擅长需求分析和方案评审。你会从用户价值、可行性、优先级等角度分析问题，给出清晰的产品建议。回复简洁有条理。',
        llm: {
          baseURL: 'https://api.deepseek.com/v1',
          apiKey: 'DEEPSEEK_API_KEY',
          model: 'deepseek-chat',
        },
        tools: [],
        maxTurns: 3,
        temperature: 0.7,
      },
      {
        id: 'agent-architect',
        name: '架构师',
        role: '负责技术方案设计、架构评审、技术选型',
        systemPrompt: '你是一位资深软件架构师，擅长系统设计和技术选型。你会从可扩展性、性能、维护成本等角度分析技术方案，给出架构建议。回复专业且有深度。',
        llm: {
          baseURL: 'https://api.deepseek.com/v1',
          apiKey: 'DEEPSEEK_API_KEY',
          model: 'deepseek-chat',
        },
        tools: [],
        maxTurns: 3,
        temperature: 0.5,
      },
    ],
    strategy: 'sequential',
    maxRounds: 3,
  },
];
