import type { AIMember } from '@/config/aiMembers';
import type {
  AgentWorkflowIntent,
  AgentWorkflowPhase,
  AgentWorkflowPlan,
} from '@/config/agentWorkflow';
import { resolveAgentSelection } from './agentWorkflowSelection';
import type { SelectionRole, SelectionStrategy } from './agentWorkflowSelection';

export interface TemplateContext {
  members: AIMember[];
  workspaceReady: boolean;
  maxParallel: number;
  maxPhases: number;
  locale?: string;
  t?: (key: string, options?: Record<string, unknown>) => string;
}

const PREFIX = 'chat:agentWorkflow.planner';

function tr(ctx: TemplateContext, key: string, opts?: Record<string, unknown>): string {
  if (ctx.t) {
    const v = ctx.t(key, opts);
    if (typeof v === 'string' && v !== key) return v;
  }
  return key;
}

function specific(agentIds: string[]): AgentWorkflowPhase['agentSelection'] {
  return { type: 'specific', agentIds };
}

function pick(ctx: TemplateContext, strategy: SelectionStrategy, exclude?: string[]): string[] {
  return resolveAgentSelection(strategy, ctx.members, { maxParallel: ctx.maxParallel, exclude });
}

// ---- T1 quick ----
function buildQuick(ctx: TemplateContext): AgentWorkflowPlan {
  const agentIds = pick(ctx, { kind: 'first' });
  return {
    version: 1,
    title: tr(ctx, `${PREFIX}.intents.quick.title`),
    intent: 'quick',
    riskLevel: 'low',
    requiresApproval: false,
    explanation: tr(ctx, `${PREFIX}.intents.quick.explanation`),
    phases: [
      {
        id: 'answer',
        label: tr(ctx, `${PREFIX}.phases.answer.label`),
        mode: 'readOnly',
        schedule: 'single',
        agentSelection: specific(agentIds),
        prompt: tr(ctx, `${PREFIX}.phases.answer.prompt`),
        outputPolicy: 'full',
        onFailure: 'continue',
      },
    ],
  };
}

function synthesizePhase(ctx: TemplateContext, dependsOn: string, exclude?: string[]): AgentWorkflowPhase {
  const synthIds = pick(ctx, { kind: 'byRole', role: 'summarizer' as SelectionRole }, exclude);
  return {
    id: 'synthesize',
    label: tr(ctx, `${PREFIX}.phases.synthesize.label`),
    mode: 'readOnly',
    schedule: 'single',
    agentSelection: specific(synthIds),
    prompt: tr(ctx, `${PREFIX}.phases.synthesize.prompt`),
    dependsOn: [dependsOn],
    outputPolicy: 'full',
    onFailure: 'stop',
  };
}

// ---- T2 discuss ----
function buildDiscuss(ctx: TemplateContext): AgentWorkflowPlan {
  const consultIds = pick(ctx, { kind: 'count', n: ctx.members.length });
  return {
    version: 1,
    title: tr(ctx, `${PREFIX}.intents.discuss.title`),
    intent: 'discuss',
    riskLevel: 'low',
    requiresApproval: false,
    explanation: tr(ctx, `${PREFIX}.intents.discuss.explanation`),
    phases: [
      {
        id: 'consult',
        label: tr(ctx, `${PREFIX}.phases.consult.label`),
        mode: 'readOnly',
        schedule: 'parallel',
        agentSelection: specific(consultIds),
        prompt: tr(ctx, `${PREFIX}.phases.consult.prompt`),
        outputPolicy: 'summary',
        onFailure: 'continue',
      },
      synthesizePhase(ctx, 'consult', consultIds),
    ],
  };
}

