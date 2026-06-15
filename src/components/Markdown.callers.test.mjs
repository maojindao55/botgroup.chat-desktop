import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const agentChat = await readFile(new URL('../pages/chat/components/AgentChatUI.tsx', import.meta.url), 'utf8');
const chat = await readFile(new URL('../pages/chat/components/ChatUI.tsx', import.meta.url), 'utf8');
const cliTask = await readFile(new URL('../pages/chat/components/CLITaskUI.tsx', import.meta.url), 'utf8');

assert.match(
  agentChat,
  /<ChatMarkdown[\s\S]*?basePath=\{basePath\}[\s\S]*?hideDetails=\{!isUser && hideMessageDetails\}/,
  'AgentChatUI should pass markdown basePath and debug detail visibility',
);
assert.match(
  chat,
  /<ChatMarkdown[\s\S]*?content=\{message\.content\}[\s\S]*?basePath=\{message\.cliCwd \|\| workspacePath\}[\s\S]*?hideDetails=\{!isUser && isCLIGroup && \(group as CLIGroup\)\.debugMode !== true\}/,
  'ChatUI should pass message cliCwd/workspacePath and debug detail visibility',
);
assert.match(
  cliTask,
  /<ChatMarkdown[\s\S]*?content=\{message\.content\}[\s\S]*?basePath=\{message\.cliCwd \|\| workspacePath\}[\s\S]*?hideDetails=\{!isUser && selectedTask\?\.templateSnapshot\.debugMode !== true\}/,
  'CLITaskUI should pass message cliCwd/workspacePath and snapshot debug detail visibility',
);

console.log('Markdown.callers.test.mjs: ok');
