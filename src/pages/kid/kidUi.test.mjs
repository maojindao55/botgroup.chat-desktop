import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

async function listSources(dirUrl) {
  const out = [];
  for (const entry of await readdir(dirUrl, { withFileTypes: true })) {
    const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dirUrl);
    if (entry.isDirectory()) out.push(...(await listSources(url)));
    else if (/\.tsx?$/.test(entry.name)) out.push(url);
  }
  return out;
}

// 儿童端是默认首页，成人界面挪到 /parent 并且需要先通过家长验证
const routes = await read('../../routes.tsx');
assert.match(routes, /path: '\/',\s*element: <KidLayout \/>/);
assert.match(routes, /index: true, element: <KidHome \/>/);
assert.match(routes, /path: '\/parent'/);
assert.match(routes, /<ParentArea \/>/);
assert.doesNotMatch(routes, /path: '',\s*element: <Chat \/>/, 'adult chat is no longer the default page');

const parent = await read('../parent/index.tsx');
assert.match(parent, /isParentAreaUnlocked\(\)/);
assert.match(parent, /<Navigate to="\/" replace \/>/);

const gate = await read('./components/ParentGate.tsx');
assert.match(gate, /LONG_PRESS_MS = 1500/);
assert.match(gate, /checkChallengeAnswer/);
assert.match(gate, /unlockParentArea\(\)/);

// 儿童端不用 antd 的后台组件，只用 Tailwind
const kidFiles = await listSources(new URL('./', import.meta.url));
assert.ok(kidFiles.length >= 8);
for (const url of kidFiles) {
  const source = await readFile(url, 'utf8');
  assert.doesNotMatch(source, /from 'antd'|from '@lobehub\/ui'/, `${url.pathname} should not import admin UI kits`);
}

// 触控区域：交互按钮至少 h-12（48px）
for (const url of kidFiles) {
  const source = await readFile(url, 'utf8');
  for (const match of source.matchAll(/<button\b[^<]*?className=[{]?[`"]([^`"]*)[`"]/g)) {
    const cls = match[1];
    if (/\b(?:h|min-h)-(?:1[2-9]|[2-9]\d)\b/.test(cls) || /relative flex h-14/.test(cls)) continue;
    assert.fail(`${url.pathname}: button without a 48px touch target: ${cls}`);
  }
}

// 聊天走共享的伙伴调度和守则
const chat = await read('./KidChat.tsx');
assert.match(chat, /pickCompanions\(/);
assert.match(chat, /capResponders\(/);
assert.match(chat, /rememberFromMessage\(text\)/);
const companionChat = await read('../../lib/companionChat.ts');
assert.match(companionChat, /request\('\/api\/chat'/);
assert.match(companionChat, /gamePrompt/);

// 游戏判定在本地，伙伴只负责陪玩
const play = await read('./KidGamePlay.tsx');
for (const fn of ['submitGuess', 'submitChainWord', 'acceptCompanionWord', 'submitStoryLine', 'recordGame']) {
  assert.match(play, new RegExp(`${fn}\\(`), `game page uses ${fn}`);
}

// 麦克风只在支持语音识别时出现
const input = await read('./components/KidInputBar.tsx');
assert.match(input, /recognizer\.supported &&/);
assert.match(input, /voice\.inputMode === 'voice' && recognizer\.supported/);

console.log('kidUi.test.mjs: ok');
