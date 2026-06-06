import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const agentChat = await readFile(new URL('../pages/chat/components/AgentChatUI.tsx', import.meta.url), 'utf8');
const chat = await readFile(new URL('../pages/chat/components/ChatUI.tsx', import.meta.url), 'utf8');
const cliTask = await readFile(new URL('../pages/chat/components/CLITaskUI.tsx', import.meta.url), 'utf8');

assert.match(
  agentChat,
  /<ChatMarkdown\s+content=\{message\.content\}\s+isUser=\{isUser\}\s+basePath=\{group\.workspacePath\}/,
  'AgentChatUI should pass group workspacePath as markdown image basePath',
);
assert.match(
  chat,
  /<ChatMarkdown[\s\S]*?content=\{message\.content\}[\s\S]*?basePath=\{message\.cliCwd \|\| workspacePath\}/,
  'ChatUI should pass message cliCwd/workspacePath as markdown image basePath',
);
assert.match(
  cliTask,
  /<ChatMarkdown\s+content=\{message\.content\}\s+isUser=\{isUser\}\s+basePath=\{message\.cliCwd \|\| workspacePath\}/,
  'CLITaskUI should pass message cliCwd/workspacePath as markdown image basePath',
);

console.log('Markdown.callers.test.mjs: ok');
