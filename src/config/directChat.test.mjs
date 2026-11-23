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

const mod = await importTsModule(new URL('./directChat.ts', import.meta.url));

assert.equal(mod.directChatGroupId('llm-1'), 'dm:llm-1');
assert.equal(mod.DIRECT_CHAT_GROUP_PREFIX, 'dm:');

const group = mod.createDirectChatGroup({ id: 'llm-1', name: '小明' });
assert.equal(group.id, 'dm:llm-1');
assert.equal(group.type, 'ai');
assert.equal(group.name, '小明');
assert.equal(group.description, '');
assert.deepEqual(group.memberIds, ['llm-1']);
assert.equal(group.directChat, true);
assert.equal(group.schedulerStrategy, 'all');
assert.equal(group.isGroupDiscussionMode, false);
assert.equal(mod.isDirectChatGroup(group), true);

// 旧数据兜底：没有 directChat 标记，但 id 前缀 + 单成员
assert.equal(
  mod.isDirectChatGroup({ id: 'dm:llm-2', type: 'ai', memberIds: ['llm-2'] }),
  true,
);
// 多成员不算单聊
assert.equal(
  mod.isDirectChatGroup({ id: 'dm:llm-2', type: 'ai', memberIds: ['llm-2', 'llm-3'] }),
  false,
);
// 普通群
assert.equal(
  mod.isDirectChatGroup({ id: 'group-1', type: 'ai', memberIds: ['llm-1'] }),
  false,
);
assert.equal(mod.isDirectChatGroup(null), false);

console.log('directChat.test.mjs: ok');
