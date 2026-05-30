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

const { defaultGroups } = await importTsModule(new URL('./groups.ts', import.meta.url));

const codingGroup = defaultGroups.find((group) => group.id === 'group-coding');

assert.equal(codingGroup?.type, 'cli');
assert.equal(codingGroup?.memberIds.includes('cli-qodercli'), true);

console.log('groups.defaultMembers.test.mjs: ok');