// ---- T3 multi_solution ----
function buildMultiSolution(ctx: TemplateContext): AgentWorkflowPlan {
  const n = Math.min(ctx.members.length, ctx.maxParallel, 3);
  const proposeIds = pick(ctx, { kind: 'count', n });
  return {
    version: 1,
    title: tr(ctx, `${PREFIX}.intents.multi_solution.title`),
    intent: 'multi_solution',
    riskLevel: 'low',
    requiresApproval: false,
    explanation: tr(ctx, `${PREFIX}.intents.multi_solution.explanation`),
    phases: [
      {
        id: 'propose',
        label: tr(ctx, `${PREFIX}.phases.propose.label`),
        mode: 'readOnly',
        schedule: 'parallel',
        agentSelection: specific(proposeIds),
        prompt: tr(ctx, `${PREFIX}.phases.propose.prompt`),
        outputPolicy: 'full',
        onFailure: 'continue',
      },
      {
        id: 'compare',
        label: tr(ctx, `${PREFIX}.phases.compare.label`),
        mode: 'readOnly',
        schedule: 'single',
        agentSelection: specific(pick(ctx, { kind: 'byRole', role: 'summarizer' as SelectionRole })),
        prompt: tr(ctx, `${PREFIX}.phases.compare.prompt`),
        dependsOn: ['propose'],
        outputPolicy: 'full',
        onFailure: 'stop',
      },
    ],
  };
}

// ---- T4 implement ----
function buildImplement(ctx: TemplateContext): AgentWorkflowPlan {
  const implIds = pick(ctx, { kind: 'byRole', role: 'implementer' as SelectionRole });
  return {
    version: 1,
    title: tr(ctx, `${PREFIX}.intents.implement.title`),
    intent: 'implement',
    riskLevel: 'medium',
    requiresApproval: true,
    explanation: tr(ctx, `${PREFIX}.intents.implement.explanation`),
    phases: [
      {
        id: 'implement',
        label: tr(ctx, `${PREFIX}.phases.implement.label`),
        mode: 'write',
        schedule: 'single',
        agentSelection: specific(implIds),
        prompt: tr(ctx, `${PREFIX}.phases.implement.prompt`),
        outputPolicy: 'diff',
        onFailure: 'stop',
      },
    ],
  };
}

// ---- T5 review (implement -> verifier loop) ----
function buildReview(ctx: TemplateContext): AgentWorkflowPlan {
  const implIds = pick(ctx, { kind: 'byRole', role: 'implementer' as SelectionRole });
  const reviewerIds = pick(ctx, { kind: 'byRole', role: 'reviewer' as SelectionRole }, implIds);
  return {
    version: 1,
    title: tr(ctx, `${PREFIX}.intents.review.title`),
    intent: 'review',
    riskLevel: 'medium',
    requiresApproval: true,
    explanation: tr(ctx, `${PREFIX}.intents.review.explanation`),
    phases: [
      {
        id: 'implement',
        label: tr(ctx, `${PREFIX}.phases.implement.label`),
        mode: 'write',
        schedule: 'single',
        agentSelection: specific(implIds),
        prompt: tr(ctx, `${PREFIX}.phases.implement.prompt`),
        outputPolicy: 'diff',
        onFailure: 'stop',
        retry: { maxAttempts: 2 },
      },
      {
        id: 'verify',
        label: tr(ctx, `${PREFIX}.phases.verify.label`),
        mode: 'verifier',
        schedule: 'single',
        agentSelection: specific(reviewerIds),
        prompt: tr(ctx, `${PREFIX}.phases.verify.prompt`),
        dependsOn: ['implement'],
        outputPolicy: 'findings',
        onFailure: 'stop',
      },
    ],
  };
}

// ---- T6 audit ----
function buildAudit(ctx: TemplateContext): AgentWorkflowPlan {
  const auditIds = pick(ctx, { kind: 'all' });
  return {
    version: 1,
    title: tr(ctx, `${PREFIX}.intents.audit.title`),
    intent: 'audit',
    riskLevel: 'low',
    requiresApproval: false,
    explanation: tr(ctx, `${PREFIX}.intents.audit.explanation`),
    phases: [
      {
        id: 'audit',
        label: tr(ctx, `${PREFIX}.phases.audit.label`),
        mode: 'readOnly',
        schedule: 'parallel',
        agentSelection: specific(auditIds),
        prompt: tr(ctx, `${PREFIX}.phases.audit.prompt`),
        outputPolicy: 'findings',
        onFailure: 'continue',
      },
      synthesizePhase(ctx, 'audit'),
    ],
  };
}

export const templateBuilders: Record<AgentWorkflowIntent, (ctx: TemplateContext) => AgentWorkflowPlan> = {
  quick: buildQuick,
  discuss: buildDiscuss,
  multi_solution: buildMultiSolution,
  implement: buildImplement,
  review: buildReview,
  audit: buildAudit,
  // rule planner 从不产出 custom（LLM-only intent）；映射到 quick 作为安全 fallback
  custom: buildQuick,
};
