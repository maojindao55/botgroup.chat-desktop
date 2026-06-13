/**
 * LLM-backed Agent Workflow Planner.
 *
 * Same input/output shape as the rule planner so callers can swap freely.
 * If anything goes wrong (invalid JSON, schema mismatch, unknown agentIds,
 * etc.) we throw and let the dispatcher fall back to the rule planner.
 */
import type { AgentGroup } from '@/config/groups';
import type { AIMember, AgentCapability } from '@/config/aiMembers';
import {
  createDefaultAgentWorkflowDefaults,
  validateAgentWorkflowPlan,
  type AgentWorkflowPlan,
  type AgentWorkflowPhase,
} from '@/config/agentWorkflow';
import { resolveLlmCredentials } from '@/utils/resolveLlmCredentials';
import { llmChatComplete } from '@/utils/llmClient';
import type { AgentWorkflowPlannerInput, AgentWorkflowPlannerResult } from './agentWorkflowPlanner';

function getLanguageInstruction(locale?: string): string {
  if (locale?.toLowerCase().startsWith('zh')) {
    return 'All phase labels, prompts, and explanations must be written in Simplified Chinese (zh-CN). The generated plan should read naturally to a Chinese user.';
  }
  return 'All phase labels, prompts, and explanations must be written in English (en-US).';
}

export interface LLMPlannerCallParams {
  providerId: string;
  model: string;
  temperature?: number;
  systemPrompt: string;
  userPrompt: string;
}

/** Caller-supplied LLM invoker. Defaults to llmChatComplete via vault credentials. */
export type LLMPlannerCaller = (params: LLMPlannerCallParams) => Promise<string>;

const defaultCaller: LLMPlannerCaller = async ({ providerId, model, temperature, systemPrompt, userPrompt }) => {
  const creds = await resolveLlmCredentials(model, providerId);
  return llmChatComplete({
    ...creds,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: temperature ?? 0.2,
  });
};

export interface LLMPlannerOptions {
  providerId: string;
  model: string;
  temperature?: number;
  /** Override for tests. */
  caller?: LLMPlannerCaller;
}

function memberCapabilities(m: AIMember): AgentCapability[] {
  return ((m as { capabilities?: AgentCapability[] }).capabilities) || [];
}

