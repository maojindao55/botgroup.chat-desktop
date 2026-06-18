/**
 * Agent Workflow Runner
 *
 * Executes an AgentWorkflowPlan produced by the planner. The runner
 * is the single execution path for Agent groups (replaces the old
 * strategy switch). It composes phases by walking dependsOn order and
 * delegates each agent invocation to agentRuntime.runSingleAgent.
 *
 * Safety contract:
 *   - parallel + mode === 'write' is rejected up front (a single
 *     workspace cannot accept concurrent writers).
 *   - missing workspace + mode === 'write' is rejected at runtime
 *     (planner should have downgraded earlier; we double-check).
 *   - AbortSignal aborts the in-flight phase and marks the run cancelled.
 */
import type { AgentGroup } from '@/config/groups';
import type { AIMember } from '@/config/aiMembers';
import type {
  AgentWorkflowPlan,
  AgentWorkflowPhase,
  AgentWorkflowRun,
  AgentWorkflowPhaseState,
  AgentWorkflowAgentOutput,
} from '@/config/agentWorkflow';
import { newAgentWorkflowRun } from '@/config/agentWorkflow';
import {
  runSingleAgent,
  normalizeAgentMember,
  isCLIMember,
  hasCLIWorkspace,
} from './agentRuntime';
import type {
  AgentRuntimeCallback,
  AgentGroupContext,
  AgentRunResult,
} from './agentRuntime';
import { applyOutputPolicy, type SummaryOptions } from './agentWorkflowOutputPolicy';
import { parseVerdict, wrapVerifierPrompt } from './agentWorkflowVerifier';
import { resolveAgentSelection } from './agentWorkflowSelection';

export interface AgentWorkflowRunnerCallbacks extends AgentRuntimeCallback {
  onRunStart?: (run: AgentWorkflowRun) => void;
  onPlanUpdate?: (run: AgentWorkflowRun) => void;
  onPhaseStart?: (phase: AgentWorkflowPhase, state: AgentWorkflowPhaseState) => void;
  onPhaseEnd?: (phase: AgentWorkflowPhase, state: AgentWorkflowPhaseState) => void;
  onRunEnd?: (run: AgentWorkflowRun) => void;
  onInfo?: (message: string) => void;
}

export interface AgentWorkflowRunnerOptions {
  signal?: AbortSignal;
  /** Recent chat history passed as base context to every phase. */
  history?: string;
  /** Lookup the previous CLI tool session id for a given agent. */
  toolSessionLookup?: (agentId: string) => string | null | undefined;
  /** Cheap LLM credentials used by outputPolicy='summary'. Falls back to truncation when absent. */
  summaryOptions?: SummaryOptions;
  locale?: string;
}

/** Topologically sort phases respecting `dependsOn`. */
function topoSort(phases: AgentWorkflowPhase[]): AgentWorkflowPhase[] {
  const byId = new Map(phases.map(p => [p.id, p]));
  const visited = new Set<string>();
  const result: AgentWorkflowPhase[] = [];

  function visit(id: string, stack: string[]) {
    if (visited.has(id)) return;
    if (stack.includes(id)) {
      throw new Error(`Workflow plan contains a dependency cycle at phase "${id}".`);
    }
    const phase = byId.get(id);
    if (!phase) return;
    for (const dep of phase.dependsOn || []) visit(dep, [...stack, id]);
    visited.add(id);
    result.push(phase);
  }

  for (const p of phases) visit(p.id, []);
  return result;
}

function truncate(content: string, max = 1200): string {
  if (!content) return '';
  if (content.length <= max) return content;
  return content.slice(0, max) + '\n... (truncated)';
}

function summarizePhaseStateLegacy(state: AgentWorkflowPhaseState): string {
  if (state.outputs.length === 0) return state.error ? `Failed: ${state.error}` : '(no output)';
  if (state.outputs.length === 1) return truncate(state.outputs[0].content);
  return state.outputs
    .map(o => `### ${o.agentName}\n${truncate(o.content, 600)}`)
    .join('\n\n');
}

