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

const { builtinAIMembers, isSupportedMemberKind, REMOVED_MEMBER_KINDS } = await importTsModule(
  new URL('./aiMembers.ts', import.meta.url),
);

assert.ok(
  builtinAIMembers.every((member) => member.kind === 'llm'),
  'builtin members must all be LLM characters',
);
assert.equal(
  builtinAIMembers.some((member) => member.id.startsWith('cli-') || member.id.startsWith('agent-')),
  false,
  'CLI / agent builtin members must be gone',
);

assert.equal(isSupportedMemberKind('llm'), true);
for (const kind of REMOVED_MEMBER_KINDS) {
  assert.equal(isSupportedMemberKind(kind), false, `${kind} members must be filtered out`);
}
assert.equal(isSupportedMemberKind(undefined), false);

console.log('aiMembers.test.mjs: ok');
