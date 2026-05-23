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

const mod = await importTsModule(new URL('./groupProduct.ts', import.meta.url));

assert.deepEqual(
  mod.productGroupTypes.map((item) => item.label),
  ['角色群', '专家群', '开发群'],
);

assert.deepEqual(
  mod.aiSpeechModes.map((item) => item.label),
  ['智能点名', '轮流发言', '全员圆桌'],
);

assert.deepEqual(
  mod.agentWorkflowTemplates.map((item) => item.label),
  ['专家会诊', '方案产出', '评审决策', '接力修改', '自动处理'],
);

assert.deepEqual(
  mod.cliWorkflowTemplates.map((item) => item.label),
  ['快速响应', '写完再审', '审核修正', '多人出方案', '隔离竞赛', '群内讨论'],
);

assert.equal(
  mod.applyAISpeechMode('smart').schedulerStrategy,
  'tag',
);
assert.equal(
  mod.applyAISpeechMode('smart').isGroupDiscussionMode,
  false,
);
assert.equal(
  mod.applyAISpeechMode('all').schedulerStrategy,
  'all',
);
assert.equal(
  mod.applyAISpeechMode('all').isGroupDiscussionMode,
  true,
);

assert.equal(
  mod.resolveAISpeechMode({ isGroupDiscussionMode: true, schedulerStrategy: 'tag' }),
  'all',
);
assert.equal(
  mod.resolveAISpeechMode({ isGroupDiscussionMode: false, schedulerStrategy: 'round_robin' }),
  'round_robin',
);
assert.equal(
  mod.resolveAISpeechMode({ isGroupDiscussionMode: false, schedulerStrategy: 'all' }),
  'all',
);

const developmentLoop = mod.cliWorkflowTemplates.find((item) => item.id === 'implement_review');
assert.equal(developmentLoop.strategy, 'review');
assert.equal(developmentLoop.defaultStages.join(' -> '), '实现 -> 审核 -> 修正 -> 验证');

const labels = JSON.stringify({
  groups: mod.productGroupTypes,
  agent: mod.agentWorkflowTemplates,
  cli: mod.cliWorkflowTemplates,
});
assert.doesNotMatch(labels, /工作台/);
assert.doesNotMatch(labels, /Workbench/i);

const wizard = await readFile(new URL('../pages/chat/components/CreateGroupWizard.tsx', import.meta.url), 'utf8');

for (const symbol of [
  'productGroupTypes',
  'aiSpeechModes',
  'agentWorkflowTemplates',
  'cliWorkflowTemplates',
  'applyAISpeechMode',
]) {
  assert.match(wizard, new RegExp(symbol));
}

for (const oldCopy of ['选择你要创建的群聊类型', 'AI 群聊', 'Agent 群聊', 'CLI Agent 群']) {
  assert.doesNotMatch(wizard, new RegExp(oldCopy));
}

const aiSettings = await readFile(new URL('../pages/chat/components/AIGroupSettings.tsx', import.meta.url), 'utf8');

assert.match(aiSettings, /发言方式/);
for (const symbol of ['aiSpeechModes', 'applyAISpeechMode', 'resolveAISpeechMode']) {
  assert.match(aiSettings, new RegExp(symbol));
}
assert.doesNotMatch(aiSettings, /全员讨论模式/);
assert.doesNotMatch(aiSettings, /调度策略/);

const agentSettings = await readFile(new URL('../pages/chat/components/AgentGroupSettings.tsx', import.meta.url), 'utf8');

assert.match(agentSettings, /专家群配置/);
assert.match(agentSettings, /群内协作方式/);
assert.match(agentSettings, /agentWorkflowTemplates/);
assert.match(agentSettings, /高级策略/);
