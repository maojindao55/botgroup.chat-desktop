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
  encodeLobehubAvatar,
  isLobehubAvatar,
  parseLobehubAvatar,
} = await importTsModule(new URL('./lobehubAvatarCore.ts', import.meta.url));

assert.equal(encodeLobehubAvatar('DeepSeek'), 'lobehub:DeepSeek');
assert.equal(parseLobehubAvatar('lobehub:Cursor'), 'Cursor');
assert.equal(isLobehubAvatar('lobehub:Qwen'), true);
assert.equal(isLobehubAvatar('/img/qwen.jpg'), false);
assert.equal(parseLobehubAvatar('/img/qwen.jpg'), null);

console.log('lobehubAvatar.test.mjs: ok');
