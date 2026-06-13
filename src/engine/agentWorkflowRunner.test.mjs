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
  applyOutputPolicy: async (outputs, opts = {}) => {
    if (outputs.length === 0) return '';
    if (outputs.length === 1) return outputs[0].content || '';
    return outputs.map(o => `### ${o.agentName}\n${o.content || ''}`).join('\n\n');
  },
  wrapVerifierPrompt: ({ phase }) => `verifier: ${phase.prompt}`,
  parseVerdict: (output) => {
    const text = (output || '').trim();
    const first = text.split(/\r?\n/)[0] || '';
    if (/^fail\b/i.test(first)) return { verdict: 'fail', reasoning: text };
    return { verdict: 'pass', reasoning: text };
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
  ).replace(
    "import { applyOutputPolicy, type SummaryOptions } from './agentWorkflowOutputPolicy';",
    'const { applyOutputPolicy } = globalThis.__agentRuntimeStub;'
  ).replace(
    /import \{ parseVerdict, wrapVerifierPrompt \} from '\.\/agentWorkflowVerifier';/,
    'const { parseVerdict, wrapVerifierPrompt } = globalThis.__agentRuntimeStub;'
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
  assert.match(runCalls[0].prompt, /multi-phase workflow/);
  assert.match(runCalls[0].prompt, /Phase task/);
  assert.match(runCalls[0].prompt, /Background user request/);
  assert.match(runCalls[0].prompt, /Focus on the Phase task/);
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

// retry: phase fails once then succeeds within maxAttempts
{
  runCalls.length = 0;
  const cb = callbacks();
  let attempt = 0;
  nextResponse = (agent) => {
    attempt += 1;
    if (attempt === 1) return { content: 'first attempt failed', isError: true };
    return { content: 'second attempt ok' };
  };
  const p = plan([
    { id: 'p1', label: 'Retry me', mode: 'readOnly', schedule: 'single',
      agentSelection: { type: 'specific', agentIds: ['a'] }, prompt: 'do',
      retry: { maxAttempts: 2 } },
  ]);
  const run = await runner.runAgentWorkflowPlan(group(), [llm('a','A')], p, 'x', cb);
  nextResponse = (agent) => ({ content: `${agent.name} ok` });
  assert.equal(run.status, 'completed');
  assert.equal(run.phaseStates['p1'].status, 'completed');
  assert.equal(run.phaseStates['p1'].attempts, 2);
  assert.equal(run.phaseStates['p1'].attemptHistory.length, 2);
  assert.equal(run.phaseStates['p1'].attemptHistory[0].status, 'failed');
  assert.equal(run.phaseStates['p1'].attemptHistory[1].status, 'completed');
}

// retry: feedback from previous attempt is injected into context
{
  runCalls.length = 0;
  const cb = callbacks();
  let attempt = 0;
  nextResponse = (agent, _msg, context) => {
    attempt += 1;
    if (attempt === 1) return { content: 'broken output', isError: true };
    return { content: `saw context: ${context.slice(0, 200)}` };
  };
  const p = plan([
    { id: 'p1', label: 'P1', mode: 'readOnly', schedule: 'single',
      agentSelection: { type: 'specific', agentIds: ['a'] }, prompt: 'do',
      retry: { maxAttempts: 2 } },
  ]);
  const run = await runner.runAgentWorkflowPlan(group(), [llm('a','A')], p, 'x', cb);
  nextResponse = (agent) => ({ content: `${agent.name} ok` });
  const secondCtx = runCalls[1]?.context || '';
  assert.match(secondCtx, /Previous attempt feedback/);
  assert.equal(run.phaseStates['p1'].status, 'completed');
}

// retry exhausted -> phase failed -> onFailure='stop' stops run
{
  runCalls.length = 0;
  const cb = callbacks();
  nextResponse = () => ({ content: 'always fails', isError: true });
  const p = plan([
    { id: 'p1', label: 'P1', mode: 'readOnly', schedule: 'single',
      agentSelection: { type: 'specific', agentIds: ['a'] }, prompt: 'do',
      retry: { maxAttempts: 2 }, onFailure: 'stop' },
  ]);
  const run = await runner.runAgentWorkflowPlan(group(), [llm('a','A')], p, 'x', cb);
  nextResponse = (agent) => ({ content: `${agent.name} ok` });
  assert.equal(run.status, 'failed');
  assert.equal(run.phaseStates['p1'].attempts, 2);
  assert.equal(run.phaseStates['p1'].status, 'failed');
}

// retry: feedbackFromPhaseId pulls feedback from another phase
{
  runCalls.length = 0;
  const cb = callbacks();
  nextResponse = (agent, _msg, context) => {
    if (agent.id === 'reviewer') return { content: '- needs more tests\n- missing error handling' };
    if (agent.id === 'impl' && !context.includes('Previous attempt feedback')) {
      return { content: 'first impl', isError: true };
    }
    return { content: 'impl after feedback' };
  };
  const p = plan([
    { id: 'impl', label: 'Impl', mode: 'readOnly', schedule: 'single',
      agentSelection: { type: 'specific', agentIds: ['impl'] }, prompt: 'implement',
      retry: { maxAttempts: 2, feedbackFromPhaseId: 'review' } },
    { id: 'review', label: 'Review', mode: 'readOnly', schedule: 'single',
      agentSelection: { type: 'specific', agentIds: ['reviewer'] }, prompt: 'review',
      dependsOn: ['impl'] },
  ]);
  const run = await runner.runAgentWorkflowPlan(
    group(),
    [llm('impl', 'Impl'), llm('reviewer', 'Reviewer')],
    p, 'x', cb,
  );
  nextResponse = (agent) => ({ content: `${agent.name} ok` });
  assert.equal(run.phaseStates['impl'].status, 'completed');
  assert.equal(run.phaseStates['impl'].attempts, 2);
}

// verifier: PASS completes run
{
  runCalls.length = 0;
  const cb = callbacks();
  nextResponse = (agent) => ({ content: agent.id === 'v' ? 'PASS\nAll good' : 'implemented' });
  const p = plan([
    { id: 'impl', label: 'Impl', mode: 'readOnly', schedule: 'single',
      agentSelection: { type: 'specific', agentIds: ['coder'] }, prompt: 'implement' },
    { id: 'v', label: 'Verify', mode: 'verifier', schedule: 'single',
      agentSelection: { type: 'specific', agentIds: ['v'] }, prompt: 'verify',
      dependsOn: ['impl'] },
  ]);
  const run = await runner.runAgentWorkflowPlan(
    group(),
    [llm('coder', 'Coder'), llm('v', 'Verifier')],
    p, 'x', cb,
  );
  nextResponse = (agent) => ({ content: `${agent.name} ok` });
  assert.equal(run.status, 'completed');
  assert.equal(run.phaseStates['v'].status, 'completed');
  assert.equal(run.phaseStates['v'].verdict, 'pass');
  assert.ok(runCalls.some(c => c.phaseId === 'v' && c.prompt.includes('verifier:')));
}

// verifier: FAIL triggers upstream retry, then succeeds
{
  runCalls.length = 0;
  const cb = callbacks();
  let implAttempt = 0;
  nextResponse = (agent) => {
    if (agent.id === 'coder') {
      implAttempt += 1;
      return { content: `impl v${implAttempt}` };
    }
    return { content: implAttempt === 1 ? 'FAIL\n- missing tests' : 'PASS\nAll good' };
  };
  const p = plan([
    { id: 'impl', label: 'Impl', mode: 'readOnly', schedule: 'single',
      agentSelection: { type: 'specific', agentIds: ['coder'] }, prompt: 'implement',
      retry: { maxAttempts: 2 } },
    { id: 'v', label: 'Verify', mode: 'verifier', schedule: 'single',
      agentSelection: { type: 'specific', agentIds: ['verifier'] }, prompt: 'verify',
      dependsOn: ['impl'], onFailure: 'stop' },
  ]);
  const run = await runner.runAgentWorkflowPlan(
    group(),
    [llm('coder', 'Coder'), llm('verifier', 'Verifier')],
    p, 'x', cb,
  );
  nextResponse = (agent) => ({ content: `${agent.name} ok` });
  assert.equal(run.status, 'completed');
  assert.equal(run.phaseStates['impl'].attempts, 2);
  assert.equal(run.phaseStates['impl'].status, 'completed');
  assert.equal(run.phaseStates['v'].attempts, 2);
  assert.equal(run.phaseStates['v'].verdict, 'pass');
}

// verifier: FAIL with exhausted upstream retry fails run
{
  runCalls.length = 0;
  const cb = callbacks();
  nextResponse = (agent) => {
    if (agent.id === 'coder') return { content: 'impl' };
    return { content: 'FAIL\n- missing tests' };
  };
  const p = plan([
    { id: 'impl', label: 'Impl', mode: 'readOnly', schedule: 'single',
      agentSelection: { type: 'specific', agentIds: ['coder'] }, prompt: 'implement',
      retry: { maxAttempts: 2 } },
    { id: 'v', label: 'Verify', mode: 'verifier', schedule: 'single',
      agentSelection: { type: 'specific', agentIds: ['verifier'] }, prompt: 'verify',
      dependsOn: ['impl'], onFailure: 'stop' },
  ]);
  const run = await runner.runAgentWorkflowPlan(
    group(),
    [llm('coder', 'Coder'), llm('verifier', 'Verifier')],
    p, 'x', cb,
  );
  nextResponse = (agent) => ({ content: `${agent.name} ok` });
  assert.equal(run.status, 'failed');
  assert.equal(run.phaseStates['impl'].attempts, 2);
  assert.equal(run.phaseStates['v'].verdict, 'fail');
}

console.log('agentWorkflowRunner.test.mjs: ok');