async function buildPhaseSummary(
  phase: AgentWorkflowPhase,
  state: AgentWorkflowPhaseState,
  summaryOptions: SummaryOptions | undefined,
): Promise<string> {
  if (state.outputs.length === 0) {
    return state.error ? `Failed: ${state.error}` : '(no output)';
  }
  return applyOutputPolicy(state.outputs, {
    policy: phase.outputPolicy,
    summary: summaryOptions,
  });
}

function buildPhaseContext(
  phase: AgentWorkflowPhase,
  history: string,
  runState: AgentWorkflowRun,
): string {
  const parts: string[] = [];
  if (history) parts.push(`[Recent history]\n${truncate(history, 800)}`);
  for (const depId of phase.dependsOn || []) {
    const depState = runState.phaseStates[depId];
    if (!depState) continue;
    const depPhase = runState.plan.phases.find(p => p.id === depId);
    const depSummary = depState.summary || summarizePhaseStateLegacy(depState);
    parts.push(`[Output of phase "${depPhase?.label || depId}"]\n${depSummary}`);
  }
  return parts.join('\n\n');
}

function selectAgentsForPhase(
  phase: AgentWorkflowPhase,
  members: AIMember[],
  maxParallel: number,
): AIMember[] {
  if (phase.agentSelection.type === 'specific') {
    const ids = phase.agentSelection.agentIds;
    return ids
      .map(id => members.find(m => m.id === id))
      .filter((m): m is AIMember => !!m);
  }
  // 'auto' is reserved for future LLM planner output; the rule-based
  // planner always emits 'specific'. Route through the shared helper so
  // the same selection + maxParallel cap applies everywhere.
  const wanted = phase.agentSelection.count || 1;
  const ids = resolveAgentSelection({ kind: 'count', n: wanted }, members, { maxParallel });
  const idSet = new Set(ids);
  return members.filter(m => idSet.has(m.id));
}

function buildAttemptFeedback(
  phase: AgentWorkflowPhase,
  state: AgentWorkflowPhaseState,
  run: AgentWorkflowRun,
): string {
  const parts: string[] = [];
  const fbId = phase.retry?.feedbackFromPhaseId;
  if (fbId) {
    const fbState = run.phaseStates[fbId];
    const fbPhase = run.plan.phases.find(p => p.id === fbId);
    if (fbState?.summary) {
      parts.push(`The previous attempt was not accepted. Feedback from "${fbPhase?.label || fbId}":\n${fbState.summary}`);
    }
  }
  const lastAttempt = state.attemptHistory && state.attemptHistory.length > 0
    ? state.attemptHistory[state.attemptHistory.length - 1]
    : undefined;
  if (parts.length === 0 && lastAttempt) {
    if (lastAttempt.error) {
      parts.push(`The previous attempt failed with: ${lastAttempt.error}`);
    } else if (lastAttempt.summary) {
      parts.push(`Previous attempt output:\n${truncate(lastAttempt.summary, 600)}`);
    }
  }
  parts.push('Please address the issues above and try again.');
  return parts.join('\n\n');
}

function triggerUpstreamRetry(
  verifierPhase: AgentWorkflowPhase,
  run: AgentWorkflowRun,
  ordered: AgentWorkflowPhase[],
  remaining: Set<string>,
  hardCap: number,
): boolean {
  let triggered = false;
  for (const upstreamId of verifierPhase.dependsOn || []) {
    const upstream = ordered.find(p => p.id === upstreamId);
    if (!upstream) continue;
    const upstreamState = run.phaseStates[upstreamId];
    const retryPolicy = upstream.retry;
    if (!retryPolicy) continue;
    const attempts = upstreamState.attempts || 0;
    if (attempts >= retryPolicy.maxAttempts || attempts >= hardCap) continue;

    const visited = new Set<string>();
    const stack = [upstreamId];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (visited.has(id)) continue;
      visited.add(id);
      const s = run.phaseStates[id];
      run.phaseStates[id] = {
        phaseId: id,
        status: 'pending',
        selectedAgentIds: [],
        outputs: [],
        attempts: s.attempts,
        attemptHistory: s.attemptHistory,
      };
      remaining.add(id);
      for (const ph of ordered) {
        if ((ph.dependsOn || []).includes(id)) {
          stack.push(ph.id);
        }
      }
    }
    triggered = true;
  }
  return triggered;
}

