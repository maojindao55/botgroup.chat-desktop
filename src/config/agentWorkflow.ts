/**
 * Agent 群聊动态协作 DSL
 *
 * 这是 Agent 群唯一执行模型。Planner 输出 AgentWorkflowPlan，
 * Runner 按 phase 执行。所有类型与纯函数都集中在本文件中。
 */
import type { AgentCapability } from './aiMembers';

export type AgentWorkflowEffort = 'fast' | 'standard' | 'deep';

export interface AgentWorkflowDefaults {
  effort: AgentWorkflowEffort;
  maxPhases: number;
  maxParallelAgents: number;
  alwaysShowPlan: boolean;
}

export type AgentWorkflowIntent =
  | 'quick'
  | 'discuss'
  | 'implement'
  | 'review'
  | 'multi_solution'
  | 'audit'
  | 'custom';

export type AgentWorkflowRiskLevel = 'low' | 'medium' | 'high';
export type AgentWorkflowPhaseMode = 'readOnly' | 'write' | 'review' | 'verifier';
export type AgentWorkflowSchedule = 'single' | 'parallel' | 'sequential';
export type AgentWorkflowOutputPolicy = 'summary' | 'full' | 'findings' | 'diff';

export type AgentWorkflowSelection =
  | { type: 'auto'; count?: number; capabilities?: AgentCapability[] }
  | { type: 'specific'; agentIds: string[] };

export interface AgentWorkflowRetryPolicy {
  maxAttempts: number;
  feedbackFromPhaseId?: string;
}

export interface AgentWorkflowPhase {
  id: string;
  label: string;
  mode: AgentWorkflowPhaseMode;
  schedule: AgentWorkflowSchedule;
  agentSelection: AgentWorkflowSelection;
  prompt: string;
  dependsOn?: string[];
  outputPolicy?: AgentWorkflowOutputPolicy;
  onFailure?: 'stop' | 'continue' | 'ask';
  retry?: AgentWorkflowRetryPolicy;
}

export interface AgentWorkflowPlan {
  version: 1;
  title: string;
  intent: AgentWorkflowIntent;
  riskLevel: AgentWorkflowRiskLevel;
  requiresApproval: boolean;
  explanation: string;
  phases: AgentWorkflowPhase[];
  /** 实际产生该计划的 planner 标识（仅 LLM planner 设置；rule planner 不设） */
  plannerModel?: string;
  plannerProviderId?: string;
}

export type AgentWorkflowRunStatus =
  | 'planned'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';
export type AgentWorkflowPhaseStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'cancelled';

export interface AgentWorkflowAgentOutput {
  agentId: string;
  agentName: string;
  content: string;
  isError?: boolean;
  agentTaskId?: string;
  adapter?: string;
}

export interface AgentWorkflowPhaseAttempt {
  attemptNumber: number;
  status: AgentWorkflowPhaseStatus;
  outputs: AgentWorkflowAgentOutput[];
  summary?: string;
  error?: string;
  startedAt?: number;
  endedAt?: number;
  feedbackUsed?: string;
}

export interface AgentWorkflowPhaseState {
  phaseId: string;
  status: AgentWorkflowPhaseStatus;
  selectedAgentIds: string[];
  outputs: AgentWorkflowAgentOutput[];
  summary?: string;
  error?: string;
  startedAt?: number;
  endedAt?: number;
  attempts?: number;
  attemptHistory?: AgentWorkflowPhaseAttempt[];
  verdict?: 'pass' | 'fail';
  verdictReasoning?: string;
}

export interface AgentWorkflowRun {
  id: string;
  plan: AgentWorkflowPlan;
  status: AgentWorkflowRunStatus;
  phaseStates: Record<string, AgentWorkflowPhaseState>;
  createdAt: number;
  updatedAt: number;
}

/** 默认 workflow defaults，用于新建 Agent 群 */
export function createDefaultAgentWorkflowDefaults(): AgentWorkflowDefaults {
  return {
    effort: 'standard',
    maxPhases: 5,
    maxParallelAgents: 3,
    alwaysShowPlan: false,
  };
}

let __runIdCounter = 0;
export function newAgentWorkflowRunId(): string {
  __runIdCounter += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `wfrun_${Date.now().toString(36)}_${__runIdCounter}_${rand}`;
}

export function newAgentWorkflowRun(plan: AgentWorkflowPlan): AgentWorkflowRun {
  const now = Date.now();
  const phaseStates: Record<string, AgentWorkflowPhaseState> = {};
  for (const phase of plan.phases) {
    phaseStates[phase.id] = {
      phaseId: phase.id,
      status: 'pending',
      selectedAgentIds: [],
      outputs: [],
    };
  }
  return {
    id: newAgentWorkflowRunId(),
    plan,
    status: 'planned',
    phaseStates,
    createdAt: now,
    updatedAt: now,
  };
}

