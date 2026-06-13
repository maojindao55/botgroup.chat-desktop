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

const { planAgentWorkflow, planAgentWorkflowSmart } = await importTsModule(
  new URL('./agentWorkflowPlanner.ts', import.meta.url),
  source => source.replace(
    "import {\n  createDefaultAgentWorkflowDefaults,\n  type AgentWorkflowPlan,\n  type AgentWorkflowIntent,\n} from '@/config/agentWorkflow';",
    `const createDefaultAgentWorkflowDefaults = () => ({ effort: 'standard', maxPhases: 5, maxParallelAgents: 3, alwaysShowPlan: false });`,
  ),
);

function group(overrides = {}) {
  return {
    id: 'g1',
    type: 'agent',
    name: 'Test',
    description: '',
    memberIds: [],
    workflowDefaults: {
      effort: 'standard',
      maxPhases: 5,
      maxParallelAgents: 3,
      alwaysShowPlan: false,
    },
    ...overrides,
  };
}

function llm(id, name) {
  return {
    id, name,
    kind: 'agent',
    source: 'user',
    role: 'analyst',
    systemPrompt: '',
    providerId: 'p',
    model: 'm',
    tools: [],
    maxTurns: 1,
    temperature: 0,
    capabilities: [],
  };
}

// ---------- minimal fallback: no mention -> single agent, readOnly ----------
{
  const members = [llm('a', 'A'), llm('b', 'B'), llm('c', 'C')];
  const { plan, warnings } = planAgentWorkflow({
    group: group(), members, userMessage: 'hi', workspaceReady: false,
  });
  assert.equal(plan.intent, 'quick');
  assert.equal(plan.phases.length, 1);
  assert.equal(plan.phases[0].schedule, 'single');
  assert.equal(plan.phases[0].mode, 'readOnly');
  assert.deepEqual(plan.phases[0].agentSelection.agentIds, ['a']);
  assert.equal(plan.requiresApproval, false);
  assert.deepEqual(warnings, []);
}

// ---------- mention single member -> single phase, that member ----------
{
  const members = [llm('a', 'A'), llm('b', 'B'), llm('c', 'C')];
  const { plan } = planAgentWorkflow({
    group: group(), members, userMessage: 'hi', workspaceReady: false,
    mentionedAgentIds: ['b'],
  });
  assert.equal(plan.phases[0].schedule, 'single');
  assert.deepEqual(plan.phases[0].agentSelection.agentIds, ['b']);
}

// ---------- mention multiple members -> parallel within maxParallelAgents ----------
{
  const members = [llm('a', 'A'), llm('b', 'B'), llm('c', 'C'), llm('d', 'D')];
  const { plan } = planAgentWorkflow({
    group: group(), members, userMessage: 'hi', workspaceReady: false,
    mentionedAgentIds: ['a', 'b', 'c'],
  });
  assert.equal(plan.phases[0].schedule, 'parallel');
  assert.deepEqual(plan.phases[0].agentSelection.agentIds, ['a', 'b', 'c']);
}

// ---------- mention more than maxParallelAgents -> capped ----------
{
  const members = [llm('a', 'A'), llm('b', 'B'), llm('c', 'C'), llm('d', 'D')];
  const { plan } = planAgentWorkflow({
    group: group({
      workflowDefaults: { effort: 'fast', maxPhases: 5, maxParallelAgents: 2, alwaysShowPlan: false },
    }),
    members, userMessage: 'hi', workspaceReady: false,
    mentionedAgentIds: ['a', 'b', 'c', 'd'],
  });
  assert.equal(plan.phases[0].agentSelection.agentIds.length, 2);
  assert.equal(plan.phases[0].schedule, 'parallel');
}

// ---------- fallback never emits write phases regardless of input ----------
{
  const members = [llm('a', 'A')];
  const { plan } = planAgentWorkflow({
    group: group(), members,
    userMessage: 'please implement a dark mode toggle and fix the login bug',
    workspaceReady: true,
  });
  assert.ok(plan.phases.every(p => p.mode === 'readOnly'));
  assert.equal(plan.requiresApproval, false);
  assert.equal(plan.riskLevel, 'low');
}

// ---------- no members -> empty plan + warning ----------
{
  const { plan, warnings } = planAgentWorkflow({
    group: group(), members: [], userMessage: 'hi', workspaceReady: false,
  });
  assert.equal(plan.phases.length, 0);
  assert.equal(plan.intent, 'quick');
  assert.ok(warnings.length > 0);
}

// ---------- mentioning unknown ids resolves to no eligible members -> empty plan ----------
{
  const members = [llm('a', 'A'), llm('b', 'B')];
  const { plan, warnings } = planAgentWorkflow({
    group: group(), members, userMessage: 'hi', workspaceReady: false,
    mentionedAgentIds: ['nope'],
  });
  assert.equal(plan.phases.length, 0);
  assert.ok(warnings.length > 0);
}

// ---------- legacy groups without workflowDefaults still plan safely ----------
{
  const legacyGroup = group();
  delete legacyGroup.workflowDefaults;
  const { plan } = planAgentWorkflow({
    group: legacyGroup,
    members: [llm('a', 'A'), llm('b', 'B')],
    userMessage: 'hi',
    workspaceReady: false,
    mentionedAgentIds: ['a', 'b'],
  });
  assert.equal(plan.phases[0].schedule, 'parallel');
  assert.equal(plan.phases[0].agentSelection.agentIds.length, 2);
}

// ---------- planAgentWorkflowSmart without llm options falls through to fallback ----------
{
  const members = [llm('a', 'A')];
  const result = await planAgentWorkflowSmart({
    group: group(), members, userMessage: 'hi', workspaceReady: false,
  });
  assert.equal(result.plan.phases.length, 1);
  assert.equal(result.plan.phases[0].mode, 'readOnly');
}

console.log('agentWorkflowPlanner.test.mjs: ok');
