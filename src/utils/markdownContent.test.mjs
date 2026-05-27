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

console.log('markdownContent.test.mjs: ok');
