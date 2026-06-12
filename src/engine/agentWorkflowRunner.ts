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

function summarizePhaseState(state: AgentWorkflowPhaseState): string {
  if (state.outputs.length === 0) return state.error ? `Failed: ${state.error}` : '(no output)';
  if (state.outputs.length === 1) return truncate(state.outputs[0].content);
  return state.outputs
    .map(o => `### ${o.agentName}\n${truncate(o.content, 600)}`)
    .join('\n\n');
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
    parts.push(`[Output of phase "${depPhase?.label || depId}"]\n${depState.summary || summarizePhaseState(depState)}`);
  }
  return parts.join('\n\n');
}

function selectAgentsForPhase(
  phase: AgentWorkflowPhase,
  members: AIMember[],
): AIMember[] {
  if (phase.agentSelection.type === 'specific') {
    const ids = phase.agentSelection.agentIds;
    return ids
      .map(id => members.find(m => m.id === id))
      .filter((m): m is AIMember => !!m);
  }
  // 'auto' is reserved for future LLM planner output; the rule-based
  // planner always emits 'specific'. As a defensive fallback, pick
  // by capability match or the first N members.
  const wanted = phase.agentSelection.count || 1;
  return members.slice(0, wanted);
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
  };

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

  for (const phase of ordered) {
    if (signal?.aborted) {
      run.status = 'cancelled';
      run.updatedAt = Date.now();
      callbacks.onRunEnd?.(run);
      return run;
    }

    const state = run.phaseStates[phase.id];
    state.status = 'running';
    state.startedAt = Date.now();
    run.updatedAt = state.startedAt;

    // Resolve agents for this phase
    const selected = selectAgentsForPhase(phase, members);
    state.selectedAgentIds = selected.map(m => m.id);

    if (selected.length === 0) {
      state.status = 'failed';
      state.error = `No agents available for phase "${phase.label}".`;
      state.endedAt = Date.now();
      run.updatedAt = state.endedAt;
      callbacks.onPhaseEnd?.(phase, state);
      callbacks.onPlanUpdate?.(run);
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

    const context = buildPhaseContext(phase, history, run);
    const promptForPhase = `${phase.prompt}\n\n[User request]\n${userMessage}`;

    try {
      const outputs: AgentWorkflowAgentOutput[] = [];

      const runOne = async (agent: AIMember, idx: number): Promise<AgentRunResult> => {
        const normalized = normalizeAgentMember(agent);
        const phaseAgentId = ordered.length > 1
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
        const results = await Promise.allSettled(selected.map((a, i) => runOne(a, i)));
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
        // 'single' or 1-member 'parallel'
        const member = selected[0];
        const result = await runOne(member, 0);
        outputs.push({
          agentId: result.agentId,
          agentName: result.agentName,
          content: result.content,
          isError: result.isError,
        });
      }

      state.outputs = outputs;
      state.summary = summarizePhaseState(state);
      const anyError = outputs.some(o => o.isError);
      state.status = anyError ? 'failed' : 'completed';
      state.endedAt = Date.now();
      run.updatedAt = state.endedAt;
      callbacks.onPhaseEnd?.(phase, state);
      callbacks.onPlanUpdate?.(run);

      if (anyError && (phase.onFailure || 'stop') === 'stop') {
        run.status = 'failed';
        callbacks.onRunEnd?.(run);
        return run;
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
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
      state.status = 'failed';
      state.error = err?.message || 'phase execution failed';
      state.endedAt = Date.now();
      run.updatedAt = state.endedAt;
      callbacks.onPhaseEnd?.(phase, state);
      callbacks.onPlanUpdate?.(run);
      if ((phase.onFailure || 'stop') === 'stop') {
        run.status = 'failed';
        run.updatedAt = Date.now();
        callbacks.onRunEnd?.(run);
        return run;
      }
    }
  }

  run.status = run.status === 'running' ? 'completed' : run.status;
  run.updatedAt = Date.now();
  callbacks.onRunEnd?.(run);
  return run;
}
