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

const { planAgentWorkflow, detectIntent } = await importTsModule(
  new URL('./agentWorkflowPlanner.ts', import.meta.url),
  source => source.replace(
    "import {\n  createDefaultAgentWorkflowDefaults,\n  type AgentWorkflowPlan,\n  type AgentWorkflowPhase,\n  type AgentWorkflowIntent,\n  type AgentWorkflowRiskLevel,\n} from '@/config/agentWorkflow';",
    'const createDefaultAgentWorkflowDefaults = () => ({ effort: \'standard\', maxPhases: 5, maxParallelAgents: 3, alwaysShowPlan: false });',
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

function cli(id, name, caps = []) {
  return {
    id, name,
    kind: 'cli',
    source: 'user',
    capabilities: caps,
    cli: { adapter: 'codex' },
  };
}

function llm(id, name, caps = []) {
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
    capabilities: caps,
  };
}

// ---------- detectIntent ----------
assert.equal(detectIntent('hello'), 'quick');
assert.equal(detectIntent('please fix the login bug'), 'implement');
assert.equal(detectIntent('讨论一下这个架构'), 'discuss');
assert.equal(detectIntent('compare multiple solutions for caching'), 'multi_solution');
assert.equal(detectIntent('review the latest diff'), 'review');
assert.equal(detectIntent('do a full security audit of the repo'), 'audit');
assert.equal(detectIntent('anything', 'discuss'), 'discuss');

// ---------- quick (default, no workspace) ----------
{
  const members = [llm('a', 'A', ['research'])];
  const { plan, warnings } = planAgentWorkflow({
    group: group(), members, userMessage: 'what is RAG?', workspaceReady: false,
  });
  assert.equal(plan.intent, 'quick');
  assert.equal(plan.phases.length, 1);
  assert.equal(plan.phases[0].schedule, 'single');
  assert.equal(plan.phases[0].mode, 'readOnly');
  assert.equal(plan.requiresApproval, false);
  assert.deepEqual(warnings, []);
}

// ---------- discuss with multiple members goes parallel + synthesize ----------
{
  const members = [
    llm('a', 'A', ['codebase-analysis']),
    llm('b', 'B', ['research']),
    llm('c', 'C', ['product']),
  ];
  const { plan } = planAgentWorkflow({
    group: group(), members,
    userMessage: 'discuss the trade-offs of microservices', workspaceReady: false,
  });
  assert.equal(plan.intent, 'discuss');
  assert.equal(plan.phases.length, 2);
  assert.equal(plan.phases[0].schedule, 'parallel');
  assert.equal(plan.phases[0].agentSelection.agentIds.length, 3);
  assert.equal(plan.phases[1].schedule, 'single');
  assert.deepEqual(plan.phases[1].dependsOn, [plan.phases[0].id]);
}

// ---------- implement with workspace -> plan/implement/review + requiresApproval ----------
{
  const members = [
    llm('arch', 'Arch', ['codebase-analysis', 'product']),
    cli('codex', 'Codex', ['implementation']),
    llm('rev', 'Rev', ['code-review', 'testing']),
  ];
  const { plan, warnings } = planAgentWorkflow({
    group: group(), members,
    userMessage: 'please implement a dark-mode toggle',
    workspaceReady: true,
  });
  assert.equal(plan.intent, 'implement');
  assert.equal(plan.phases.length, 3);
  assert.equal(plan.phases[0].mode, 'readOnly');
  assert.equal(plan.phases[1].mode, 'write');
  assert.equal(plan.phases[2].mode, 'review');
  assert.equal(plan.requiresApproval, true);
  assert.equal(plan.riskLevel, 'high');
  // implementer is the CLI Codex (capability=implementation)
  assert.deepEqual(plan.phases[1].agentSelection.agentIds, ['codex']);
  // reviewer is not the implementer
  assert.notDeepEqual(plan.phases[2].agentSelection.agentIds, ['codex']);
  assert.deepEqual(warnings, []);
}

// ---------- implement without workspace -> downgraded to discuss + warning ----------
{
  const members = [llm('a', 'A', ['implementation']), llm('b', 'B')];
  const { plan, warnings } = planAgentWorkflow({
    group: group(), members,
    userMessage: 'fix the login bug', workspaceReady: false,
  });
  assert.equal(plan.intent, 'discuss');
  assert.ok(warnings.some(w => /workspace/i.test(w)));
  assert.ok(plan.phases.every(p => p.mode !== 'write'));
}

// ---------- multi_solution -> proposals (parallel) + review ----------
{
  const members = [
    llm('a', 'A', ['implementation']),
    llm('b', 'B', ['product']),
    llm('c', 'C', ['research']),
  ];
  const { plan } = planAgentWorkflow({
    group: group(), members,
    userMessage: 'give me multiple solutions for rate limiting', workspaceReady: false,
  });
  assert.equal(plan.intent, 'multi_solution');
  assert.equal(plan.phases[0].schedule, 'parallel');
  assert.equal(plan.phases[1].mode, 'review');
}

// ---------- review intent -> parallel reviewers ----------
{
  const members = [
    llm('a', 'A', ['code-review']),
    llm('b', 'B', ['testing']),
  ];
  const { plan } = planAgentWorkflow({
    group: group(), members,
    userMessage: 'review the recent changes', workspaceReady: true,
  });
  assert.equal(plan.intent, 'review');
  assert.equal(plan.phases.length, 1);
  assert.equal(plan.phases[0].schedule, 'parallel');
  assert.equal(plan.phases[0].mode, 'review');
}

// ---------- audit intent ----------
{
  const members = [
    llm('a', 'A', ['security']),
    llm('b', 'B', ['performance']),
    llm('c', 'C', ['codebase-analysis']),
  ];
  const { plan } = planAgentWorkflow({
    group: group(), members,
    userMessage: 'full security audit of the codebase', workspaceReady: true,
  });
  assert.equal(plan.intent, 'audit');
  assert.equal(plan.phases[0].schedule, 'parallel');
  assert.equal(plan.phases[0].agentSelection.agentIds.length, 3);
  assert.equal(plan.phases.length, 2);
  assert.equal(plan.phases[1].schedule, 'single');
}

// ---------- maxParallelAgents caps parallel size ----------
{
  const members = [
    llm('a', 'A', ['research']), llm('b', 'B', ['research']),
    llm('c', 'C', ['research']), llm('d', 'D', ['research']),
  ];
  const { plan } = planAgentWorkflow({
    group: group({ workflowDefaults: { effort: 'fast', maxPhases: 5, maxParallelAgents: 2, alwaysShowPlan: false } }),
    members,
    userMessage: 'discuss this topic', workspaceReady: false,
  });
  assert.ok(plan.phases[0].agentSelection.agentIds.length <= 2);
}

// ---------- maxPhases caps total phases ----------
{
  const members = [llm('a', 'A', ['codebase-analysis']), llm('b', 'B'), llm('c', 'C', ['code-review'])];
  const { plan, warnings } = planAgentWorkflow({
    group: group({ workflowDefaults: { effort: 'fast', maxPhases: 1, maxParallelAgents: 2, alwaysShowPlan: false } }),
    members,
    userMessage: 'implement the new feature', workspaceReady: true,
  });
  assert.equal(plan.phases.length, 1);
  assert.ok(warnings.some(w => /truncated/i.test(w)));
}

// ---------- revision instruction can force read-only replanning ----------
{
  const members = [
    llm('arch', 'Arch', ['codebase-analysis']),
    cli('codex', 'Codex', ['implementation']),
  ];
  const { plan, warnings } = planAgentWorkflow({
    group: group(), members,
    userMessage: 'implement dark mode', workspaceReady: true,
    revisionInstruction: '不要改文件，只读讨论',
  });
  assert.equal(plan.intent, 'discuss');
  assert.ok(plan.phases.every(p => p.mode !== 'write'));
  assert.ok(warnings.some(w => /read-only/i.test(w)));
}

// ---------- revision instruction can cap to one parallel agent ----------
{
  const members = [llm('a', 'A', ['research']), llm('b', 'B', ['research'])];
  const { plan } = planAgentWorkflow({
    group: group(), members,
    userMessage: 'discuss this', workspaceReady: false,
    revisionInstruction: 'only one agent',
  });
  assert.ok(plan.phases.every(p => p.agentSelection.agentIds.length <= 1));
}

// ---------- mentionedAgentIds restricts to a subset ----------
{
  const members = [
    llm('a', 'A', ['code-review']),
    llm('b', 'B', ['research']),
    llm('c', 'C', ['testing']),
  ];
  const { plan } = planAgentWorkflow({
    group: group(), members,
    userMessage: 'discuss this', workspaceReady: false,
    mentionedAgentIds: ['b'],
  });
  const ids = plan.phases.flatMap(p => p.agentSelection.agentIds);
  assert.ok(ids.every(id => id === 'b'));
}

// ---------- legacy groups without workflowDefaults still plan safely ----------
{
  const legacyGroup = group();
  delete legacyGroup.workflowDefaults;
  const { plan } = planAgentWorkflow({
    group: legacyGroup,
    members: [llm('a', 'A')],
    userMessage: 'hi',
    workspaceReady: false,
  });
  assert.equal(plan.phases.length, 1);
}

// ---------- no members -> empty plan + warning ----------
{
  const { plan, warnings } = planAgentWorkflow({
    group: group(), members: [], userMessage: 'hi', workspaceReady: false,
  });
  assert.equal(plan.phases.length, 0);
  assert.ok(warnings.length > 0);
}

console.log('agentWorkflowPlanner.test.mjs: ok');
