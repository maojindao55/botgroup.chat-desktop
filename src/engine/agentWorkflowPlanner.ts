/**
 * Rule-based Agent Workflow Planner
 *
 * Given a user message + group context, produce a deterministic
 * AgentWorkflowPlan that the runner can execute. This is the first
 * (and currently only) planner; an LLM-backed planner is reserved
 * for a future PR but must emit the same DSL.
 *
 * Design rules:
 *   - Always conservative: writes default to requiresApproval.
 *   - No workspace -> downgrade write intents to readOnly + warning.
 *   - Parallelism never exceeds group.workflowDefaults.maxParallelAgents.
 *   - Total phases never exceed group.workflowDefaults.maxPhases.
 *   - Pure function: same input -> same output (modulo phase id slugs).
 */
import type { AgentGroup } from '@/config/groups';
import type { AIMember, AgentCapability } from '@/config/aiMembers';
import {
  createDefaultAgentWorkflowDefaults,
  type AgentWorkflowPlan,
  type AgentWorkflowPhase,
  type AgentWorkflowIntent,
  type AgentWorkflowRiskLevel,
} from '@/config/agentWorkflow';
import type { LLMPlannerOptions } from './agentWorkflowPlanner.llm';

export interface AgentWorkflowPlannerInput {
  group: AgentGroup;
  members: AIMember[];
  userMessage: string;
  history?: string;
  attachmentSummary?: string;
  intentHint?: AgentWorkflowIntent;
  mentionedAgentIds?: string[];
  /** Natural-language instruction used when user edits/regenerates a pending plan. */
  revisionInstruction?: string;
  workspaceReady: boolean;
  /**
   * Optional i18next-style translator used for user-facing plan content
   * (titles, explanations, phase labels/prompts, warnings). Falls back to
   * English defaults so non-React callers (tests) keep working.
   */
  t?: (key: string, options?: Record<string, unknown>) => string;
}

export interface AgentWorkflowPlannerResult {
  plan: AgentWorkflowPlan;
  warnings: string[];
}

// ---------- i18n ----------