function buildSystemPrompt(group: AgentGroup, members: AIMember[], input: AgentWorkflowPlannerInput): string {
  const defaults = {
    ...createDefaultAgentWorkflowDefaults(),
    ...(group.workflowDefaults || {}),
  };
  const workspaceReady = !!group.workspacePath?.trim();
  const memberList = members.map(m => ({
    id: m.id,
    name: m.name,
    kind: m.kind,
    capabilities: memberCapabilities(m),
  }));

  const now = new Date();
  const isoDate = now.toISOString().slice(0, 10);
  const tz = (() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
  })();
  const localized = (() => {
    try {
      return new Intl.DateTimeFormat(undefined, {
        year: 'numeric', month: 'long', day: 'numeric', weekday: 'long', timeZone: tz,
      }).format(now);
    } catch { return isoDate; }
  })();

  return [
    'You are a planner that produces a JSON AgentWorkflowPlan for a multi-agent group.',
    'Return ONLY a JSON object, no prose, no markdown fences.',
    '',
    `Current date: ${isoDate} (${localized}, timezone ${tz}). Treat this as ground truth and prefer it over any date implied by your training data when writing phase prompts.`,
    '',
    getLanguageInstruction(input.locale),
    '',
    'Plan schema (TypeScript-like):',
    `{
  "version": 1,
  "title": string,
  "intent": "quick" | "discuss" | "multi_solution" | "implement" | "review" | "audit" | "custom",
  "riskLevel": "low" | "medium" | "high",
  "requiresApproval": boolean,
  "explanation": string,
  "phases": Phase[]
}
Phase = {
  "id": string,
  "label": string,
  "mode": "readOnly" | "write" | "review" | "verifier",
  "schedule": "single" | "parallel" | "sequential",
  "agentSelection": { "type": "specific", "agentIds": string[] } | { "type": "auto", "count"?: number },
  "prompt": string,
  "dependsOn"?: string[],
  "outputPolicy"?: "summary" | "full" | "findings" | "diff",
  "onFailure"?: "stop" | "continue",
  "retry"?: { "maxAttempts": number, "feedbackFromPhaseId"?: string }
}`,
    '',
    'Mode semantics:',
    '- readOnly: gather information, do not modify files.',
    '- write: produce or modify files in the workspace.',
    '- review: inspect prior work and report issues/opinions.',
    '- verifier: judge whether the phases listed in dependsOn satisfy the criteria in "prompt". Must be schedule="single", must have dependsOn pointing to the phase(s) being verified, and should use a single agent. Output will be parsed for a PASS/FAIL verdict; FAIL can trigger upstream retries if the upstream phase has "retry".',
    '',
    'Phase prompt rules (CRITICAL):',
    '- Each phase.prompt must be ATOMIC: describe ONLY the concrete task this single phase should perform.',
    '- Do NOT include the overall user request, goal, or later-phase responsibilities inside phase.prompt.',
    '- Do NOT ask a phase to "predict", "analyze all angles", "summarize", or "produce the final answer" unless that is literally its own label.',
    '- Use imperative sentences. Start from the desired output, not from the user goal.',
    '- The runner will automatically append the user request for context; phase.prompt must be narrow enough that the agent can fulfill it without solving the whole problem.',
    '',
    'Retry semantics:',
    '- "retry.maxAttempts" counts the initial run plus retries (not retries only).',
    '- "retry.feedbackFromPhaseId" optionally names a phase whose summary should be injected as feedback on the next attempt.',
    '',
    'Hard constraints:',
    `- phases.length <= ${defaults.maxPhases}`,
    `- For schedule="parallel", agentSelection.type may be "auto" with count <= ${defaults.maxParallelAgents}, OR "specific" with agentIds.length <= ${defaults.maxParallelAgents}.`,
    '- A phase with mode="write" must NOT use schedule="parallel".',
    '- A phase with mode="write" must set requiresApproval=true on the plan.',
    `- Workspace ready: ${workspaceReady ? 'YES' : 'NO'}. If NO, do not emit any mode="write" phase; use readOnly instead.`,
    '- agentSelection of type "specific" must reference only known agent ids listed below.',
    '- phase ids must be unique and lower-case slugs.',
    '- dependsOn must reference earlier phase ids.',
    `- When the user asks about recent or "today/tonight/yesterday" facts, anchor phase prompts to ${isoDate}; never write "as of YYYY" with a year earlier than ${isoDate.slice(0, 4)} unless the user explicitly asked for that historical year.`,
    '',
    'Example workflow with a verifier:',
    `{
  "id": "verify",
  "label": "Verify solution",
  "mode": "verifier",
  "schedule": "single",
  "agentSelection": { "type": "specific", "agentIds": ["critic"] },
  "prompt": "Check that the implementation phase includes error handling and tests. Output PASS if yes, FAIL with a markdown list of missing items if not.",
  "dependsOn": ["implement"],
  "onFailure": "stop"
}`,
    '',
    'Example multi-phase readOnly workflow (note how each phase.prompt is narrow and avoids the overall goal):',
    `{
  "id": "schedule",
  "label": "Fetch schedule",
  "mode": "readOnly",
  "schedule": "single",
  "agentSelection": { "type": "specific", "agentIds": ["researcher"] },
  "prompt": "Query the official 2026 FIFA World Cup match schedule and list every match scheduled for 2026-06-14 with kickoff time, venue, and teams. If the schedule is incomplete, say so explicitly."
},
{
  "id": "analysis",
  "label": "Multi-angle analysis",
  "mode": "readOnly",
  "schedule": "parallel",
  "agentSelection": { "type": "auto", "count": 3 },
  "prompt": "Given the match schedule from the previous phase, analyze one assigned angle (team form, historical head-to-head, or venue/weather) for the 2026-06-14 matches. Do not repeat the schedule; focus only on your assigned angle.",
  "dependsOn": ["schedule"]
}`,
    '',
    'Available agents (use ONLY these ids):',
    JSON.stringify(memberList, null, 2),
    '',
    `Group preferences: effort=${defaults.effort}, maxPhases=${defaults.maxPhases}, maxParallelAgents=${defaults.maxParallelAgents}.`,
    'Be conservative: prefer fewer phases when the task is simple; never invent agent ids.',
  ].join('\n');
}

function buildUserPrompt(input: AgentWorkflowPlannerInput): string {
  const parts: string[] = [];
  const todayIso = new Date().toISOString().slice(0, 10);
  parts.push(`Today is ${todayIso}.`);
  parts.push('');
  if (input.history) {
    parts.push('Recent conversation:');
    parts.push(input.history);
    parts.push('');
  }
  if (input.attachmentSummary) {
    parts.push('Attachments:');
    parts.push(input.attachmentSummary);
    parts.push('');
  }
  if (input.mentionedAgentIds?.length) {
    parts.push(`User explicitly mentioned agents: ${input.mentionedAgentIds.join(', ')}`);
    parts.push('');
  }
  if (input.revisionInstruction) {
    parts.push('Revision instruction (override previous plan accordingly):');
    parts.push(input.revisionInstruction);
    parts.push('');
  }
  parts.push('User request:');
  parts.push(input.userMessage || '');
  parts.push('');
  parts.push('Respond with the JSON plan only.');
  return parts.join('\n');
}

