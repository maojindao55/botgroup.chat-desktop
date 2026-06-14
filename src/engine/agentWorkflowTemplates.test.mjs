import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function importTsModule(url, transform = s => s) {
  const source = transform(await readFile(url, 'utf8'));
  const compiled = ts.transpileModule(`${source}\n// cache-bust:${Date.now()}`, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  });
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`;
  return import(moduleUrl);
}

// 内联 selection helper：读两个文件，去掉 import 行后拼接
const selectionSrc = await readFile(new URL('./agentWorkflowSelection.ts', import.meta.url), 'utf8');
const selectionBody = selectionSrc
  .replace(/import type \{[^}]*\} from '@\/config\/aiMembers';\n/, '');

const { templateBuilders } = await importTsModule(
  new URL('./agentWorkflowTemplates.ts', import.meta.url),
  (src) => src
    .replace(/import \{ resolveAgentSelection \} from '\.\/agentWorkflowSelection';\n/, '')
    .replace(/import type \{[^}]*\} from '@\/config\/aiMembers';\n/, '')
    .replace(/import type \{[^}]*\} from '@\/config\/agentWorkflow';\n/, '')
    + '\n' + selectionBody,
);

function mem(id, role) { return { id, name: id.toUpperCase(), kind: 'agent', role }; }
const three = [mem('a', 'implementer'), mem('b', 'reviewer'), mem('c', 'analyst')];
const ctx = (overrides = {}) => ({
  members: three, workspaceReady: true, maxParallel: 3, maxPhases: 5, locale: 'zh', t: undefined,
  ...overrides,
});

// T1 quick：单阶段 readOnly single
{
  const plan = templateBuilders.quick(ctx({ members: [mem('a', 'x')] }));
  assert.equal(plan.phases.length, 1);
  assert.equal(plan.phases[0].mode, 'readOnly');
  assert.equal(plan.phases[0].schedule, 'single');
  assert.equal(plan.requiresApproval, false);
  assert.deepEqual(plan.phases[0].agentSelection.agentIds, ['a']);
}

// T2 discuss：P1 parallel consult -> P2 synthesize, P2 dependsOn P1
{
  const plan = templateBuilders.discuss(ctx());
  assert.equal(plan.phases.length, 2);
  assert.equal(plan.phases[0].schedule, 'parallel');
  assert.equal(plan.phases[0].mode, 'readOnly');
  assert.deepEqual(plan.phases[1].dependsOn, [plan.phases[0].id]);
  // 汇总者排除 P1 参与者
  const consultIds = plan.phases[0].agentSelection.agentIds;
  assert.ok(!consultIds.includes(plan.phases[1].agentSelection.agentIds[0]));
  assert.equal(plan.requiresApproval, false);
}

// T3 multi_solution：P1 outputPolicy full
{
  const plan = templateBuilders.multi_solution(ctx());
  assert.equal(plan.phases.length, 2);
  assert.equal(plan.phases[0].schedule, 'parallel');
  assert.equal(plan.phases[0].outputPolicy, 'full');
  assert.deepEqual(plan.phases[1].dependsOn, [plan.phases[0].id]);
}

// T4 implement：单 write 阶段，requiresApproval true，outputPolicy diff
{
  const plan = templateBuilders.implement(ctx());
  assert.equal(plan.phases.length, 1);
  assert.equal(plan.phases[0].mode, 'write');
  assert.equal(plan.phases[0].schedule, 'single');
  assert.equal(plan.phases[0].outputPolicy, 'diff');
  assert.equal(plan.requiresApproval, true);
}

// T5 review：P1 write + retry, P2 verifier dependsOn P1
{
  const plan = templateBuilders.review(ctx());
  assert.equal(plan.phases.length, 2);
  assert.equal(plan.phases[0].mode, 'write');
  assert.equal(plan.phases[0].retry.maxAttempts, 2);
  assert.equal(plan.phases[1].mode, 'verifier');
  assert.deepEqual(plan.phases[1].dependsOn, [plan.phases[0].id]);
  assert.equal(plan.requiresApproval, true);
  // 复审者排除实现者
  assert.ok(plan.phases[0].agentSelection.agentIds[0] !== plan.phases[1].agentSelection.agentIds[0]);
}

// T6 audit：P1 parallel findings -> P2 synthesize
{
  const plan = templateBuilders.audit(ctx());
  assert.equal(plan.phases.length, 2);
  assert.equal(plan.phases[0].schedule, 'parallel');
  assert.equal(plan.phases[0].outputPolicy, 'findings');
  assert.deepEqual(plan.phases[1].dependsOn, [plan.phases[0].id]);
}

// count 截到 maxParallel
{
  const plan = templateBuilders.discuss(ctx({ maxParallel: 2 }));
  assert.ok(plan.phases[0].agentSelection.agentIds.length <= 2);
}

console.log('agentWorkflowTemplates.test.mjs: ok');
