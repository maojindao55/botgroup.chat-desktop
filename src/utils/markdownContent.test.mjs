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

const { toKidFriendlyMarkdown } = await importTsModule(new URL('./markdownContent.ts', import.meta.url));

assert.equal(toKidFriendlyMarkdown(''), '');
assert.equal(toKidFriendlyMarkdown('你好呀 🐰 **真棒**'), '你好呀 🐰 **真棒**', 'plain text, emoji and bold stay');
assert.equal(toKidFriendlyMarkdown('- 苹果\n- 香蕉'), '- 苹果\n- 香蕉', 'lists stay');

assert.equal(
  toKidFriendlyMarkdown('看这里：\n```js\nconsole.log(1)\n```\n好了'),
  '看这里：\nconsole.log(1)\n好了',
  'fenced code becomes plain text',
);
assert.equal(toKidFriendlyMarkdown('用 `print` 打印'), '用 print 打印', 'inline code loses backticks');
assert.equal(
  toKidFriendlyMarkdown('图：\n```mermaid\ngraph TD; A-->B\n```\n完'),
  '图：\n\n完',
  'mermaid diagrams are dropped',
);
assert.equal(toKidFriendlyMarkdown('三加二 $3+2=5$ 对吧'), '三加二 3+2=5 对吧', 'inline math becomes text');
assert.equal(toKidFriendlyMarkdown('$$\\frac{1}{2}$$'), '\\frac{1}{2}', 'block math delimiters removed');
assert.equal(toKidFriendlyMarkdown('<b>hi</b><script>x</script>'), 'hix', 'html tags are stripped');
assert.equal(toKidFriendlyMarkdown('去 [这里](https://example.com) 看看'), '去 这里 看看', 'links keep only text');
assert.equal(toKidFriendlyMarkdown('网址 https://example.com/a?b=1 再见'), '网址  再见', 'bare urls are removed');

assert.equal(
  toKidFriendlyMarkdown('小猫 ![猫](https://img.example.com/cat.png) 可爱'),
  '小猫 ![猫](https://img.example.com/cat.png) 可爱',
  'remote images stay',
);
assert.equal(
  toKidFriendlyMarkdown('![本地](/Users/kid/secret.png)'),
  '本地',
  'local file images are not rendered',
);
assert.doesNotMatch(
  toKidFriendlyMarkdown('![](javascript:alert(1))'),
  /javascript|!\[/,
  'non-http image urls are not rendered',
);
assert.equal(toKidFriendlyMarkdown('a\n\n\n\nb'), 'a\n\nb', 'extra blank lines collapse');

console.log('markdownContent.test.mjs: ok');