export interface ValidateAgentWorkflowPlanOptions {
  maxPhases?: number;
  maxParallelAgents?: number;
}

export interface ValidateAgentWorkflowPlanResult {
  ok: boolean;
  errors: string[];
}

/** 校验 plan 结构是否合法。返回 errors 列表（空表示合法）。 */
export function validateAgentWorkflowPlan(
  plan: AgentWorkflowPlan | null | undefined,
  availableAgentIds: string[],
  options: ValidateAgentWorkflowPlanOptions = {},
): ValidateAgentWorkflowPlanResult {
  const errors: string[] = [];
  if (!plan || typeof plan !== 'object') {
    return { ok: false, errors: ['plan is required'] };
  }
  if (plan.version !== 1) {
    errors.push(`unsupported version ${plan.version}`);
  }
  if (!Array.isArray(plan.phases) || plan.phases.length === 0) {
    errors.push('plan must include at least one phase');
    return { ok: false, errors };
  }
  const maxPhases = options.maxPhases ?? 10;
  if (plan.phases.length > maxPhases) {
    errors.push(`too many phases: ${plan.phases.length} > ${maxPhases}`);
  }

  const seenIds = new Set<string>();
  const availableSet = new Set(availableAgentIds);

  for (const phase of plan.phases) {
    if (!phase.id) {
      errors.push('phase id is required');
      continue;
    }
    if (seenIds.has(phase.id)) {
      errors.push(`duplicate phase id: ${phase.id}`);
      continue;
    }
    seenIds.add(phase.id);
    if (!phase.label) errors.push(`phase ${phase.id}: label required`);
    if (!phase.prompt) errors.push(`phase ${phase.id}: prompt required`);
    if (!['readOnly', 'write', 'review', 'verifier'].includes(phase.mode)) {
      errors.push(`phase ${phase.id}: invalid mode ${phase.mode}`);
    }
    if (phase.mode === 'verifier') {
      if (!phase.dependsOn || phase.dependsOn.length === 0) {
        errors.push(`phase ${phase.id}: verifier mode requires dependsOn`);
      }
      if (phase.schedule !== 'single') {
        errors.push(`phase ${phase.id}: verifier mode requires schedule 'single'`);
      }
      if (
        phase.agentSelection?.type === 'specific' &&
        phase.agentSelection.agentIds.length > 1
      ) {
        errors.push(`phase ${phase.id}: verifier mode requires a single agent`);
      }
    }
    if (!['single', 'parallel', 'sequential'].includes(phase.schedule)) {
      errors.push(`phase ${phase.id}: invalid schedule ${phase.schedule}`);
    }
    if (phase.dependsOn) {
      for (const dep of phase.dependsOn) {
        if (!seenIds.has(dep)) {
          errors.push(`phase ${phase.id}: unknown dependency ${dep}`);
        }
      }
    }
    if (phase.agentSelection?.type === 'specific') {
      const ids = phase.agentSelection.agentIds;
      if (!ids || ids.length === 0) {
        errors.push(`phase ${phase.id}: specific selection requires agentIds`);
      } else {
        for (const id of ids) {
          if (!availableSet.has(id)) {
            errors.push(`phase ${phase.id}: unknown agent ${id}`);
          }
        }
      }
    }
    const maxParallel = options.maxParallelAgents ?? 5;
    if (
      phase.schedule === 'parallel' &&
      phase.agentSelection?.type === 'auto' &&
      typeof phase.agentSelection.count === 'number' &&
      phase.agentSelection.count > maxParallel
    ) {
      errors.push(`phase ${phase.id}: parallel count ${phase.agentSelection.count} > ${maxParallel}`);
    }
  }

  return { ok: errors.length === 0, errors };
}

/** 输出 plan 摘要文本，用于日志/UI fallback */
export function summarizeWorkflowPlan(plan: AgentWorkflowPlan): string {
  const lines: string[] = [];
  lines.push(`${plan.title} [${plan.intent}, ${plan.riskLevel}]`);
  if (plan.explanation) lines.push(plan.explanation);
  plan.phases.forEach((phase, idx) => {
    const sched = phase.schedule === 'single' ? '' : ` ${phase.schedule}`;
    lines.push(`${idx + 1}. ${phase.label} (${phase.mode}${sched})`);
  });
  return lines.join('\n');
}

/** 计划是否会写入 workspace */
export function planRequiresWorkspaceWrite(plan: AgentWorkflowPlan): boolean {
  return plan.phases.some((p) => p.mode === 'write');
}

/** 计划是否需要审批，以及原因 */
export function getWorkflowPlanApprovalReason(plan: AgentWorkflowPlan): string | null {
  if (planRequiresWorkspaceWrite(plan)) {
    return 'plan will modify workspace';
  }
  if (plan.riskLevel === 'high') {
    return 'plan marked as high risk';
  }
  if (plan.requiresApproval) {
    return 'planner requested approval';
  }
  return null;
}
