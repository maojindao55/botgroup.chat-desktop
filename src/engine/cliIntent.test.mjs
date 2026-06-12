import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function importTsModule(url) {
  const source = await readFile(url, 'utf8');
  const compiled = ts.transpileModule(`${source}\n// cache-bust:${Date.now()}`, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`;
  return import(moduleUrl);
}

const { isCodeChangeIntent } = await importTsModule(new URL('./cliIntent.ts', import.meta.url));

assert.equal(isCodeChangeIntent('帮我写一个冒泡排序文件'), true);
assert.equal(isCodeChangeIntent('创建一个 bubble sort.js 并实现排序'), true);
assert.equal(isCodeChangeIntent('please fix this failing test'), true);
assert.equal(isCodeChangeIntent('讨论一下这个模块的风险'), false);
assert.equal(isCodeChangeIntent('分析一下应该怎么做，不要修改文件'), false);
