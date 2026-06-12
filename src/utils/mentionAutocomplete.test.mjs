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

const mod = await importTsModule(new URL('./mentionAutocomplete.ts', import.meta.url));

const candidates = [
  { id: 'cli-codex', name: 'Codex' },
  { id: 'cli-qwen', name: '通义灵码' },
  { id: 'llm-reviewer', name: 'Reviewer' },
];

{
  const active = mod.getActiveMention('hello @co', 'hello @co'.length);
  assert.deepEqual(active, { start: 6, end: 9, query: 'co' });
}

{
  assert.equal(mod.getActiveMention('hello @co world', 'hello @co world'.length), null);
  assert.equal(mod.getActiveMention('email a@b.com', 'email a@b.com'.length), null);
}

{
  const active = mod.getActiveMention('请 @通', '请 @通'.length);
  assert.deepEqual(active, { start: 2, end: 4, query: '通' });
}

{
  assert.deepEqual(
    mod.filterMentionCandidates(candidates, 'co').map(candidate => candidate.id),
    ['cli-codex'],
  );
  assert.deepEqual(
    mod.filterMentionCandidates(candidates, 'cli').map(candidate => candidate.id),
    ['cli-codex', 'cli-qwen'],
  );
  assert.deepEqual(
    mod.filterMentionCandidates(candidates, '通').map(candidate => candidate.id),
    ['cli-qwen'],
  );
}

{
  const active = mod.getActiveMention('fix @co please', 'fix @co'.length);
  const result = mod.applyMention('fix @co please', active, candidates[0]);
  assert.deepEqual(result, {
    value: 'fix @Codex please',
    caret: 'fix @Codex '.length,
  });
}

{
  const active = mod.getActiveMention('@通', '@通'.length);
  const result = mod.applyMention('@通', active, candidates[1]);
  assert.deepEqual(result, {
    value: '@通义灵码 ',
    caret: '@通义灵码 '.length,
  });
}

{
  assert.deepEqual(
    mod.extractMentionedCandidateIds('fix @Codex and ask @Reviewer', candidates),
    ['cli-codex', 'llm-reviewer'],
  );
  assert.deepEqual(
    mod.extractMentionedCandidateIds('请 @通义灵码 看下', candidates),
    ['cli-qwen'],
  );
}

{
  assert.equal(mod.shouldBlockMentionAutocompleteSend(true), true);
  assert.equal(mod.shouldBlockMentionAutocompleteSend(false), false);
}

console.log('mentionAutocomplete.test.mjs: ok');