async function executePhase(
  phase: AgentWorkflowPhase,
  selected: AIMember[],
  promptForPhase: string,
  context: string,
  callbacks: AgentWorkflowRunnerCallbacks,
  groupContext: AgentGroupContext,
  signal: AbortSignal | undefined,
  totalPhaseCount: number,
): Promise<AgentWorkflowAgentOutput[]> {
  const outputs: AgentWorkflowAgentOutput[] = [];

  const runOne = async (agent: AIMember): Promise<AgentRunResult> => {
    const normalized = normalizeAgentMember(agent);
    const phaseAgentId = totalPhaseCount > 1
      ? `${agent.id}__${phase.id}`
      : agent.id;
    return runSingleAgent(
      normalized,
      promptForPhase,
      context,
      callbacks,
      groupContext,
      { signal, phaseId: phase.id, agentIdOverride: phaseAgentId },
    );
  };

  if (phase.schedule === 'parallel' && selected.length > 1) {
    const results = await Promise.allSettled(selected.map(a => runOne(a)));
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const member = selected[i];
      if (r.status === 'fulfilled') {
        outputs.push({
          agentId: r.value.agentId,
          agentName: r.value.agentName,
          content: r.value.content,
          isError: r.value.isError,
        });
      } else {
        outputs.push({
          agentId: member.id,
          agentName: member.name,
          content: r.reason?.message || 'phase execution failed',
          isError: true,
        });
      }
    }
  } else if (phase.schedule === 'sequential') {
    let accumulatedContext = context;
    for (let i = 0; i < selected.length; i++) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const member = selected[i];
      const normalized = normalizeAgentMember(member);
      const phaseAgentId = `${member.id}__${phase.id}`;
      const result = await runSingleAgent(
        normalized,
        promptForPhase,
        accumulatedContext,
        callbacks,
        groupContext,
        { signal, phaseId: phase.id, agentIdOverride: phaseAgentId },
      );
      outputs.push({
        agentId: result.agentId,
        agentName: result.agentName,
        content: result.content,
        isError: result.isError,
      });
      if (!result.isError) {
        accumulatedContext += `\n\n[${result.agentName} said]\n${truncate(result.content, 600)}`;
      }
    }
  } else {
    const member = selected[0];
    const result = await runOne(member);
    outputs.push({
      agentId: result.agentId,
      agentName: result.agentName,
      content: result.content,
      isError: result.isError,
    });
  }

  return outputs;
}

