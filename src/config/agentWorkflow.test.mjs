import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function importTsModule(url) {
  const source = await readFile(url, 'utf8');
  const compiled = ts.transpileModule(`${source}\n// cache-bust:${Date.now()}`, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`;
  return import(moduleUrl);
}

const mod = await importTsModule(new URL('./agentWorkflow.ts', import.meta.url));

// createDefaultAgentWorkflowDefaults
const defaults = mod.createDefaultAgentWorkflowDefaults();
assert.equal(defaults.effort, 'standard');
assert.equal(defaults.maxPhases, 5);
assert.equal(defaults.maxParallelAgents, 3);
assert.equal(defaults.alwaysShowPlan, false);

// newAgentWorkflowRunId uniqueness
const ids = new Set();
for (let i = 0; i < 100; i++) ids.add(mod.newAgentWorkflowRunId());
assert.equal(ids.size, 100);

// newAgentWorkflowRun shape
const minimalPlan = {
  version: 1,
  title: 'demo',
  intent: 'quick',
  riskLevel: 'low',
  requiresApproval: false,
  explanation: 'just a test',
  phases: [
    {
      id: 'p1',
      label: 'P1',
      mode: 'readOnly',
      schedule: 'single',
      agentSelection: { type: 'auto' },
      prompt: 'hello',
    },
  ],
};

const run = mod.newAgentWorkflowRun(minimalPlan);
assert.equal(run.status, 'planned');
assert.equal(run.plan, minimalPlan);
assert.equal(run.phaseStates.p1.status, 'pending');
assert.equal(run.phaseStates.p1.phaseId, 'p1');
assert.ok(run.createdAt > 0);

// validateAgentWorkflowPlan: ok minimal plan
let res = mod.validateAgentWorkflowPlan(minimalPlan, ['cli-codex']);
assert.equal(res.ok, true, JSON.stringify(res.errors));

// reject empty phases
res = mod.validateAgentWorkflowPlan(
  { ...minimalPlan, phases: [] },
  ['cli-codex'],
);
assert.equal(res.ok, false);
assert.match(res.errors[0], /at least one phase/);

// reject duplicate phase ids
res = mod.validateAgentWorkflowPlan(
  {
    ...minimalPlan,
    phases: [minimalPlan.phases[0], { ...minimalPlan.phases[0] }],
  },
  ['cli-codex'],
);
assert.equal(res.ok, false);
assert.ok(res.errors.some((e) => /duplicate/.test(e)));

// reject unknown dependency
res = mod.validateAgentWorkflowPlan(
  {
    ...minimalPlan,
    phases: [
      { ...minimalPlan.phases[0], id: 'p1', dependsOn: ['missing'] },
    ],
  },
  ['cli-codex'],
);
assert.equal(res.ok, false);
assert.ok(res.errors.some((e) => /unknown dependency/.test(e)));

// reject unknown agent id in specific selection
res = mod.validateAgentWorkflowPlan(
  {
    ...minimalPlan,
    phases: [
      {
        id: 'p1',
        label: 'P1',
        mode: 'readOnly',
        schedule: 'single',
        agentSelection: { type: 'specific', agentIds: ['ghost'] },
        prompt: 'hi',
      },
    ],
  },
  ['cli-codex'],
);
assert.equal(res.ok, false);
assert.ok(res.errors.some((e) => /unknown agent/.test(e)));

// reject too many phases
res = mod.validateAgentWorkflowPlan(
  {
    ...minimalPlan,
    phases: Array.from({ length: 6 }, (_, i) => ({
      id: `p${i}`,
      label: `P${i}`,
      mode: 'readOnly',
      schedule: 'single',
      agentSelection: { type: 'auto' },
      prompt: 'hi',
    })),
  },
  ['cli-codex'],
  { maxPhases: 3 },
);
assert.equal(res.ok, false);
assert.ok(res.errors.some((e) => /too many phases/.test(e)));

// planRequiresWorkspaceWrite
assert.equal(mod.planRequiresWorkspaceWrite(minimalPlan), false);
const writePlan = {
  ...minimalPlan,
  phases: [
    { ...minimalPlan.phases[0], id: 'impl', mode: 'write' },
  ],
};
assert.equal(mod.planRequiresWorkspaceWrite(writePlan), true);

// summarizeWorkflowPlan
const summary = mod.summarizeWorkflowPlan(minimalPlan);
assert.match(summary, /demo/);
assert.match(summary, /P1/);
assert.match(summary, /readOnly/);

// getWorkflowPlanApprovalReason
assert.equal(mod.getWorkflowPlanApprovalReason(minimalPlan), null);
assert.match(mod.getWorkflowPlanApprovalReason(writePlan) || '', /workspace/);
assert.match(
  mod.getWorkflowPlanApprovalReason({
    ...minimalPlan,
    riskLevel: 'high',
  }) || '',
  /high risk/,
);
assert.match(
  mod.getWorkflowPlanApprovalReason({
    ...minimalPlan,
    requiresApproval: true,
  }) || '',
  /approval/,
);

// verifier mode accepted when valid
{
  const verifierPlan = {
    ...minimalPlan,
    phases: [
      { ...minimalPlan.phases[0], id: 'p1' },
      {
        id: 'p2',
        label: 'P2',
        mode: 'verifier',
        schedule: 'single',
        agentSelection: { type: 'specific', agentIds: ['cli-codex'] },
        prompt: 'verify',
        dependsOn: ['p1'],
      },
    ],
  };
  const res = mod.validateAgentWorkflowPlan(verifierPlan, ['cli-codex']);
  assert.equal(res.ok, true, JSON.stringify(res.errors));
}

// verifier mode rejected without dependsOn
{
  const verifierPlan = {
    ...minimalPlan,
    phases: [
      {
        ...minimalPlan.phases[0],
        id: 'p2',
        mode: 'verifier',
        schedule: 'single',
        agentSelection: { type: 'specific', agentIds: ['cli-codex'] },
        prompt: 'verify',
      },
    ],
  };
  const res = mod.validateAgentWorkflowPlan(verifierPlan, ['cli-codex']);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => /verifier.*dependsOn/.test(e)));
}

// verifier mode rejected with non-single schedule
{
  const verifierPlan = {
    ...minimalPlan,
    phases: [
      { ...minimalPlan.phases[0], id: 'p1' },
      {
        id: 'p2',
        label: 'P2',
        mode: 'verifier',
        schedule: 'parallel',
        agentSelection: { type: 'specific', agentIds: ['cli-codex'] },
        prompt: 'verify',
        dependsOn: ['p1'],
      },
    ],
  };
  const res = mod.validateAgentWorkflowPlan(verifierPlan, ['cli-codex']);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => /verifier.*single/.test(e)));
}

// verifier mode rejected with multiple agents
{
  const verifierPlan = {
    ...minimalPlan,
    phases: [
      { ...minimalPlan.phases[0], id: 'p1' },
      {
        id: 'p2',
        label: 'P2',
        mode: 'verifier',
        schedule: 'single',
        agentSelection: { type: 'specific', agentIds: ['cli-codex', 'other'] },
        prompt: 'verify',
        dependsOn: ['p1'],
      },
    ],
  };
  const res = mod.validateAgentWorkflowPlan(verifierPlan, ['cli-codex', 'other']);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => /verifier.*single agent/.test(e)));
}

console.log('agentWorkflow.test.mjs: ok');