const PLANNER_FALLBACK_STRINGS: Record<string, string> = {
  'chat:agentWorkflow.planner.emptyTitle': 'No-op',
  'chat:agentWorkflow.planner.emptyExplanation': 'No eligible members found.',
  'chat:agentWorkflow.planner.warnings.noMembers': 'No agent members available in this group.',
  'chat:agentWorkflow.planner.warnings.revisionReadOnly':
    'Revision requested read-only execution; using discussion plan instead of write workflow.',
  'chat:agentWorkflow.planner.warnings.noWorkspace':
    'No workspace configured; downgrading to read-only discussion.',
  'chat:agentWorkflow.planner.warnings.phaseTruncated':
    'Plan truncated to {{count}} phase(s) by group.workflowDefaults.maxPhases.',
  'chat:agentWorkflow.planner.warnings.phaseRevisionReadOnly':
    'Phase "{{label}}" downgraded to read-only by revision instruction.',
  'chat:agentWorkflow.planner.warnings.phaseNoWorkspace':
    'Phase "{{label}}" requires workspace; downgraded to read-only.',
  'chat:agentWorkflow.planner.warnings.phaseParallelWrite':
    'Phase "{{label}}" cannot run write in parallel; serialized to single.',
  'chat:agentWorkflow.planner.warnings.llmFallback':
    'LLM planner ({{model}}) failed, using rule planner: {{error}}',

  'chat:agentWorkflow.planner.intents.discuss.title': 'Parallel discussion',
  'chat:agentWorkflow.planner.intents.discuss.explanation':
    'Members analyze the question in parallel, then we synthesize their views.',
  'chat:agentWorkflow.planner.intents.multi_solution.title': 'Parallel proposals',
  'chat:agentWorkflow.planner.intents.multi_solution.explanation':
    'Each member proposes one solution; the last phase reviews and recommends.',
  'chat:agentWorkflow.planner.intents.implement.title': 'Plan -> Implement -> Review',
  'chat:agentWorkflow.planner.intents.implement.explanation':
    'Plan changes, implement them in the workspace, then review the diff.',
  'chat:agentWorkflow.planner.intents.review.title': 'Review current changes',
  'chat:agentWorkflow.planner.intents.review.explanation':
    'One or more reviewers inspect the requested target read-only.',
  'chat:agentWorkflow.planner.intents.audit.title': 'Audit (parallel) + synthesize',
  'chat:agentWorkflow.planner.intents.audit.explanation':
    'Auditors inspect different angles in parallel; a synthesizer summarizes findings.',
  'chat:agentWorkflow.planner.intents.quick.title': 'Quick answer',
  'chat:agentWorkflow.planner.intents.quick.explanation':
    'A single agent answers the question directly.',

  'chat:agentWorkflow.planner.phases.analyze.label': 'Analyze',
  'chat:agentWorkflow.planner.phases.analyze.prompt':
    'Analyze the user request and share your perspective. Do not modify any files.',
  'chat:agentWorkflow.planner.phases.synthesize.label': 'Synthesize',
  'chat:agentWorkflow.planner.phases.synthesize.prompt':
    'Synthesize the previous perspectives into a concise actionable answer.',
  'chat:agentWorkflow.planner.phases.propose.label': 'Propose',
  'chat:agentWorkflow.planner.phases.propose.prompt':
    'Independently propose one solution to the user request. Do not modify files.',
  'chat:agentWorkflow.planner.phases.reviewRecommend.label': 'Review & Recommend',
  'chat:agentWorkflow.planner.phases.reviewRecommend.prompt':
    'Compare the proposals, list trade-offs, and recommend one.',
  'chat:agentWorkflow.planner.phases.plan.label': 'Plan',
  'chat:agentWorkflow.planner.phases.plan.prompt':
    'Read the workspace and produce a concrete change plan. Do not modify files.',
  'chat:agentWorkflow.planner.phases.implement.label': 'Implement',
  'chat:agentWorkflow.planner.phases.implement.prompt':
    'Follow the plan and apply the changes in the workspace.',
  'chat:agentWorkflow.planner.phases.review.label': 'Review',
  'chat:agentWorkflow.planner.phases.review.prompt':
    'Review the applied diff for correctness, tests, and obvious issues.',
  'chat:agentWorkflow.planner.phases.reviewTarget.label': 'Review',
  'chat:agentWorkflow.planner.phases.reviewTarget.prompt':
    'Review the requested target read-only and list findings (issues, risks, suggestions).',
  'chat:agentWorkflow.planner.phases.audit.label': 'Audit',
  'chat:agentWorkflow.planner.phases.audit.prompt':
    'Audit the target read-only. Focus on your area of expertise. Do not modify files.',
  'chat:agentWorkflow.planner.phases.synthesizeFindings.label': 'Synthesize findings',
  'chat:agentWorkflow.planner.phases.synthesizeFindings.prompt':
    'Combine the audit findings into a prioritized list.',
  'chat:agentWorkflow.planner.phases.answer.label': 'Answer',
  'chat:agentWorkflow.planner.phases.answer.prompt':
    'Answer the user request directly. Do not modify files unless explicitly required.',
};

