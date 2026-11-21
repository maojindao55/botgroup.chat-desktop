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
  ['角色群'],
);

assert.deepEqual(
  mod.aiSpeechModes.map((item) => item.label),
  ['智能点名', '轮流发言', '全员圆桌'],
);

for (const removed of [
  'agentWorkflowEfforts',
  'workflowIntentPresets',
  'agentWorkflowTemplates',
  'cliWorkflowTemplates',
  'cliWorkflowTemplateGroups',
  'getCLIWorkflowLabel',
]) {
  assert.ok(!(removed in mod), `${removed} must be removed`);
}

assert.equal(mod.applyAISpeechMode('smart').schedulerStrategy, 'tag');
assert.equal(mod.applyAISpeechMode('smart').isGroupDiscussionMode, false);
assert.equal(mod.applyAISpeechMode('all').schedulerStrategy, 'all');
assert.equal(mod.applyAISpeechMode('all').isGroupDiscussionMode, true);

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
assert.equal(mod.getProductGroupType('ai').label, '角色群');

const componentsDir = new URL('../pages/chat/components/', import.meta.url);
const readComponent = (name) => readFile(new URL(name, componentsDir), 'utf8');

const wizard = await readComponent('CreateGroupWizard.tsx');
for (const symbol of ['aiSpeechModes', 'applyAISpeechMode']) {
  assert.match(wizard, new RegExp(symbol));
}
for (const removed of [/cliWorkflowTemplates/, /agentWorkflowEfforts/, /type === 'cli'/, /type === 'agent'/]) {
  assert.doesNotMatch(wizard, removed);
}

const aiSettings = await readComponent('AIGroupSettings.tsx');
assert.match(aiSettings, /useTranslation/);
assert.match(aiSettings, /settings:aiGroup/);
for (const symbol of ['aiSpeechModes', 'applyAISpeechMode', 'resolveAISpeechMode']) {
  assert.match(aiSettings, new RegExp(symbol));
}

const resourceLibrary = await readComponent('ResourceLibraryContent.tsx');
assert.match(resourceLibrary, /library:create/);
assert.doesNotMatch(resourceLibrary, /CLIExecutorLibrary|library:cliTabs/);

const appSettingsModal = await readComponent('AppSettingsModal.tsx');
assert.match(appSettingsModal, /APP_SETTINGS_SECTIONS/);
assert.match(appSettingsModal, /ResourceLibraryContent/);

const memberEditor = await readComponent('AIMemberEditor.tsx');
assert.match(memberEditor, /member\.titleEdit/);
assert.doesNotMatch(memberEditor, /kind === 'cli'|kind === 'agent'|useCLIExecutorStore/);

const sidebar = await readComponent('Sidebar.tsx');
assert.match(sidebar, /getTranslatedGroupTypeShortLabel/);
assert.doesNotMatch(sidebar, /onNavigateCLI|devTasks/);

const chatUI = await readComponent('ChatUI.tsx');
assert.match(chatUI, /AppSettingsModal/);
for (const removed of [/isCLIGroup/, /CLITaskUI/, /AgentChatUI/, /\/api\/cli\//, /AdSection/, /\/api\/scheduler/]) {
  assert.doesNotMatch(chatUI, removed);
}
for (const symbol of [/pickCompanions\(/, /capResponders\(/, /rememberFromMessage\(/]) {
  assert.match(chatUI, symbol, 'role group chat uses the kid scheduler, age caps and local memory');
}

const requestSource = await readFile(new URL('../utils/request.ts', import.meta.url), 'utf8');
assert.match(requestSource, /buildCompanionSystemPrompt\(/, '/api/chat always prepends the child rules');
assert.doesNotMatch(requestSource, /custom_prompt\}\\n 注意重要/, 'the old adult group-chat system prompt is gone');

for (const removedFile of ['AgentChatUI.tsx', 'CLITaskUI.tsx', 'CLIGroupSettings.tsx', 'AgentGroupSettings.tsx']) {
  await assert.rejects(readComponent(removedFile), { code: 'ENOENT' }, `${removedFile} must be deleted`);
}

const readme = await readFile(new URL('../../README.md', import.meta.url), 'utf8');
assert.match(readme, /角色群/);
for (const removed of [/专家群/, /开发群/, /AI 群聊/]) {
  assert.doesNotMatch(readme, removed);
}

console.log('groupProduct.test.mjs: ok');
