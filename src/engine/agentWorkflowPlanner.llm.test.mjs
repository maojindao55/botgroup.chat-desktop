import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function importTsModule(url, transform = (source) => source) {
  const source = transform(await readFile(url, 'utf8'));
  const compiled = ts.transpileModule(`${source}\n// cache-bust:${Date.now()}:${Math.random()}`, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`;
  return import(moduleUrl);
}

// 1) Load agentWorkflow.ts for validation helpers
const agentWorkflowMod = await importTsModule(
  new URL('../config/agentWorkflow.ts', import.meta.url),
);

// 2) Load LLM planner, stubbing imports we cannot resolve in node
const llmPlannerMod = await importTsModule(
  new URL('./agentWorkflowPlanner.llm.ts', import.meta.url),
  source => source
    .replace(
      "import {\n  createDefaultAgentWorkflowDefaults,\n  validateAgentWorkflowPlan,\n  type AgentWorkflowPlan,\n  type AgentWorkflowPhase,\n} from '@/config/agentWorkflow';",
      `const createDefaultAgentWorkflowDefaults = ${agentWorkflowMod.createDefaultAgentWorkflowDefaults.toString()};\nconst validateAgentWorkflowPlan = ${agentWorkflowMod.validateAgentWorkflowPlan.toString()};`,
    )
    .replace(
      "import { resolveLlmCredentials } from '@/utils/resolveLlmCredentials';",
      'const resolveLlmCredentials = async () => ({ model: "stub" });',
    )
    .replace(
      "import { llmChatComplete } from '@/utils/llmClient';",
      'const llmChatComplete = async () => "{}";',
    )
    .replace(
      "import type { AgentWorkflowPlannerInput, AgentWorkflowPlannerResult } from './agentWorkflowPlanner';",
      '',
    ),
);

const { planAgentWorkflowWithLLM } = llmPlannerMod;

function group(overrides = {}) {
  return {
    id: 'g1',
    type: 'agent',
    name: 'Test',
    description: '',
    memberIds: [],
    workflowDefaults: { effort: 'standard', maxPhases: 5, maxParallelAgents: 3, alwaysShowPlan: false },
    workspacePath: '/tmp/ws',
    ...overrides,
  };
}

function llm(id, name) {
  return { id, name, kind: 'agent', source: 'user', role: 'analyst', systemPrompt: '', providerId: 'p', model: 'm', tools: [], maxTurns: 1, temperature: 0, capabilities: [] };
}

function buildCaller(response) {
  let lastParams = null;
  const fn = async (params) => {
    lastParams = params;
    return typeof response === 'function' ? response(params) : response;
  };
  fn.lastParams = () => lastParams;
  return fn;
}

// ---------- happy path ----------
{
  const members = [llm('a', 'A'), llm('b', 'B')];
  const goodPlan = {
    version: 1, title: 'Plan', intent: 'discuss', riskLevel: 'low',
    requiresApproval: false, explanation: 'discuss in parallel',
    phases: [{
      id: 'p1', label: 'Analyze', mode: 'readOnly', schedule: 'parallel',
      agentSelection: { type: 'specific', agentIds: ['a', 'b'] }, prompt: 'analyze',
    }],
  };
  const caller = buildCaller(JSON.stringify(goodPlan));
  const { plan, warnings } = await planAgentWorkflowWithLLM(
    { group: group(), members, userMessage: 'hello', workspaceReady: true },
    { providerId: 'p', model: 'm', caller },
  );
  assert.equal(plan.title, 'Plan');
  assert.equal(plan.phases.length, 1);
  assert.deepEqual(warnings, []);
  assert.match(caller.lastParams().systemPrompt, /AgentWorkflowPlan/);
  assert.match(caller.lastParams().userPrompt, /hello/);
}

// ---------- markdown code fence is stripped ----------
{
  const members = [llm('a', 'A')];
  const goodPlan = {
    version: 1, title: 'Plan', intent: 'quick', riskLevel: 'low',
    requiresApproval: false, explanation: '',
    phases: [{
      id: 'p1', label: 'Answer', mode: 'readOnly', schedule: 'single',
      agentSelection: { type: 'specific', agentIds: ['a'] }, prompt: 'answer',
    }],
  };
  const caller = buildCaller('```json\n' + JSON.stringify(goodPlan) + '\n```');
  const { plan } = await planAgentWorkflowWithLLM(
    { group: group(), members, userMessage: 'hi', workspaceReady: false },
    { providerId: 'p', model: 'm', caller },
  );
  assert.equal(plan.phases.length, 1);
}

// ---------- invalid JSON throws ----------
{
  const members = [llm('a', 'A')];
  const caller = buildCaller('not json at all');
  await assert.rejects(
    planAgentWorkflowWithLLM(
      { group: group(), members, userMessage: 'hi', workspaceReady: false },
      { providerId: 'p', model: 'm', caller },
    ),
    /not valid JSON/,
  );
}

// ---------- references unknown agentId -> rejected ----------
{
  const members = [llm('a', 'A')];
  const bad = {
    version: 1, title: 't', intent: 'quick', riskLevel: 'low',
    requiresApproval: false, explanation: '', phases: [{
      id: 'p1', label: 'L', mode: 'readOnly', schedule: 'single',
      agentSelection: { type: 'specific', agentIds: ['ghost'] }, prompt: 'p',
    }],
  };
  const caller = buildCaller(JSON.stringify(bad));
  await assert.rejects(
    planAgentWorkflowWithLLM(
      { group: group(), members, userMessage: 'hi', workspaceReady: false },
      { providerId: 'p', model: 'm', caller },
    ),
    /unknown agent/,
  );
}

// ---------- workspace missing -> write downgraded to readOnly ----------
{
  const members = [llm('a', 'A')];
  const plan = {
    version: 1, title: 't', intent: 'implement', riskLevel: 'high',
    requiresApproval: true, explanation: '', phases: [{
      id: 'p1', label: 'Implement', mode: 'write', schedule: 'single',
      agentSelection: { type: 'specific', agentIds: ['a'] }, prompt: 'do it', outputPolicy: 'diff',
    }],
  };
  const caller = buildCaller(JSON.stringify(plan));
  const result = await planAgentWorkflowWithLLM(
    { group: group({ workspacePath: '' }), members, userMessage: 'fix bug', workspaceReady: false },
    { providerId: 'p', model: 'm', caller },
  );
  assert.equal(result.plan.phases[0].mode, 'readOnly');
  assert.equal(result.plan.phases[0].outputPolicy, 'summary');
  assert.ok(result.warnings.some(w => /workspace/i.test(w)));
}

// ---------- parallel+write rewritten to single ----------
{
  const members = [llm('a', 'A'), llm('b', 'B')];
  const plan = {
    version: 1, title: 't', intent: 'implement', riskLevel: 'high',
    requiresApproval: true, explanation: '', phases: [{
      id: 'p1', label: 'ImplPar', mode: 'write', schedule: 'parallel',
      agentSelection: { type: 'specific', agentIds: ['a', 'b'] }, prompt: 'do it',
    }],
  };
  const caller = buildCaller(JSON.stringify(plan));
  const result = await planAgentWorkflowWithLLM(
    { group: group(), members, userMessage: 'fix bug', workspaceReady: true },
    { providerId: 'p', model: 'm', caller },
  );
  assert.equal(result.plan.phases[0].schedule, 'single');
  assert.equal(result.plan.phases[0].agentSelection.agentIds.length, 1);
  assert.ok(result.warnings.some(w => /parallel/i.test(w)));
}

// ---------- too many phases -> validation error ----------
{
  const members = [llm('a', 'A')];
  const phases = [];
  for (let i = 0; i < 6; i++) {
    phases.push({
      id: `p${i}`, label: `L${i}`, mode: 'readOnly', schedule: 'single',
      agentSelection: { type: 'specific', agentIds: ['a'] }, prompt: 'x',
    });
  }
  const plan = {
    version: 1, title: 't', intent: 'audit', riskLevel: 'low',
    requiresApproval: false, explanation: '', phases,
  };
  const caller = buildCaller(JSON.stringify(plan));
  await assert.rejects(
    planAgentWorkflowWithLLM(
      { group: group(), members, userMessage: 'audit', workspaceReady: true },
      { providerId: 'p', model: 'm', caller },
    ),
    /too many phases/,
  );
}

// ---------- revision instruction forwarded to prompt ----------
{
  const members = [llm('a', 'A')];
  const goodPlan = {
    version: 1, title: 't', intent: 'quick', riskLevel: 'low',
    requiresApproval: false, explanation: '', phases: [{
      id: 'p1', label: 'L', mode: 'readOnly', schedule: 'single',
      agentSelection: { type: 'specific', agentIds: ['a'] }, prompt: 'p',
    }],
  };
  const caller = buildCaller(JSON.stringify(goodPlan));
  await planAgentWorkflowWithLLM(
    { group: group(), members, userMessage: 'hi', workspaceReady: false, revisionInstruction: 'please be read-only' },
    { providerId: 'p', model: 'm', caller },
  );
  assert.match(caller.lastParams().userPrompt, /please be read-only/);
}

// ---------- requiresApproval enforced for write phases ----------
{
  const members = [llm('a', 'A')];
  const plan = {
    version: 1, title: 't', intent: 'implement', riskLevel: 'medium',
    requiresApproval: false, explanation: '', phases: [{
      id: 'p1', label: 'Impl', mode: 'write', schedule: 'single',
      agentSelection: { type: 'specific', agentIds: ['a'] }, prompt: 'do it',
    }],
  };
  const caller = buildCaller(JSON.stringify(plan));
  const result = await planAgentWorkflowWithLLM(
    { group: group(), members, userMessage: 'fix', workspaceReady: true },
    { providerId: 'p', model: 'm', caller },
  );
  assert.equal(result.plan.requiresApproval, true);
}

// ---------- empty response throws ----------
{
  const members = [llm('a', 'A')];
  const caller = buildCaller('');
  await assert.rejects(
    planAgentWorkflowWithLLM(
      { group: group(), members, userMessage: 'hi', workspaceReady: false },
      { providerId: 'p', model: 'm', caller },
    ),
    /empty response/,
  );
}

console.log('agentWorkflowPlanner.llm.test.mjs: ok');