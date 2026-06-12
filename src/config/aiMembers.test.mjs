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

const { builtinAIMembers } = await importTsModule(new URL('./aiMembers.ts', import.meta.url));

const qoder = builtinAIMembers.find((member) => member.id === 'cli-qodercli');
const antigravity = builtinAIMembers.find((member) => member.id === 'cli-antigravity');

assert.equal(qoder?.kind, 'cli');
assert.equal(qoder?.name, 'Qoder CLI');
assert.equal(qoder?.avatar, 'lobehub:Qoder');
assert.equal(qoder?.source, 'builtin');
assert.equal(qoder?.enabled, true);
assert.equal(qoder?.cli?.adapter, 'qodercli');
assert.equal(qoder?.cli?.approvalMode, 'auto');
assert.equal(qoder?.cli?.showStderr, false);

assert.equal(antigravity?.kind, 'cli');
assert.equal(antigravity?.name, 'Antigravity');
assert.equal(antigravity?.source, 'builtin');
assert.equal(antigravity?.enabled, true);
assert.equal(antigravity?.cli?.adapter, 'antigravity');
assert.equal(antigravity?.cli?.approvalMode, 'auto');
assert.equal(antigravity?.cli?.showStderr, true);

console.log('aiMembers.test.mjs: ok');
