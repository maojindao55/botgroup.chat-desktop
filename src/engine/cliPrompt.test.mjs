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

const { buildCliUserPrompt } = await importTsModule(new URL('./cliPrompt.ts', import.meta.url));

{
  const prompt = buildCliUserPrompt(
    ' 帮我写一个冒泡排序文件 ',
    '/Users/hongbin9/www/sciter-js-sdk/samples.sciter/editor-plaintext',
  );

  assert.match(prompt, /^工作目录：\/Users\/hongbin9\/www\/sciter-js-sdk\/samples\.sciter\/editor-plaintext/);
  assert.match(prompt, /用户需求：帮我写一个冒泡排序文件/);
  assert.doesNotMatch(prompt, /botgroup\.chat-desktop/);
  assert.doesNotMatch(prompt, /Codex：|OpenCode：|user：/);
}

{
  assert.equal(buildCliUserPrompt(' 你好 ', ''), '你好');
}

console.log('CLI prompt tests passed');