/** Public entry point. Runs the plan and resolves with the final run record. */
export async function runAgentWorkflowPlan(
  group: AgentGroup,
  members: AIMember[],
  plan: AgentWorkflowPlan,
  userMessage: string,
  callbacks: AgentWorkflowRunnerCallbacks,
  options: AgentWorkflowRunnerOptions = {},
): Promise<AgentWorkflowRun> {
  const run = newAgentWorkflowRun(plan);
  callbacks.onRunStart?.(run);

  const groupContext: AgentGroupContext = {
    groupId: group.id,
    workspacePath: group.workspacePath,
    timeout: group.timeout,
    approvalMode: group.approvalMode,
    showStderr: group.showStderr,
    toolSessionLookup: options.toolSessionLookup,
    locale: options.locale,
  };

  const maxParallel = Math.max(1, group.workflowDefaults?.maxParallelAgents ?? 5);

  // Validate parallel-write up front so we fail before any side effects.
  for (const ph of plan.phases) {
    if (ph.schedule === 'parallel' && ph.mode === 'write') {
      run.status = 'failed';
      run.updatedAt = Date.now();
      const msg = `Phase "${ph.label}" cannot run write actions in parallel against a single workspace.`;
      callbacks.onInfo?.(msg);
      callbacks.onRunEnd?.(run);
      throw new Error(msg);
    }
  }

  let ordered: AgentWorkflowPhase[];
  try {
    ordered = topoSort(plan.phases);
  } catch (err: any) {
    run.status = 'failed';
    run.updatedAt = Date.now();
    callbacks.onInfo?.(err.message);
    callbacks.onRunEnd?.(run);
    throw err;
  }

  run.status = 'running';
  callbacks.onPlanUpdate?.(run);

  const signal = options.signal;
  const history = options.history || '';
  const summaryOptions = options.summaryOptions;

  const orderedById = new Map(ordered.map(p => [p.id, p]));
  const remaining = new Set(ordered.map(p => p.id));

  const pickNextRunnable = (): AgentWorkflowPhase | null => {
    for (const phase of ordered) {
      if (!remaining.has(phase.id)) continue;
      const state = run.phaseStates[phase.id];
      if (state.status === 'running') continue;
      const deps = phase.dependsOn || [];
      const depsReady = deps.every(d => {
        const ds = run.phaseStates[d];
        return ds && ds.status !== 'pending' && ds.status !== 'running';
      });
      if (depsReady) return phase;
    }
    return null;
  };

  // 防御性死循环防护：每个 phase 总执行次数硬上限
  const HARD_ATTEMPT_CAP = 8;

  while (remaining.size > 0) {
    if (signal?.aborted) {
      run.status = 'cancelled';
      run.updatedAt = Date.now();
      callbacks.onRunEnd?.(run);
      return run;
    }

    const phase = pickNextRunnable();
    if (!phase) {
      run.status = 'failed';
      run.updatedAt = Date.now();
      callbacks.onInfo?.('Workflow stalled: no runnable phase remaining (likely a stopped upstream).');
      callbacks.onRunEnd?.(run);
      return run;
    }

    const state = run.phaseStates[phase.id];
    state.attempts = (state.attempts || 0) + 1;
    state.attemptHistory = state.attemptHistory || [];
    if (state.attempts > HARD_ATTEMPT_CAP) {
      state.status = 'failed';
      state.error = `Phase "${phase.label}" exceeded hard attempt cap (${HARD_ATTEMPT_CAP}).`;
      state.endedAt = Date.now();
      run.updatedAt = state.endedAt;
      callbacks.onPhaseEnd?.(phase, state);
      callbacks.onPlanUpdate?.(run);
      run.status = 'failed';
      callbacks.onRunEnd?.(run);
      return run;
    }
    state.status = 'running';
    state.startedAt = Date.now();
    state.outputs = [];
    state.error = undefined;
    state.summary = undefined;
    state.verdict = undefined;
    state.verdictReasoning = undefined;
    run.updatedAt = state.startedAt;

    // Resolve agents for this phase
    const selected = selectAgentsForPhase(phase, members, maxParallel);
    state.selectedAgentIds = selected.map(m => m.id);

    if (selected.length === 0) {
      state.status = 'failed';
      state.error = `No agents available for phase "${phase.label}".`;
      state.endedAt = Date.now();
      run.updatedAt = state.endedAt;
      callbacks.onPhaseEnd?.(phase, state);
      callbacks.onPlanUpdate?.(run);
      remaining.delete(phase.id);
      if ((phase.onFailure || 'stop') === 'stop') {
        run.status = 'failed';
        callbacks.onRunEnd?.(run);
        return run;
      }
      continue;
    }

    // Re-check write/workspace safety at runtime
    const needsWorkspace = phase.mode === 'write' || selected.some(m => isCLIMember(m));
    if (needsWorkspace && !hasCLIWorkspace(groupContext)) {
      state.status = 'failed';
      state.error = `Phase "${phase.label}" requires a workspace path.`;
      state.endedAt = Date.now();
      run.updatedAt = state.endedAt;
      callbacks.onPhaseEnd?.(phase, state);
      callbacks.onPlanUpdate?.(run);
      remaining.delete(phase.id);
      if ((phase.onFailure || 'stop') === 'stop') {
        run.status = 'failed';
        run.updatedAt = Date.now();
        callbacks.onRunEnd?.(run);
        return run;
      }
      continue;
    }

    callbacks.onPhaseStart?.(phase, state);
    callbacks.onPlanUpdate?.(run);

    // Build feedback for retry attempts
    const feedbackText = state.attempts > 1
      ? buildAttemptFeedback(phase, state, run)
      : '';
    const baseContext = buildPhaseContext(phase, history, run);
    const context = feedbackText
      ? `${baseContext}\n\n[Previous attempt feedback]\n${feedbackText}`.trim()
      : baseContext;
    const promptForPhase = phase.mode === 'verifier'
      ? wrapVerifierPrompt({ phase, run, userMessage })
      : [
        `You are participating in a multi-phase workflow. This is phase "${phase.label}".`,
        '',
        '[Phase task]',
        phase.prompt,
        '',
        '[Background user request]',
        userMessage,
        '',
        'Focus on the Phase task above. Do not perform work meant for later phases.',
        '',
        options.locale?.toLowerCase().startsWith('zh')
          ? '请使用简体中文完成上述阶段任务。'
          : 'Complete the phase task above in English.',
      ].join('\n');

    let outputs: AgentWorkflowAgentOutput[] = [];
    let abortedDuringPhase = false;
    let runtimeError: string | undefined;

    try {
      outputs = await executePhase(
        phase,
        selected,
        promptForPhase,
        context,
        callbacks,
        groupContext,
        signal,
        ordered.length,
      );
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        abortedDuringPhase = true;
      } else {
        runtimeError = err?.message || 'phase execution failed';
      }
    }

    if (abortedDuringPhase) {
      state.status = 'cancelled';
      state.endedAt = Date.now();
      run.updatedAt = state.endedAt;
      callbacks.onPhaseEnd?.(phase, state);
      callbacks.onPlanUpdate?.(run);
      run.status = 'cancelled';
      run.updatedAt = Date.now();
      callbacks.onRunEnd?.(run);
      return run;
    }

    if (runtimeError) {
      state.outputs = outputs;
      state.error = runtimeError;
    } else {
      state.outputs = outputs;
    }

    const anyError = !!runtimeError || outputs.some(o => o.isError);
    state.endedAt = Date.now();
    run.updatedAt = state.endedAt;

    if (!anyError) {
      state.status = 'completed';
      state.summary = await buildPhaseSummary(phase, state, summaryOptions);
      if (phase.mode === 'verifier') {
        const judgement = parseVerdict(outputs.map(o => o.content || '').join('\n\n'));
        state.verdict = judgement.verdict;
        state.verdictReasoning = judgement.reasoning;
      }
      state.attemptHistory.push({
        attemptNumber: state.attempts,
        status: 'completed',
        outputs: [...outputs],
        summary: state.summary,
        startedAt: state.startedAt,
        endedAt: state.endedAt,
        feedbackUsed: feedbackText || undefined,
      });
      remaining.delete(phase.id);
      callbacks.onPhaseEnd?.(phase, state);
      callbacks.onPlanUpdate?.(run);

      if (phase.mode === 'verifier' && state.verdict === 'fail') {
        const retryTriggered = triggerUpstreamRetry(phase, run, ordered, remaining, HARD_ATTEMPT_CAP);
        if (!retryTriggered) {
          const onFailure = phase.onFailure || 'stop';
          if (onFailure === 'stop') {
            run.status = 'failed';
            run.updatedAt = Date.now();
            callbacks.onRunEnd?.(run);
            return run;
          }
        }
      }
      continue;
    }

    state.summary = await buildPhaseSummary(phase, state, summaryOptions);
    state.attemptHistory.push({
      attemptNumber: state.attempts,
      status: 'failed',
      outputs: [...outputs],
      summary: state.summary,
      error: runtimeError,
      startedAt: state.startedAt,
      endedAt: state.endedAt,
      feedbackUsed: feedbackText || undefined,
    });

    const retryPolicy = phase.retry;
    const canRetry = !!retryPolicy
      && retryPolicy.maxAttempts > state.attempts
      && state.attempts < HARD_ATTEMPT_CAP;

    if (canRetry) {
      state.status = 'pending';
      callbacks.onPhaseEnd?.(phase, state);
      callbacks.onPlanUpdate?.(run);
      continue;
    }

    state.status = 'failed';
    callbacks.onPhaseEnd?.(phase, state);
    callbacks.onPlanUpdate?.(run);
    remaining.delete(phase.id);

    const onFailure = phase.onFailure || 'stop';
    if (onFailure === 'stop') {
      run.status = 'failed';
      run.updatedAt = Date.now();
      callbacks.onRunEnd?.(run);
      return run;
    }
    // 'continue' or unsupported -> just skip downstream that depends on it later
  }

  void orderedById;

  run.status = run.status === 'running' ? 'completed' : run.status;
  run.updatedAt = Date.now();
  callbacks.onRunEnd?.(run);
  return run;
}
