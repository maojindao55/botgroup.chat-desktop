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

const { cleanCliOutputLine, shouldSuppressCliOutputLine } = await importTsModule(new URL('./cliOutput.ts', import.meta.url));

assert.equal(cleanCliOutputLine('\u001b[0m'), '');
assert.equal(cleanCliOutputLine('[0m'), '');
assert.equal(cleanCliOutputLine('\u001b[91m\u001b[1mError: \u001b[0m身份验证失败。'), 'Error: 身份验证失败。');
assert.equal(cleanCliOutputLine('[91m[1mError: [0m身份验证失败。'), 'Error: 身份验证失败。');
assert.equal(cleanCliOutputLine('[0m→ [0mRead bubble-sort.htm'), '→ Read bubble-sort.htm');

assert.equal(shouldSuppressCliOutputLine('✗ Skill "brainstorming" failed'), true);
assert.equal(shouldSuppressCliOutputLine('Error: Skill or command "brainstorming" not found. Available: playwright'), true);
assert.equal(shouldSuppressCliOutputLine('> Sisyphus - Ultraworker · deepseek-v4-flash-free'), true);
assert.equal(shouldSuppressCliOutputLine('2026-06-05T06:14:37.109399Z ERROR codex_models_manager::manager: failed to refresh available models: timeout waiting for child process to exit'), true);
assert.equal(shouldSuppressCliOutputLine('I detect exploratory intent'), false);

console.log('cliOutput.test.mjs: ok');
