import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function importTsModule(url, transform = (s) => s) {
  const source = transform(await readFile(url, 'utf8'));
  const compiled = ts.transpileModule(`${source}\n// cb:${Date.now()}:${Math.random()}`, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  });
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`;
  return import(moduleUrl);
}

const runCalls = [];
let nextResponse = (agent) => ({ content: `${agent.name} ok` });

globalThis.__agentRuntimeStub = {
  isCLIMember: (m) => m && (m.kind === 'cli' || !!m.cli),
  hasCLIWorkspace: (gc) => !!gc?.workspacePath?.trim(),
  normalizeAgentMember: (m) => m,
  runSingleAgent: async (agent, userMsg, context, callbacks, _gc, opts) => {
    runCalls.push({ agentId: opts?.agentIdOverride || agent.id, phaseId: opts?.phaseId, prompt: userMsg, context });
    if (opts?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const r = nextResponse(agent, userMsg, context, opts);
    return {
      agentId: opts?.agentIdOverride || agent.id,
      agentName: agent.name,
      content: r.content,
      isError: !!r.isError,
    };
  },
  newAgentWorkflowRun: (plan) => {
    const phaseStates = {};
    for (const ph of plan.phases) {
      phaseStates[ph.id] = { phaseId: ph.id, status: 'pending', selectedAgentIds: [], outputs: [] };
    }
    return {
      id: `wf_${Math.random().toString(36).slice(2, 8)}`,
      plan,
      status: 'planned',
      phaseStates,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  },
};

const runner = await importTsModule(
  new URL('./agentWorkflowRunner.ts', import.meta.url),
  source => source.replace(
    /import \{\n  runSingleAgent,\n  normalizeAgentMember,\n  isCLIMember,\n  hasCLIWorkspace,\n\} from '\.\/agentRuntime';/,
    'const { runSingleAgent, normalizeAgentMember, isCLIMember, hasCLIWorkspace } = globalThis.__agentRuntimeStub;'
  ).replace(
    /import type \{\n  AgentRuntimeCallback,\n  AgentGroupContext,\n  AgentRunResult,\n\} from '\.\/agentRuntime';/,
    ''
  ).replace(
    "import { newAgentWorkflowRun } from '@/config/agentWorkflow';",
    'const { newAgentWorkflowRun } = globalThis.__agentRuntimeStub;'
  ).replace(
    /import type \{[\s\S]*?\} from '@\/config\/agentWorkflow';/,
    ''
  ).replace(
    "import type { AgentGroup } from '@/config/groups';",
    ''
  ).replace(
    "import type { AIMember } from '@/config/aiMembers';",
    ''
  ),
);

function group(overrides = {}) {
  return {
    id: 'g1', type: 'agent', name: 'T', description: '', memberIds: [],
    workspacePath: '/ws',
    workflowDefaults: { effort: 'standard', maxPhases: 5, maxParallelAgents: 3, alwaysShowPlan: false },
    ...overrides,
  };
}
function llm(id, name) {
  return { id, name, kind: 'agent', source: 'user', role: '', systemPrompt: '', providerId: 'p', model: 'm', tools: [], maxTurns: 1, temperature: 0 };
}
function plan(phases) {
  return { version: 1, title: 'T', intent: 'quick', riskLevel: 'low', requiresApproval: false, explanation: '', phases };
}
function callbacks() {
  const events = [];
  return {
    events,
    onRunStart: r => events.push(['runStart', r.status]),
    onPlanUpdate: r => events.push(['planUpdate', r.status]),
    onPhaseStart: (ph, st) => events.push(['phaseStart', ph.id, [...st.selectedAgentIds]]),
    onPhaseEnd: (ph, st) => events.push(['phaseEnd', ph.id, st.status]),
    onRunEnd: r => events.push(['runEnd', r.status]),
    onInfo: m => events.push(['info', m]),
    onAgentStart: () => {}, onToken: () => {}, onAgentEnd: () => {}, onError: () => {},
  };
}

// single phase / single agent
{
  runCalls.length = 0;
  const cb = callbacks();
  const p = plan([{ id: 'p1', label: 'Answer', mode: 'readOnly', schedule: 'single',
    agentSelection: { type: 'specific', agentIds: ['a'] }, prompt: 'answer', onFailure: 'stop' }]);
  const run = await runner.runAgentWorkflowPlan(group(), [llm('a', 'A')], p, 'why?', cb);
  assert.equal(run.status, 'completed');
  assert.equal(runCalls.length, 1);
  assert.equal(run.phaseStates['p1'].status, 'completed');
  assert.equal(run.phaseStates['p1'].outputs.length, 1);
  assert.ok(cb.events.some(e => e[0] === 'runEnd' && e[1] === 'completed'));
}

// parallel readOnly with 3 members
{
  runCalls.length = 0;
  const cb = callbacks();
  const members = [llm('a', 'A'), llm('b', 'B'), llm('c', 'C')];
  const p = plan([{ id: 'p1', label: 'Discuss', mode: 'readOnly', schedule: 'parallel',
    agentSelection: { type: 'specific', agentIds: ['a','b','c'] }, prompt: 'd' }]);
  const run = await runner.runAgentWorkflowPlan(group(), members, p, 'topic', cb);
  assert.equal(run.status, 'completed');
  assert.equal(run.phaseStates['p1'].outputs.length, 3);
  assert.equal(runCalls.length, 3);
}

// parallel write rejected
{
  runCalls.length = 0;
  const cb = callbacks();
  const members = [llm('a', 'A'), llm('b', 'B')];
  const p = plan([{ id: 'p1', label: 'BadWrite', mode: 'write', schedule: 'parallel',
    agentSelection: { type: 'specific', agentIds: ['a','b'] }, prompt: 'w' }]);
  await assert.rejects(() => runner.runAgentWorkflowPlan(group(), members, p, 'x', cb), /parallel/i);
  assert.equal(runCalls.length, 0);
}

// sequential: later sees earlier
{
  runCalls.length = 0;
  const cb = callbacks();
  const members = [llm('a', 'A'), llm('b', 'B')];
  const p = plan([{ id: 'p1', label: 'Seq', mode: 'readOnly', schedule: 'sequential',
    agentSelection: { type: 'specific', agentIds: ['a','b'] }, prompt: 'go' }]);
  const run = await runner.runAgentWorkflowPlan(group(), members, p, 'topic', cb);
  assert.equal(run.status, 'completed');
  assert.equal(runCalls.length, 2);
  assert.match(runCalls[1].context, /\[A said\]/);
}

// dependsOn: later sees prior summary
{
  runCalls.length = 0;
  const cb = callbacks();
  const members = [llm('a', 'A'), llm('b', 'B')];
  const p = plan([
    { id: 'plan', label: 'Plan', mode: 'readOnly', schedule: 'single',
      agentSelection: { type: 'specific', agentIds: ['a'] }, prompt: 'plan' },
    { id: 'do', label: 'Do', mode: 'readOnly', schedule: 'single',
      agentSelection: { type: 'specific', agentIds: ['b'] }, prompt: 'do', dependsOn: ['plan'] },
  ]);
  const run = await runner.runAgentWorkflowPlan(group(), members, p, 'task', cb);
  assert.equal(run.status, 'completed');
  assert.match(runCalls[1].context, /Output of phase "Plan"/);
}

// write phase rejected when workspace missing
{
  runCalls.length = 0;
  const cb = callbacks();
  const p = plan([{ id: 'p1', label: 'W', mode: 'write', schedule: 'single',
    agentSelection: { type: 'specific', agentIds: ['a'] }, prompt: 'w', onFailure: 'stop' }]);
  const run = await runner.runAgentWorkflowPlan(group({ workspacePath: '' }), [llm('a','A')], p, 'x', cb);
  assert.equal(run.status, 'failed');
  assert.equal(run.phaseStates['p1'].status, 'failed');
  assert.match(run.phaseStates['p1'].error, /workspace/);
}

// onFailure='stop' stops the run
{
  runCalls.length = 0;
  const cb = callbacks();
  const members = [llm('a','A'), llm('b','B')];
  nextResponse = (agent) => ({ content: agent.id === 'a' ? 'err' : 'ok', isError: agent.id === 'a' });
  const p = plan([
    { id: 'p1', label: 'P1', mode: 'readOnly', schedule: 'single',
      agentSelection: { type: 'specific', agentIds: ['a'] }, prompt: 'do', onFailure: 'stop' },
    { id: 'p2', label: 'P2', mode: 'readOnly', schedule: 'single',
      agentSelection: { type: 'specific', agentIds: ['b'] }, prompt: 'next', dependsOn: ['p1'] },
  ]);
  const run = await runner.runAgentWorkflowPlan(group(), members, p, 'x', cb);
  nextResponse = (agent) => ({ content: `${agent.name} ok` });
  assert.equal(run.status, 'failed');
  assert.equal(run.phaseStates['p1'].status, 'failed');
  assert.equal(run.phaseStates['p2'].status, 'pending');
}

// onFailure='continue' proceeds
{
  runCalls.length = 0;
  const cb = callbacks();
  const members = [llm('a','A'), llm('b','B')];
  nextResponse = (agent) => ({ content: agent.id === 'a' ? 'err' : 'ok', isError: agent.id === 'a' });
  const p = plan([
    { id: 'p1', label: 'P1', mode: 'readOnly', schedule: 'single',
      agentSelection: { type: 'specific', agentIds: ['a'] }, prompt: 'do', onFailure: 'continue' },
    { id: 'p2', label: 'P2', mode: 'readOnly', schedule: 'single',
      agentSelection: { type: 'specific', agentIds: ['b'] }, prompt: 'next', dependsOn: ['p1'] },
  ]);
  const run = await runner.runAgentWorkflowPlan(group(), members, p, 'x', cb);
  nextResponse = (agent) => ({ content: `${agent.name} ok` });
  assert.equal(run.phaseStates['p1'].status, 'failed');
  assert.equal(run.phaseStates['p2'].status, 'completed');
}

// abort signal cancels run
{
  runCalls.length = 0;
  const cb = callbacks();
  const ctrl = new AbortController();
  ctrl.abort();
  const p = plan([{ id: 'p1', label: 'X', mode: 'readOnly', schedule: 'single',
    agentSelection: { type: 'specific', agentIds: ['a'] }, prompt: 'x' }]);
  const run = await runner.runAgentWorkflowPlan(group(), [llm('a','A')], p, 'x', cb, { signal: ctrl.signal });
  assert.equal(run.status, 'cancelled');
}

// no agents for a phase + onFailure='stop' -> run failed
{
  runCalls.length = 0;
  const cb = callbacks();
  const p = plan([{ id: 'p1', label: 'Z', mode: 'readOnly', schedule: 'single',
    agentSelection: { type: 'specific', agentIds: ['ghost'] }, prompt: 'z', onFailure: 'stop' }]);
  const run = await runner.runAgentWorkflowPlan(group(), [llm('a','A')], p, 'x', cb);
  assert.equal(run.status, 'failed');
  assert.equal(run.phaseStates['p1'].status, 'failed');
}

console.log('agentWorkflowRunner.test.mjs: ok');
