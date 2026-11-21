import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function importTsModule(url) {
  const source = await readFile(url, 'utf8');
  const compiled = ts.transpileModule(`${source}\n// cache-bust:${Date.now()}:${Math.random()}`, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`;
  return import(moduleUrl);
}

const {
  getPickableMembers,
  getVisibleMembers,
  resolveEffectiveMember,
  resolveEffectiveMembers,
} = await importTsModule(new URL('./aiMemberDisplay.ts', import.meta.url));

const members = {
  'cli-cursor': {
    id: 'cli-cursor',
    kind: 'cli',
    name: 'Cursor',
    source: 'builtin',
    enabled: true,
  },
  'cli-cursor-copy-1': {
    id: 'cli-cursor-copy-1',
    kind: 'cli',
    name: '我的 Cursor',
    source: 'user',
    forkedFrom: 'cli-cursor',
    enabled: true,
  },
  'cli-custom': {
    id: 'cli-custom',
    kind: 'cli',
    name: '自定义',
    source: 'user',
    enabled: true,
  },
};

assert.equal(resolveEffectiveMember(members, 'cli-cursor')?.name, '我的 Cursor');
assert.equal(resolveEffectiveMember(members, 'cli-cursor-copy-1')?.name, '我的 Cursor');
assert.equal(resolveEffectiveMember(members, 'cli-custom')?.name, '自定义');
assert.equal(resolveEffectiveMembers(members, ['cli-cursor', 'cli-custom']).length, 2);

const visible = getVisibleMembers(members, 'cli');
assert.equal(visible.some((m) => m.id === 'cli-cursor'), false);
assert.equal(visible.some((m) => m.id === 'cli-cursor-copy-1'), true);

console.log('aiMemberDisplay.test.mjs: ok');

{
  const members = {
    'kid-story-fairy': { id: 'kid-story-fairy', kind: 'llm', name: '故事精灵', source: 'builtin', enabled: true },
    'kid-math-bear': { id: 'kid-math-bear', kind: 'llm', name: '数学小熊', source: 'builtin', enabled: true },
    'fork-bear': { id: 'fork-bear', kind: 'llm', name: '我的小熊', source: 'user', forkedFrom: 'kid-math-bear', enabled: true, updatedAt: 2 },
    disabled: { id: 'disabled', kind: 'llm', name: '停用', source: 'user', enabled: false },
  };
  assert.deepEqual(
    getPickableMembers(members, 'llm').map((m) => m.id).sort(),
    ['fork-bear', 'kid-story-fairy'],
    'builtin companions are pickable, forked builtins are replaced by the copy, disabled members are hidden',
  );
}
