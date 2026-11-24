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

const { normalizeAvatarInput, cleanAvatarInput } = await importTsModule(
  new URL('./avatarInput.ts', import.meta.url),
);

const cases = [
  ['', 'empty', ''],
  ['lobehub:DeepSeek', 'lobehub', 'lobehub:DeepSeek'],
  ['https://x.test/a.png?x=1', 'url', 'https://x.test/a.png?x=1'],
  ['http://x.test/a.png', 'url', 'http://x.test/a.png'],
  ['/Users/me/a.png', 'file-path', '/Users/me/a.png'],
  ['~/Pictures/a.png', 'file-path', '~/Pictures/a.png'],
  ['file:///Users/me/a.png', 'file-path', '/Users/me/a.png'],
  ['file:///Users/me/a%20b.png', 'file-path', '/Users/me/a b.png'],
  ['file:///C:/a.png', 'file-path', 'C:/a.png'],
  ['C:\\Users\\me\\a.png', 'file-path', 'C:/Users/me/a.png'],
  ['asset://localhost/Users/me/a.png', 'file-path', '/Users/me/a.png'],
  ['http://asset.localhost/Users/me/a.png', 'file-path', '/Users/me/a.png'],
  ['data:image/png;base64,AAAA', 'data', 'data:image/png;base64,AAAA'],
  ['blob:http://x/1', 'invalid', 'blob:http://x/1'],
  ['not a link', 'invalid', 'not a link'],
  ['"https://x.test/a.png"', 'url', 'https://x.test/a.png'],
  ['<https://x.test/a.png>', 'url', 'https://x.test/a.png'],
];

for (const [input, kind, value] of cases) {
  const out = normalizeAvatarInput(input);
  assert.equal(out.kind, kind, `kind for ${JSON.stringify(input)}`);
  assert.equal(out.value, value, `value for ${JSON.stringify(input)}`);
}

assert.equal(cleanAvatarInput('  “https://x.test/a.png”  '), 'https://x.test/a.png');

console.log('avatarInput.test.mjs: ok');
