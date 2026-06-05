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

const { normalizeChatMarkdownContent } = await importTsModule(new URL('./markdownContent.ts', import.meta.url));

{
  const content = [
    'before',
    '<details open data-cli-command-group="codex"><summary>⚙️ 执行命令</summary>',
    'command output',
    '</details>',
    'after',
  ].join('\n');

  const normalized = normalizeChatMarkdownContent(content);

  assert.match(normalized, /<details data-cli-command-group="codex">/);
  assert.doesNotMatch(normalized, /<details open data-cli-command-group="codex">/);
}

{
  const content = '<details open data-cli-command-group="codex"><summary>⚙️ 执行命令</summary>\ncommand output';

  assert.equal(normalizeChatMarkdownContent(content), content);
}

{
  const content = [
    '<details open data-cli-command-group="claude"><summary>⚙️ 执行命令</summary>',
    'command output',
    '</details>',
  ].join('\n');

  const normalized = normalizeChatMarkdownContent(content);

  assert.match(normalized, /<details data-cli-command-group="claude">/);
  assert.doesNotMatch(normalized, /<details open data-cli-command-group="claude">/);
}

{
  const content = [
    '<details open data-cli-command-group="opencode"><summary>⚙️ 执行命令</summary>',
    'command output',
    '</details>',
  ].join('\n');

  const normalized = normalizeChatMarkdownContent(content);

  assert.match(normalized, /<details data-cli-command-group="opencode">/);
  assert.doesNotMatch(normalized, /<details open data-cli-command-group="opencode">/);
}

{
  const content = [
    '<details open data-cli-command-group="cursor"><summary>⚙️ 执行命令</summary>',
    'command output',
    '</details>',
  ].join('\n');

  const normalized = normalizeChatMarkdownContent(content);

  assert.match(normalized, /<details data-cli-command-group="cursor">/);
  assert.doesNotMatch(normalized, /<details open data-cli-command-group="cursor">/);
}

{
  const content = [
    '<details open data-cli-command-group="custom-adapter"><summary>⚙️ 执行命令</summary>',
    'command output',
    '</details>',
  ].join('\n');

  const normalized = normalizeChatMarkdownContent(content);

  assert.match(normalized, /<details data-cli-command-group="custom-adapter">/);
  assert.doesNotMatch(normalized, /<details open data-cli-command-group="custom-adapter">/);
}

{
  const content = [
    '<details><summary>⚙️ 执行过程</summary>',
    '',
    '> 📝 _2026-06-05 ERROR codex_models_manager::manager: failed to refresh available models_',
    '',
    '我会先看 diff。',
    '',
    '<details open data-cli-command-group="codex"><summary>⚙️ 执行命令</summary>',
    'command output',
    '</details>',
    '',
    'REVIEW_DECISION: revise',
    '',
    '需要补齐配置兜底。',
    '</details>',
  ].join('\n');

  const normalized = normalizeChatMarkdownContent(content);

  assert.doesNotMatch(normalized, /<summary>⚙️ 执行过程<\/summary>/);
  assert.doesNotMatch(normalized, /codex_models_manager/);
  assert.match(normalized, /我会先看 diff。/);
  assert.match(normalized, /REVIEW_DECISION: revise/);
  assert.match(normalized, /<details data-cli-command-group="codex">/);
}

{
  const content = [
    '<details><summary>⚙️ 执行过程</summary>',
    '',
    '> 📝 _checking workspace_',
    '',
    '</details>',
    '',
    'final answer',
  ].join('\n');

  const normalized = normalizeChatMarkdownContent(content);

  assert.match(normalized, /<summary>⚙️ 执行过程<\/summary>/);
  assert.match(normalized, /final answer/);
}

console.log('markdownContent.test.mjs: ok');
