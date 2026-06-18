import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function importTsModule(url) {
  const source = await readFile(url, 'utf8');
  const compiled = ts.transpileModule(`${source}\n// cache-bust:${Date.now()}`, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  });
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`;
  return import(moduleUrl);
}

const { resolveAgentSelection } = await importTsModule(
  new URL('./agentWorkflowSelection.ts', import.meta.url),
);

function m(id, role) {
  return { id, name: id.toUpperCase(), kind: 'agent', role };
}
const members = [m('a', 'implementer'), m('b', 'reviewer'), m('c', '后端工程师'), m('d', 'summarizer')];

// first
assert.deepEqual(resolveAgentSelection({ kind: 'first' }, members, { maxParallel: 3 }), ['a']);

// count capped by maxParallel
assert.deepEqual(resolveAgentSelection({ kind: 'count', n: 5 }, members, { maxParallel: 2 }), ['a', 'b']);

// count smaller than maxParallel
assert.deepEqual(resolveAgentSelection({ kind: 'count', n: 2 }, members, { maxParallel: 3 }), ['a', 'b']);

// all capped
assert.deepEqual(resolveAgentSelection({ kind: 'all' }, members, { maxParallel: 2 }), ['a', 'b']);

// byRole: reviewer (en)
assert.deepEqual(resolveAgentSelection({ kind: 'byRole', role: 'reviewer' }, members, { maxParallel: 3 }), ['b']);

// byRole: implementer matches zh role '后端工程师' (contains '工程')
assert.deepEqual(resolveAgentSelection({ kind: 'byRole', role: 'implementer' }, [m('c', '后端工程师'), m('b', 'reviewer')], { maxParallel: 3 }), ['c']);

// byRole: no match -> fallback first
assert.deepEqual(resolveAgentSelection({ kind: 'byRole', role: 'summarizer' }, [m('a', 'implementer'), m('b', 'reviewer')], { maxParallel: 3 }), ['a']);

// exclude removes ids then first
assert.deepEqual(resolveAgentSelection({ kind: 'first' }, members, { maxParallel: 3, exclude: ['a'] }), ['b']);

// byRole with exclude -> b excluded, no other reviewer, fallback first among non-excluded = a
assert.deepEqual(resolveAgentSelection({ kind: 'byRole', role: 'reviewer' }, members, { maxParallel: 3, exclude: ['b'] }), ['a']);

// empty pool -> []
assert.deepEqual(resolveAgentSelection({ kind: 'first' }, members, { maxParallel: 3, exclude: ['a', 'b', 'c', 'd'] }), []);

console.log('agentWorkflowSelection.test.mjs: ok');
