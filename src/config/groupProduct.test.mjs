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
  ['快速响应', '规划实现复审', '审核修正', '多人出方案', '隔离竞赛', '只读讨论'],
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
assert.equal(developmentLoop.defaultStages.join(' -> '), '规划 -> 实现 -> 复审 -> 修正');

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

const cliSettings = await readFile(new URL('../pages/chat/components/CLIGroupSettings.tsx', import.meta.url), 'utf8');

assert.match(cliSettings, /开发群配置/);
assert.match(cliSettings, /协作方式/);
assert.match(cliSettings, /执行细节/);
assert.doesNotMatch(cliSettings, /群规/);
assert.doesNotMatch(cliSettings, /Runtime/);
assert.doesNotMatch(cliSettings, /本机 CLI Runtime 状态/);
assert.match(cliSettings, /cliWorkflowTemplates/);
assert.match(cliSettings, /CLI 会话复用/);
assert.match(cliSettings, /开发群友/);

const memberLibrary = await readFile(new URL('../pages/chat/components/AIMemberLibrary.tsx', import.meta.url), 'utf8');

for (const copy of ['资源库', '新增角色', '新增专家', '新增开发群友', '模型服务']) {
  assert.match(memberLibrary, new RegExp(copy));
}
for (const oldCopy of ['AI 群员管理库', 'AI 群员库', 'LLM 角色', 'Agent 协作', 'CLI Agent', '暂无群员']) {
  assert.doesNotMatch(memberLibrary, new RegExp(oldCopy));
}

const memberEditor = await readFile(new URL('../pages/chat/components/AIMemberEditor.tsx', import.meta.url), 'utf8');

for (const copy of ['编辑资源', '新建资源', '资源类型', '资源名称', '角色', '专家', '开发群友']) {
  assert.match(memberEditor, new RegExp(copy));
}
for (const oldCopy of ['编辑群员', '新建群员', '群员类型', '群员名称', 'LLM 角色', '>Agent<', 'CLI Agent']) {
  assert.doesNotMatch(memberEditor, new RegExp(oldCopy));
}

const memberPicker = await readFile(new URL('../pages/chat/components/MemberPicker.tsx', import.meta.url), 'utf8');

assert.match(memberPicker, /开发群友/);
assert.doesNotMatch(memberPicker, /CLI Agent/);
assert.doesNotMatch(memberPicker, /选择群员/);

const sidebar = await readFile(new URL('../pages/chat/components/Sidebar.tsx', import.meta.url), 'utf8');

assert.match(sidebar, /getProductGroupType/);
assert.match(sidebar, /群聊空间/);
assert.match(sidebar, /资源库/);
for (const oldCopy of ['工作空间', 'AI 群员库', '>AI<', '>CLI<', '>Agent<']) {
  assert.doesNotMatch(sidebar, new RegExp(oldCopy));
}

const chatUI = await readFile(new URL('../pages/chat/components/ChatUI.tsx', import.meta.url), 'utf8');

assert.match(chatUI, /群聊中没有启用的开发群友/);
assert.match(chatUI, /开发群友将在 workspace 中协作执行/);
assert.match(chatUI, /当前协作方式是“只读讨论”/);
assert.match(chatUI, /资源库/);
assert.doesNotMatch(chatUI, /当前群规是/);
assert.doesNotMatch(chatUI, /CLI Agent 将在 workspace 中执行/);
assert.doesNotMatch(chatUI, /AI 群员库（/);

const agentChatUI = await readFile(new URL('../pages/chat/components/AgentChatUI.tsx', import.meta.url), 'utf8');

assert.match(agentChatUI, /专家群/);
assert.match(agentChatUI, /位专家/);
assert.match(agentChatUI, /资源库/);
assert.match(agentChatUI, /专家群友将按群规协作回复/);
assert.doesNotMatch(agentChatUI, /Agent 协作群/);
assert.doesNotMatch(agentChatUI, /AI 群员库/);

const readme = await readFile(new URL('../../README.md', import.meta.url), 'utf8');

for (const copy of ['角色群', '专家群', '开发群', '资源库']) {
  assert.match(readme, new RegExp(copy));
}
assert.doesNotMatch(readme, /AI 群聊/);
