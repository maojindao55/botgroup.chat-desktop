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
  ['快速响应', '规划实现复审', '排查修复复审', '审核修正', '多人出方案', '隔离竞赛', '只读讨论'],
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

const diagnoseFixReview = mod.cliWorkflowTemplates.find((item) => item.id === 'diagnose_fix_review');
assert.equal(diagnoseFixReview.strategy, 'review');
assert.equal(diagnoseFixReview.customWorkflow.stages.map((stage) => stage.label).join(' -> '), '定位修复 -> 复审 -> 修正');
assert.equal(diagnoseFixReview.customWorkflow.stages[1].reviewDecision.revise, 'revise');

assert.equal(mod.getCLIWorkflowLabel('review', 'implement_review'), '规划实现复审');
assert.equal(mod.getCLIWorkflowLabel('review', 'diagnose_fix_review'), '排查修复复审');
assert.equal(mod.getCLIWorkflowLabel('race', 'isolated_race'), '隔离竞赛');
assert.equal(mod.getCLIWorkflowLabel('sequential', 'multi_solution'), '多人出方案');

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

assert.match(aiSettings, /useTranslation/);
assert.match(aiSettings, /settings:aiGroup/);
for (const symbol of ['aiSpeechModes', 'applyAISpeechMode', 'resolveAISpeechMode']) {
  assert.match(aiSettings, new RegExp(symbol));
}
assert.doesNotMatch(aiSettings, /全员讨论模式/);
assert.doesNotMatch(aiSettings, /调度策略/);

const agentSettings = await readFile(new URL('../pages/chat/components/AgentGroupSettings.tsx', import.meta.url), 'utf8');

assert.match(agentSettings, /useTranslation/);
assert.match(agentSettings, /settings:agentGroup/);
assert.match(agentSettings, /agentWorkflowTemplates/);
assert.match(agentSettings, /settings:strategies/);

const cliSettings = await readFile(new URL('../pages/chat/components/CLIGroupSettings.tsx', import.meta.url), 'utf8');

assert.match(cliSettings, /useTranslation/);
assert.match(cliSettings, /cli:groupSettings/);
assert.match(cliSettings, /cliWorkflowTemplates/);
assert.match(cliSettings, /cliSessionPolicy/);
assert.match(cliSettings, /product:cliWorkflowTemplates/);
assert.match(cliSettings, /product:cliSessionPolicy/);
assert.match(cliSettings, /cli:groupSettings\.executionDetails/);
assert.doesNotMatch(cliSettings, /群规/);
assert.doesNotMatch(cliSettings, /Runtime/);
assert.doesNotMatch(cliSettings, /本机 CLI Runtime 状态/);
assert.doesNotMatch(cliSettings, /'开发群配置'/);
assert.doesNotMatch(cliSettings, /'协作方式'/);

const memberLibrary = await readFile(new URL('../pages/chat/components/AIMemberLibrary.tsx', import.meta.url), 'utf8');

assert.match(memberLibrary, /useTranslation/);
assert.match(memberLibrary, /library:title/);
assert.match(memberLibrary, /library:tabs/);
for (const oldCopy of ['AI 群员管理库', 'AI 群员库', 'LLM 角色', 'Agent 协作', 'CLI Agent', '暂无群员']) {
  assert.doesNotMatch(memberLibrary, new RegExp(oldCopy));
}

const memberEditor = await readFile(new URL('../pages/chat/components/AIMemberEditor.tsx', import.meta.url), 'utf8');

assert.match(memberEditor, /useTranslation/);
assert.match(memberEditor, /member\.titleEdit/);
assert.match(memberEditor, /member\.fields\./);
for (const oldCopy of ['编辑群员', '新建群员', '群员类型', '群员名称', 'LLM 角色', '>Agent<', 'CLI Agent']) {
  assert.doesNotMatch(memberEditor, new RegExp(oldCopy));
}

const memberPicker = await readFile(new URL('../pages/chat/components/MemberPicker.tsx', import.meta.url), 'utf8');

assert.match(memberPicker, /useTranslation/);
assert.match(memberPicker, /chat:memberPicker/);
assert.doesNotMatch(memberPicker, /CLI Agent/);
assert.doesNotMatch(memberPicker, /选择群员/);

const sidebar = await readFile(new URL('../pages/chat/components/Sidebar.tsx', import.meta.url), 'utf8');

assert.match(sidebar, /useTranslation/);
assert.match(sidebar, /getTranslatedGroupTypeShortLabel/);
assert.match(sidebar, /sidebar:section\.workspace/);
for (const oldCopy of ['工作空间', 'AI 群员库', '>AI<', '>CLI<', '>Agent<']) {
  assert.doesNotMatch(sidebar, new RegExp(oldCopy));
}

const chatUI = await readFile(new URL('../pages/chat/components/ChatUI.tsx', import.meta.url), 'utf8');

assert.match(chatUI, /useTranslation/);
assert.match(chatUI, /chat:messages\.noEnabledCliMembers/);
assert.match(chatUI, /chat:placeholders\.cliInput/);
assert.match(chatUI, /chat:messages\.readOnlyDiscussionHint/);
assert.match(chatUI, /AIMemberLibrary/);
assert.doesNotMatch(chatUI, /当前群规是/);
assert.doesNotMatch(chatUI, /CLI Agent 将在 workspace 中执行/);
assert.doesNotMatch(chatUI, /AI 群员库（/);

const agentChatUI = await readFile(new URL('../pages/chat/components/AgentChatUI.tsx', import.meta.url), 'utf8');

assert.match(agentChatUI, /useTranslation/);
assert.match(agentChatUI, /chat:agentChat/);
assert.match(agentChatUI, /settings:strategies/);
assert.match(agentChatUI, /AIMemberLibrary/);
for (const oldCopy of ['Agent 协作群', 'AI 群员库', '专家群友将按群规协作回复', '正在加载资源库']) {
  assert.doesNotMatch(agentChatUI, new RegExp(oldCopy));
}

const readme = await readFile(new URL('../../README.md', import.meta.url), 'utf8');

for (const copy of ['角色群', '专家群', '开发群', '资源库']) {
  assert.match(readme, new RegExp(copy));
}
assert.doesNotMatch(readme, /AI 群聊/);
