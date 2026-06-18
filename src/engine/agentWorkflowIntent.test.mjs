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

const { classifyIntent, degradeIntent } = await importTsModule(
  new URL('./agentWorkflowIntent.ts', import.meta.url),
);

// 中文关键词
assert.equal(classifyIntent('帮我修复这个 bug'), 'implement');
assert.equal(classifyIntent('大家讨论一下这个方案'), 'discuss');
assert.equal(classifyIntent('给几种方案对比一下'), 'multi_solution');
assert.equal(classifyIntent('帮我排查这个报错'), 'audit');
assert.equal(classifyIntent('实现完帮我复审一下'), 'review');
assert.equal(classifyIntent('你好'), 'quick');

// 英文关键词
assert.equal(classifyIntent('please implement a login page'), 'implement');
assert.equal(classifyIntent("let's discuss the architecture"), 'discuss');
assert.equal(classifyIntent('give me a few alternatives'), 'multi_solution');
assert.equal(classifyIntent('investigate the crash'), 'audit');
assert.equal(classifyIntent('fix it then review'), 'review');

// 优先级：分析并修复 -> implement（implement 压 discuss）
assert.equal(classifyIntent('分析一下并修复这个问题'), 'implement');
// 优先级：实现并复审 -> review（review 压 implement）
assert.equal(classifyIntent('实现这个功能然后复审'), 'review');

// 兜底
assert.equal(classifyIntent(''), 'quick');
assert.equal(classifyIntent('   '), 'quick');

// degrade
const ws = { memberCount: 3, workspaceReady: true };
assert.equal(degradeIntent('discuss', { ...ws, memberCount: 1 }).intent, 'quick');
assert.equal(degradeIntent('multi_solution', { ...ws, memberCount: 1 }).intent, 'quick');
assert.equal(degradeIntent('audit', { ...ws, memberCount: 1 }).intent, 'quick');
assert.equal(degradeIntent('implement', { workspaceReady: false, memberCount: 2 }).intent, 'quick');
assert.equal(degradeIntent('review', { workspaceReady: false, memberCount: 2 }).intent, 'audit');
assert.equal(degradeIntent('review', { workspaceReady: true, memberCount: 1 }).intent, 'implement');
assert.equal(degradeIntent('discuss', ws).intent, 'discuss');
assert.equal(degradeIntent('discuss', ws).reason, undefined);

console.log('agentWorkflowIntent.test.mjs: ok');