function fallbackInterpolate(template: string, vars?: Record<string, unknown>): string {
  if (!vars) return template;
  return template.replace(/{{\s*(\w+)\s*}}/g, (_, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : `{{${key}}}`,
  );
}

function makeTranslator(
  t?: (key: string, options?: Record<string, unknown>) => string,
): (key: string, options?: Record<string, unknown>) => string {
  return (key, options) => {
    if (t) {
      const value = t(key, options);
      if (typeof value === 'string' && value !== key) return value;
    }
    const fallback = PLANNER_FALLBACK_STRINGS[key];
    if (fallback !== undefined) return fallbackInterpolate(fallback, options);
    return key;
  };
}

// ---------- intent detection ----------

const WRITE_KEYWORDS = [
  'implement', 'fix', 'add', 'create', 'write', 'modify', 'update', 'refactor',
  'rename', 'delete', 'remove', 'apply', 'patch', 'commit', 'install',
  '修复', '修改', '实现', '新增', '添加', '创建', '改写', '重构', '改名', '删除', '应用', '安装', '迁移',
];

const REVIEW_KEYWORDS = [
  'review', 'audit', 'inspect', 'check', 'verify', 'critique',
  '复审', '审查', '检查', '校对', '审核',
];

const DISCUSS_KEYWORDS = [
  'discuss', 'brainstorm', 'thoughts', 'opinion', 'why', 'how should',
  '讨论', '看法', '观点', '思路', '怎么看', '为什么',
];

const MULTI_SOLUTION_KEYWORDS = [
  'options', 'alternatives', 'compare', 'multiple solutions', 'trade-offs',
  '方案', '对比', '比较', '权衡', '选型',
];

const AUDIT_KEYWORDS = [
  'security', 'performance', 'migrate', 'full scan', 'whole codebase',
  '安全', '性能', '全量', '大范围', '迁移', '审计',
];

function hitAny(text: string, words: string[]): boolean {
  const lower = text.toLowerCase();
  return words.some(w => lower.includes(w.toLowerCase()));
}

const READ_ONLY_REVISION_KEYWORDS = [
  'read only', 'read-only', 'do not modify', "don't modify", 'no write', 'no changes', 'do not edit', "don't edit",
  '只读', '不要改', '不要修改', '不改文件', '别改', '不要写', '不写文件',
];

const SINGLE_AGENT_REVISION_KEYWORDS = [
  'single agent', 'one agent', 'only one', '一个 agent', '一个人', '单人', '单个',
];

function revisionWantsReadOnly(text?: string): boolean {
  return !!text && hitAny(text, READ_ONLY_REVISION_KEYWORDS);
}

function revisionWantsSingleAgent(text?: string): boolean {
  return !!text && hitAny(text, SINGLE_AGENT_REVISION_KEYWORDS);
}

export function detectIntent(userMessage: string, hint?: AgentWorkflowIntent): AgentWorkflowIntent {
  if (hint && hint !== 'custom') return hint;
  const msg = userMessage || '';
  if (hitAny(msg, AUDIT_KEYWORDS)) return 'audit';
  // explicit "review/discuss" verbs take precedence over weaker noun matches
  if (hitAny(msg, DISCUSS_KEYWORDS) && !hitAny(msg, WRITE_KEYWORDS)) return 'discuss';
  if (hitAny(msg, MULTI_SOLUTION_KEYWORDS)) return 'multi_solution';
  if (hitAny(msg, REVIEW_KEYWORDS) && !hitAny(msg, WRITE_KEYWORDS)) return 'review';
  if (hitAny(msg, WRITE_KEYWORDS)) return 'implement';
  return 'quick';
}

// ---------- agent selection helpers ----------

function memberCapabilities(m: AIMember): AgentCapability[] {
  return (m as any).capabilities || [];
}

function pickAgentsByCapabilities(
  members: AIMember[],
  caps: AgentCapability[],
  limit: number,
  exclude: string[] = [],
): string[] {
  const pool = members.filter(m => !exclude.includes(m.id));
  if (caps.length === 0) return pool.slice(0, limit).map(m => m.id);

  const scored = pool.map(m => {
    const mine = new Set(memberCapabilities(m));
    const score = caps.reduce((s, c) => s + (mine.has(c) ? 1 : 0), 0);
    return { id: m.id, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const matched = scored.filter(s => s.score > 0).slice(0, limit).map(s => s.id);
  if (matched.length >= 1) return matched;
  return pool.slice(0, limit).map(m => m.id);
}

function pickFirstAgent(members: AIMember[], exclude: string[] = []): string | null {
  const m = members.find(x => !exclude.includes(x.id));
  return m ? m.id : null;
}

function slug(label: string, idx: number): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24);
  return `p${idx}-${base || 'phase'}`;
}

function emptyPlan(title: string, explanation: string): AgentWorkflowPlan {
  return {
    version: 1,
    title,
    intent: 'quick',
    riskLevel: 'low',
    requiresApproval: false,
    explanation,
    phases: [],
  };
}

// ---------- planner ----------

export function planAgentWorkflow(input: AgentWorkflowPlannerInput): AgentWorkflowPlannerResult {
  const { group, members, userMessage, intentHint, mentionedAgentIds, revisionInstruction, workspaceReady, t } = input;
  const _t = makeTranslator(t);
  const defaults = {
    ...createDefaultAgentWorkflowDefaults(),
    ...((group as any).workflowDefaults || {}),
  };
  let maxParallel = Math.max(1, defaults.maxParallelAgents || 1);
  const maxPhases = Math.max(1, defaults.maxPhases || 1);
  if (revisionWantsSingleAgent(revisionInstruction)) maxParallel = 1;
  const warnings: string[] = [];

  const effectiveMembers = mentionedAgentIds && mentionedAgentIds.length > 0
    ? members.filter(m => mentionedAgentIds.includes(m.id))
    : members;

  if (effectiveMembers.length === 0) {
    return {
      plan: emptyPlan(
        _t('chat:agentWorkflow.planner.emptyTitle'),
        _t('chat:agentWorkflow.planner.emptyExplanation'),
      ),
      warnings: [_t('chat:agentWorkflow.planner.warnings.noMembers')],
    };
  }

  let intent = detectIntent(userMessage, intentHint);
  if (revisionWantsReadOnly(revisionInstruction) && intent === 'implement') {
    warnings.push(_t('chat:agentWorkflow.planner.warnings.revisionReadOnly'));
    intent = 'discuss';
  }
  if (revisionInstruction && hitAny(revisionInstruction, REVIEW_KEYWORDS) && intent !== 'implement') {
    intent = 'review';
  }

  if (intent === 'implement' && !workspaceReady) {
    warnings.push(_t('chat:agentWorkflow.planner.warnings.noWorkspace'));
    intent = 'discuss';
  }

  const phases: AgentWorkflowPhase[] = [];
  let title = '';
  let riskLevel: AgentWorkflowRiskLevel = 'low';
  let requiresApproval = false;
  let intendedPhaseCount = 0;

  switch (intent) {
    case 'discuss': {
      title = _t('chat:agentWorkflow.planner.intents.discuss.title');
      intendedPhaseCount = 2;
      const analyzers = pickAgentsByCapabilities(
        effectiveMembers,
        ['codebase-analysis', 'research', 'product'],
        Math.min(maxParallel, effectiveMembers.length),
      );
      phases.push({
        id: slug('analyze', 1),
        label: _t('chat:agentWorkflow.planner.phases.analyze.label'),
        mode: 'readOnly',
        schedule: analyzers.length > 1 ? 'parallel' : 'single',
        agentSelection: { type: 'specific', agentIds: analyzers },
        prompt: _t('chat:agentWorkflow.planner.phases.analyze.prompt'),
        outputPolicy: 'summary',
        onFailure: 'continue',
      });
      if (maxPhases >= 2) {
        const synthAgent = pickFirstAgent(effectiveMembers);
        if (synthAgent) {
          phases.push({
            id: slug('synthesize', 2),
            label: _t('chat:agentWorkflow.planner.phases.synthesize.label'),
            mode: 'readOnly',
            schedule: 'single',
            agentSelection: { type: 'specific', agentIds: [synthAgent] },
            prompt: _t('chat:agentWorkflow.planner.phases.synthesize.prompt'),
            dependsOn: [phases[0].id],
            outputPolicy: 'full',
            onFailure: 'stop',
          });
        }
      }
      break;
    }
    case 'multi_solution': {
      title = _t('chat:agentWorkflow.planner.intents.multi_solution.title');
      intendedPhaseCount = 2;
      const proposers = pickAgentsByCapabilities(
        effectiveMembers,
        ['implementation', 'product', 'research'],
        Math.min(maxParallel, effectiveMembers.length),
      );
      phases.push({
        id: slug('propose', 1),
        label: _t('chat:agentWorkflow.planner.phases.propose.label'),
        mode: 'readOnly',
        schedule: proposers.length > 1 ? 'parallel' : 'single',
        agentSelection: { type: 'specific', agentIds: proposers },
        prompt: _t('chat:agentWorkflow.planner.phases.propose.prompt'),
        outputPolicy: 'full',
        onFailure: 'continue',
      });
      if (maxPhases >= 2) {
        const reviewer =
          pickFirstAgent(effectiveMembers, proposers.length > 1 ? proposers : [])
          || pickFirstAgent(effectiveMembers);
        if (reviewer) {
          phases.push({
            id: slug('review', 2),
            label: _t('chat:agentWorkflow.planner.phases.reviewRecommend.label'),
            mode: 'review',
            schedule: 'single',
            agentSelection: { type: 'specific', agentIds: [reviewer] },
            prompt: _t('chat:agentWorkflow.planner.phases.reviewRecommend.prompt'),
            dependsOn: [phases[0].id],
            outputPolicy: 'full',
            onFailure: 'stop',
          });
        }
      }
      break;
    }
    case 'implement': {
      title = _t('chat:agentWorkflow.planner.intents.implement.title');
      riskLevel = 'high';
      requiresApproval = true;
      intendedPhaseCount = 3;

      const planner = pickAgentsByCapabilities(effectiveMembers, ['codebase-analysis', 'product'], 1)[0]
        || pickFirstAgent(effectiveMembers)!;
      const implementer = pickAgentsByCapabilities(effectiveMembers, ['implementation'], 1)[0]
        || pickFirstAgent(effectiveMembers)!;
      const reviewerExclude = effectiveMembers.length > 1 ? [implementer] : [];
      const reviewer = pickAgentsByCapabilities(
        effectiveMembers, ['code-review', 'testing', 'security'], 1, reviewerExclude,
      )[0] || pickFirstAgent(effectiveMembers, reviewerExclude)!;

      phases.push({
        id: slug('plan', 1),
        label: _t('chat:agentWorkflow.planner.phases.plan.label'),
        mode: 'readOnly',
        schedule: 'single',
        agentSelection: { type: 'specific', agentIds: [planner] },
        prompt: _t('chat:agentWorkflow.planner.phases.plan.prompt'),
        outputPolicy: 'full',
        onFailure: 'stop',
      });
      if (maxPhases >= 2) {
        phases.push({
          id: slug('implement', 2),
          label: _t('chat:agentWorkflow.planner.phases.implement.label'),
          mode: 'write',
          schedule: 'single',
          agentSelection: { type: 'specific', agentIds: [implementer] },
          prompt: _t('chat:agentWorkflow.planner.phases.implement.prompt'),
          dependsOn: [phases[0].id],
          outputPolicy: 'diff',
          onFailure: 'stop',
        });
      }
      if (maxPhases >= 3 && phases.length >= 2) {
        phases.push({
          id: slug('review', 3),
          label: _t('chat:agentWorkflow.planner.phases.review.label'),
          mode: 'review',
          schedule: 'single',
          agentSelection: { type: 'specific', agentIds: [reviewer] },
          prompt: _t('chat:agentWorkflow.planner.phases.review.prompt'),
          dependsOn: [phases[1].id],
          outputPolicy: 'findings',
          onFailure: 'continue',
        });
      }
      break;
    }
    case 'review': {
      title = _t('chat:agentWorkflow.planner.intents.review.title');
      intendedPhaseCount = 1;
      const reviewers = pickAgentsByCapabilities(
        effectiveMembers,
        ['code-review', 'testing', 'security'],
        Math.min(maxParallel, effectiveMembers.length),
      );
      phases.push({
        id: slug('review', 1),
        label: _t('chat:agentWorkflow.planner.phases.reviewTarget.label'),
        mode: 'review',
        schedule: reviewers.length > 1 ? 'parallel' : 'single',
        agentSelection: { type: 'specific', agentIds: reviewers },
        prompt: _t('chat:agentWorkflow.planner.phases.reviewTarget.prompt'),
        outputPolicy: 'findings',
        onFailure: 'continue',
      });
      break;
    }
    case 'audit': {
      title = _t('chat:agentWorkflow.planner.intents.audit.title');
      riskLevel = 'medium';
      intendedPhaseCount = 2;
      const auditors = pickAgentsByCapabilities(
        effectiveMembers,
        ['security', 'performance', 'codebase-analysis', 'code-review'],
        Math.min(maxParallel, effectiveMembers.length),
      );
      phases.push({
        id: slug('audit', 1),
        label: _t('chat:agentWorkflow.planner.phases.audit.label'),
        mode: 'readOnly',
        schedule: auditors.length > 1 ? 'parallel' : 'single',
        agentSelection: { type: 'specific', agentIds: auditors },
        prompt: _t('chat:agentWorkflow.planner.phases.audit.prompt'),
        outputPolicy: 'findings',
        onFailure: 'continue',
      });
      if (maxPhases >= 2) {
        const synth = pickFirstAgent(effectiveMembers);
        if (synth) {
          phases.push({
            id: slug('synthesize', 2),
            label: _t('chat:agentWorkflow.planner.phases.synthesizeFindings.label'),
            mode: 'readOnly',
            schedule: 'single',
            agentSelection: { type: 'specific', agentIds: [synth] },
            prompt: _t('chat:agentWorkflow.planner.phases.synthesizeFindings.prompt'),
            dependsOn: [phases[0].id],
            outputPolicy: 'full',
            onFailure: 'stop',
          });
        }
      }
      break;
    }
    case 'quick':
    case 'custom':
    default: {
      title = _t('chat:agentWorkflow.planner.intents.quick.title');
      intendedPhaseCount = 1;
      const agentId = pickFirstAgent(effectiveMembers)!;
      phases.push({
        id: slug('answer', 1),
        label: _t('chat:agentWorkflow.planner.phases.answer.label'),
        mode: 'readOnly',
        schedule: 'single',
        agentSelection: { type: 'specific', agentIds: [agentId] },
        prompt: _t('chat:agentWorkflow.planner.phases.answer.prompt'),
        outputPolicy: 'full',
        onFailure: 'stop',
      });
      break;
    }
  }

  if (phases.length > maxPhases || intendedPhaseCount > maxPhases) {
    warnings.push(_t('chat:agentWorkflow.planner.warnings.phaseTruncated', { count: maxPhases }));
  }
  const cappedPhases = phases.slice(0, maxPhases);

  for (const ph of cappedPhases) {
    if (ph.mode === 'write' && revisionWantsReadOnly(revisionInstruction)) {
      warnings.push(_t('chat:agentWorkflow.planner.warnings.phaseRevisionReadOnly', { label: ph.label }));
      ph.mode = 'readOnly';
      ph.outputPolicy = ph.outputPolicy === 'diff' ? 'summary' : ph.outputPolicy;
    }
    if (ph.mode === 'write' && !workspaceReady) {
      warnings.push(_t('chat:agentWorkflow.planner.warnings.phaseNoWorkspace', { label: ph.label }));
      ph.mode = 'readOnly';
      ph.outputPolicy = ph.outputPolicy === 'diff' ? 'summary' : ph.outputPolicy;
    }
    if (ph.schedule === 'parallel' && ph.mode === 'write') {
      warnings.push(_t('chat:agentWorkflow.planner.warnings.phaseParallelWrite', { label: ph.label }));
      ph.schedule = 'single';
      if (ph.agentSelection.type === 'specific') {
        ph.agentSelection = { type: 'specific', agentIds: ph.agentSelection.agentIds.slice(0, 1) };
      }
    }
  }

  const plan: AgentWorkflowPlan = {
    version: 1,
    title,
    intent,
    riskLevel,
    requiresApproval: requiresApproval || cappedPhases.some(p => p.mode === 'write'),
    explanation: _t(`chat:agentWorkflow.planner.intents.${intent}.explanation`),
    phases: cappedPhases,
  };

  return { plan, warnings };
}

// ---------- async dispatcher (rule | LLM) ----------

export interface PlanAgentWorkflowSmartOptions {
  /** When provided, attempt LLM planner. On any failure, fall back to rule planner. */
  llm?: LLMPlannerOptions;
  /**
   * Optional human-readable label of the LLM model. Used only for warning
   * messages emitted on fallback so the user knows which model was tried.
   */
  llmLabel?: string;
}

/**
 * Smart planner dispatcher. If `options.llm` is provided, attempt the LLM
 * planner; on any error, fall back to the rule planner and prepend a warning.
 * Otherwise, use the rule planner directly.
 */
export async function planAgentWorkflowSmart(
  input: AgentWorkflowPlannerInput,
  options: PlanAgentWorkflowSmartOptions = {},
): Promise<AgentWorkflowPlannerResult> {
  if (options.llm && options.llm.providerId && options.llm.model) {
    try {
      const { planAgentWorkflowWithLLM } = await import('./agentWorkflowPlanner.llm');
      const result = await planAgentWorkflowWithLLM(input, options.llm);
      return result;
    } catch (error) {
      const _t = makeTranslator(input.t);
      const message = error instanceof Error ? error.message : String(error);
      const fallback = planAgentWorkflow(input);
      const label = options.llmLabel || options.llm.model;
      fallback.warnings.unshift(
        _t('chat:agentWorkflow.planner.warnings.llmFallback', { model: label, error: message }),
      );
      return fallback;
    }
  }
  return planAgentWorkflow(input);
}
