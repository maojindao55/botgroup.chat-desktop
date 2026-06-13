import type { AgentGroup } from '@/config/groups';
import type { AIMember } from '@/config/aiMembers';
import {
  createDefaultAgentWorkflowDefaults,
  type AgentWorkflowPlan,
  type AgentWorkflowIntent,
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
  revisionInstruction?: string;
  workspaceReady: boolean;
  t?: (key: string, options?: Record<string, unknown>) => string;
  locale?: string;
}

export interface AgentWorkflowPlannerResult {
  plan: AgentWorkflowPlan;
  warnings: string[];
}

const FALLBACK_STRINGS: Record<string, string> = {
  'chat:agentWorkflow.planner.emptyTitle': 'No-op',
  'chat:agentWorkflow.planner.emptyExplanation': 'No eligible members found.',
  'chat:agentWorkflow.planner.warnings.noMembers': 'No agent members available in this group.',
  'chat:agentWorkflow.planner.intents.quick.title': 'Quick answer',
  'chat:agentWorkflow.planner.intents.quick.explanation':
    'A single agent answers the question directly.',
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
    const fallback = FALLBACK_STRINGS[key];
    if (fallback !== undefined) return fallbackInterpolate(fallback, options);
    return key;
  };
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

export function planAgentWorkflow(input: AgentWorkflowPlannerInput): AgentWorkflowPlannerResult {
  const { group, members, mentionedAgentIds, t } = input;
  const _t = makeTranslator(t);
  const defaults = {
    ...createDefaultAgentWorkflowDefaults(),
    ...(group.workflowDefaults || {}),
  };
  const maxParallel = Math.max(1, defaults.maxParallelAgents || 1);

  const effective = mentionedAgentIds && mentionedAgentIds.length > 0
    ? members.filter(m => mentionedAgentIds.includes(m.id))
    : members;

  if (effective.length === 0) {
    return {
      plan: emptyPlan(
        _t('chat:agentWorkflow.planner.emptyTitle'),
        _t('chat:agentWorkflow.planner.emptyExplanation'),
      ),
      warnings: [_t('chat:agentWorkflow.planner.warnings.noMembers')],
    };
  }

  const wantsMention = !!mentionedAgentIds && mentionedAgentIds.length > 0;
  const selected = wantsMention
    ? effective.slice(0, Math.min(maxParallel, effective.length)).map(m => m.id)
    : [effective[0].id];

  const plan: AgentWorkflowPlan = {
    version: 1,
    title: _t('chat:agentWorkflow.planner.intents.quick.title'),
    intent: 'quick',
    riskLevel: 'low',
    requiresApproval: false,
    explanation: _t('chat:agentWorkflow.planner.intents.quick.explanation'),
    phases: [
      {
        id: 'p1-answer',
        label: _t('chat:agentWorkflow.planner.phases.answer.label'),
        mode: 'readOnly',
        schedule: selected.length > 1 ? 'parallel' : 'single',
        agentSelection: { type: 'specific', agentIds: selected },
        prompt: _t('chat:agentWorkflow.planner.phases.answer.prompt'),
        outputPolicy: 'full',
        onFailure: 'continue',
      },
    ],
  };

  return { plan, warnings: [] };
}

export interface PlanAgentWorkflowSmartOptions {
  llm?: LLMPlannerOptions;
  llmLabel?: string;
}

export async function planAgentWorkflowSmart(
  input: AgentWorkflowPlannerInput,
  options: PlanAgentWorkflowSmartOptions = {},
): Promise<AgentWorkflowPlannerResult> {
  if (options.llm && options.llm.providerId && options.llm.model) {
    try {
      const { planAgentWorkflowWithLLM } = await import('./agentWorkflowPlanner.llm');
      return await planAgentWorkflowWithLLM(input, options.llm);
    } catch {
      return planAgentWorkflow(input);
    }
  }
  return planAgentWorkflow(input);
}
