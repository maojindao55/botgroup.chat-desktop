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
  builtinAIMembers,
  isSupportedMemberKind,
  REMOVED_MEMBER_KINDS,
  KID_COMPANION_IDS,
  getCompanionMeta,
  isKidCompanionId,
} = await importTsModule(new URL('./aiMembers.ts', import.meta.url));

assert.deepEqual(
  builtinAIMembers.map((member) => member.name),
  ['好奇博士', '故事精灵', '数学小熊', '画画兔'],
);
assert.deepEqual(builtinAIMembers.map((member) => member.id), [...KID_COMPANION_IDS]);
for (const member of builtinAIMembers) {
  assert.equal(member.source, 'builtin');
  assert.equal(member.enabled, true);
  assert.match(member.avatar, /^\/img\/kids\/[a-z-]+\.svg$/, `${member.name} has a bundled avatar`);
  assert.ok(member.tags.length >= 5, `${member.name} has scheduler keywords`);
  assert.match(member.customPrompt, /口头禅/, `${member.name} has a catchphrase in the persona`);
  assert.equal(member.providerId, '', 'builtin companions use the parent-selected model');
  assert.equal(member.model, '');
  const meta = getCompanionMeta(member.id);
  assert.ok(meta?.greeting && meta.catchphrase && meta.color && meta.emoji, `${member.name} has kid UI meta`);
  assert.ok(member.customPrompt.includes(meta.catchphrase), 'catchphrase matches the persona');
}
assert.equal(isKidCompanionId('kid-math-bear'), true);
assert.equal(isKidCompanionId('llm-custom'), false);
assert.equal(getCompanionMeta('llm-custom'), undefined);

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