function stripJsonFences(text: string): string {
  let s = text.trim();
  if (s.startsWith('```')) {
    const firstNl = s.indexOf('\n');
    if (firstNl >= 0) s = s.slice(firstNl + 1);
    if (s.endsWith('```')) s = s.slice(0, -3);
  }
  return s.trim();
}

function extractJSON(text: string): unknown {
  const stripped = stripJsonFences(text);
  try {
    return JSON.parse(stripped);
  } catch {
    const start = stripped.indexOf('{');
    const end = stripped.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(stripped.slice(start, end + 1));
      } catch {
        /* fall through */
      }
    }
    throw new Error('LLM planner response is not valid JSON');
  }
}

function applySafetyRewrite(
  plan: AgentWorkflowPlan,
  workspaceReady: boolean,
  maxParallel: number,
): { plan: AgentWorkflowPlan; warnings: string[] } {
  const warnings: string[] = [];
  const phases: AgentWorkflowPhase[] = plan.phases.map(ph => ({ ...ph }));

  for (const ph of phases) {
    if (ph.mode === 'write' && !workspaceReady) {
      warnings.push(`Phase "${ph.label}" requires workspace; downgraded to read-only.`);
      ph.mode = 'readOnly';
      if (ph.outputPolicy === 'diff') ph.outputPolicy = 'summary';
    }
    if (ph.schedule === 'parallel' && ph.mode === 'write') {
      warnings.push(`Phase "${ph.label}" cannot run write in parallel; serialized to single.`);
      ph.schedule = 'single';
      if (ph.agentSelection.type === 'specific') {
        ph.agentSelection = { type: 'specific', agentIds: ph.agentSelection.agentIds.slice(0, 1) };
      }
    }
    if (
      ph.schedule === 'parallel' &&
      ph.agentSelection.type === 'specific' &&
      ph.agentSelection.agentIds.length > maxParallel
    ) {
      warnings.push(`Phase "${ph.label}" parallel agents capped to ${maxParallel}.`);
      ph.agentSelection = {
        type: 'specific',
        agentIds: ph.agentSelection.agentIds.slice(0, maxParallel),
      };
    }
  }

  const requiresApproval = plan.requiresApproval || phases.some(p => p.mode === 'write');

  return {
    plan: { ...plan, phases, requiresApproval },
    warnings,
  };
}

export async function planAgentWorkflowWithLLM(
  input: AgentWorkflowPlannerInput,
  options: LLMPlannerOptions,
): Promise<AgentWorkflowPlannerResult> {
  if (!options.providerId || !options.model) {
    throw new Error('LLM planner requires providerId and model');
  }
  const { group, members } = input;
  const defaults = {
    ...createDefaultAgentWorkflowDefaults(),
    ...(group.workflowDefaults || {}),
  };
  const maxPhases = Math.max(1, defaults.maxPhases || 1);
  const maxParallel = Math.max(1, defaults.maxParallelAgents || 1);

  if (!members || members.length === 0) {
    throw new Error('LLM planner requires at least one available member');
  }

  const systemPrompt = buildSystemPrompt(group, members, input);
  const userPrompt = buildUserPrompt(input);
  const caller = options.caller || defaultCaller;
  const raw = await caller({
    providerId: options.providerId,
    model: options.model,
    temperature: options.temperature,
    systemPrompt,
    userPrompt,
  });
  if (!raw || !raw.trim()) {
    throw new Error('LLM planner returned empty response');
  }

  const parsed = extractJSON(raw) as AgentWorkflowPlan;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('LLM planner response is not an object');
  }
  if (typeof parsed.version !== 'number') parsed.version = 1;
  if (!Array.isArray(parsed.phases)) {
    throw new Error('LLM planner response missing phases');
  }

  const validation = validateAgentWorkflowPlan(
    parsed,
    members.map(m => m.id),
    { maxPhases, maxParallelAgents: maxParallel },
  );
  if (!validation.ok) {
    throw new Error(`LLM planner produced invalid plan: ${validation.errors.join('; ')}`);
  }

  const workspaceReady = !!group.workspacePath?.trim();
  const { plan, warnings } = applySafetyRewrite(parsed, workspaceReady, maxParallel);
  plan.plannerModel = options.model;
  plan.plannerProviderId = options.providerId;
  return { plan, warnings };
}
