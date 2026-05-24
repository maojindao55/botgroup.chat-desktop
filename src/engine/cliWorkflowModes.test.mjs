import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const settings = await readFile(new URL('../pages/chat/components/CLIGroupSettings.tsx', import.meta.url), 'utf8');
const wizard = await readFile(new URL('../pages/chat/components/CreateGroupWizard.tsx', import.meta.url), 'utf8');
const engine = await readFile(new URL('./cliEngine.ts', import.meta.url), 'utf8');
const chatUI = await readFile(new URL('../pages/chat/components/ChatUI.tsx', import.meta.url), 'utf8');

const settingsStrategyBlock = settings.slice(
  settings.indexOf('{/* strategy */}'),
  settings.indexOf('{/* Advanced Execution Plan Config'),
);
const wizardCliConfigBlock = wizard.slice(
  wizard.indexOf('const renderCLIConfigStep'),
  wizard.indexOf('const renderAgentConfigStep'),
);
const cliSendBlock = chatUI.slice(
  chatUI.indexOf('const handleSendCLIMessage'),
  chatUI.indexOf('const handleSend = async'),
);

assert.match(settingsStrategyBlock, /cliWorkflowTemplates/);
assert.match(wizardCliConfigBlock, /cliWorkflowTemplates/);

for (const oldLabel of ['快速处理', '模型对比', '接力开发', '开发评审', '多模型对比', '规划实现评审']) {
  assert.doesNotMatch(settingsStrategyBlock, new RegExp(oldLabel));
  assert.doesNotMatch(wizardCliConfigBlock, new RegExp(oldLabel));
}

for (const hiddenStrategy of ['discussion', 'debate', 'mapreduce']) {
  assert.doesNotMatch(settingsStrategyBlock, new RegExp(`value: '${hiddenStrategy}' as const, label:`));
  assert.doesNotMatch(wizardCliConfigBlock, new RegExp(`value: '${hiddenStrategy}' as const, label:`));
}

assert.match(engine, /REVIEW_STAGE_LABELS = \['规划', '实现', '评审'\]/);
assert.match(engine, /REVIEW_TWO_AGENT_STAGE_LABELS = \['规划', '实现\+自检'\]/);
assert.match(engine, /REVIEW_ONE_AGENT_STAGE_LABELS = \['规划实现自评'\]/);
assert.match(engine, /你负责规划阶段/);
assert.match(engine, /你负责实现阶段/);
assert.match(engine, /你负责评审阶段/);
assert.match(engine, /你负责完整的规划、实现和自评闭环/);
assert.match(settings, /建议至少选择 3 个开发群友/);
assert.match(chatUI, /buildCliUserPrompt/);
assert.match(cliSendBlock, /const taskPrompt = buildCliUserPrompt\(promptText, workspacePath\)/);
assert.doesNotMatch(cliSendBlock, /const cleanHistory = messageHistory\.slice\(-6\)/);
assert.doesNotMatch(cliSendBlock, /const finalPrompt = cleanHistory/);
assert.match(cliSendBlock, /executeCLIStrategy\(\s*customGroup,\s*activeAgents,\s*taskPrompt,\s*workspacePath,/);
