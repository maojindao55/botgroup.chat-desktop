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

const { normalizeChatMarkdownContent, transformLocalImagePaths } = await importTsModule(new URL('./markdownContent.ts', import.meta.url));

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

// transformLocalImagePaths
{
  const fakeResolver = (p) => `asset://localhost${p.startsWith('/') ? p : '/' + p}`;
  const cases = [
    { name: 'Unix absolute path inline', in: '图片已保存到 /Users/foo/output.png', expect: '图片已保存到 `/Users/foo/output.png`\n\n![](asset://localhost/Users/foo/output.png)' },
    { name: 'Single-quoted Unix absolute image path', in: "图片已保存到 '/Users/foo/output.png'", expect: "图片已保存到 '/Users/foo/output.png'\n\n![](asset://localhost/Users/foo/output.png)" },
    { name: 'Double-quoted Unix absolute image path', in: '图片已保存到 "/Users/foo/output.png"', expect: '图片已保存到 "/Users/foo/output.png"\n\n![](asset://localhost/Users/foo/output.png)' },
    { name: 'file:// URL', in: '已生成文件 file:///tmp/result.jpg', expect: '已生成文件 `file:///tmp/result.jpg`\n\n![](asset://localhost/tmp/result.jpg)' },
    { name: 'Windows path', in: 'C:\\Users\\test\\image.png 是 Windows 路径', expect: '`C:\\Users\\test\\image.png`\n\n![](asset://localhost/C:\\Users\\test\\image.png) 是 Windows 路径' },
    { name: 'Multiple paths', in: '看这里: /tmp/a.webp /tmp/b.gif', expect: '看这里: `/tmp/a.webp`\n\n![](asset://localhost/tmp/a.webp) `/tmp/b.gif`\n\n![](asset://localhost/tmp/b.gif)' },
    { name: 'Markdown image with alt', in: '![alt](/Users/foo/img.png) 已完成', expect: '![alt](asset://localhost/Users/foo/img.png) 已完成' },
    { name: 'Markdown image with single-quoted local src', in: "![tv-image]('/Users/foo/img.png') 已完成", expect: '![tv-image](asset://localhost/Users/foo/img.png) 已完成' },
    { name: 'Markdown image with double-quoted local src', in: '![tv-image]("/Users/foo/img.png") 已完成', expect: '![tv-image](asset://localhost/Users/foo/img.png) 已完成' },
    { name: 'Empty markdown image', in: '![](path/img.png) and ![](http://x.com/y.png)', expect: '![](asset://localhost/path/img.png) and ![](http://x.com/y.png)' },
    { name: 'http URL preserved', in: 'https://example.com/img.png 看看', expect: 'https://example.com/img.png 看看' },
    { name: 'Fenced code block skipped', in: '```\n/tmp/should-not-render.png\n```', expect: '```\n/tmp/should-not-render.png\n```' },
    { name: 'Pure inline-code image path rendered', in: '引用 `/Users/foo/x.png` 会渲染', expect: '引用 `/Users/foo/x.png`\n\n![](asset://localhost/Users/foo/x.png) 会渲染' },
    { name: 'Inline command with image path skipped', in: '命令 `open /Users/foo/x.png` 不渲染', expect: '命令 `open /Users/foo/x.png` 不渲染' },
    { name: 'Non-image extension preserved', in: '普通文本 /Users/not-image.txt 不处理', expect: '普通文本 /Users/not-image.txt 不处理' },
    { name: 'data URL preserved', in: 'data:image/png;base64,xxx', expect: 'data:image/png;base64,xxx' },
    { name: 'asset:// URL preserved (already converted)', in: '![alt](asset://localhost/Users/foo/img.png)', expect: '![alt](asset://localhost/Users/foo/img.png)' },
    { name: 'Mixed: inline + markdown + http', in: '看 /Users/a.png 和 ![](/Users/b.png) 以及 http://x.com/c.png', expect: '看 `/Users/a.png`\n\n![](asset://localhost/Users/a.png) 和 ![](asset://localhost/Users/b.png) 以及 http://x.com/c.png' },
    { name: 'CJK characters in path', in: '图片 /Users/foo/中文/image.png', expect: '图片 `/Users/foo/中文/image.png`\n\n![](asset://localhost/Users/foo/中文/image.png)' },
    { name: 'Path with query string', in: '看 /img.php?file=test.png', expect: '看 `/img.php?file=test.png`\n\n![](asset://localhost/img.php?file=test.png)' },
    { name: 'Empty content', in: '', expect: '' },
    { name: 'http image markdown preserved', in: '![remote](http://cdn.example.com/x.png)', expect: '![remote](http://cdn.example.com/x.png)' },
    { name: 'HTML img with local src', in: '<img src="/Users/foo/x.png" alt="hi" />', expect: '<img src="asset://localhost/Users/foo/x.png" alt="hi" />' },
    { name: 'HTML img with http src', in: "<img src='https://x.com/y.png' alt='hi' />", expect: "<img src='https://x.com/y.png' alt='hi' />" },
    { name: 'Markdown image already http', in: '![local](/tmp/a.png) and ![remote](http://x.com/b.png)', expect: '![local](asset://localhost/tmp/a.png) and ![remote](http://x.com/b.png)' },
    { name: 'Asset URL inline text (not in syntax)', in: 'asset://localhost/Users/x.png 看看', expect: 'asset://localhost/Users/x.png 看看' },
    { name: 'http URL inside code block preserved', in: '看 https://x.com/y.png 在这里\n```\nhttp://skip-me.com/x.png\n```\n结束', expect: '看 https://x.com/y.png 在这里\n```\nhttp://skip-me.com/x.png\n```\n结束' },
    { name: 'Adjacent images', in: '![a](/a.png)![b](/b.png)', expect: '![a](asset://localhost/a.png)![b](asset://localhost/b.png)' },
    { name: 'Image with parentheses in alt', in: '![alt (with parens)](/path/img.png)', expect: '![alt (with parens)](asset://localhost/path/img.png)' },
    {
      name: 'CLI details image paths skipped while final reply path rendered',
      in: [
        '<details data-cli-command-group="codex"><summary>⚙️ 执行命令</summary>',
        "生成了 '/Users/foo/internal.png'",
        '</details>',
        '最终图片 `/Users/foo/final.png`',
      ].join('\n'),
      expect: [
        '<details data-cli-command-group="codex"><summary>⚙️ 执行命令</summary>',
        "生成了 '/Users/foo/internal.png'",
        '</details>',
        '最终图片 `/Users/foo/final.png`\n\n![](asset://localhost/Users/foo/final.png)',
      ].join('\n'),
    },
  ];

  for (const c of cases) {
    const out = transformLocalImagePaths(c.in, fakeResolver);
    assert.equal(out, c.expect, `[${c.name}]\n  input:    ${JSON.stringify(c.in)}\n  output:   ${JSON.stringify(out)}\n  expected: ${JSON.stringify(c.expect)}`);
  }
  console.log(`transformLocalImagePaths: ${cases.length} cases ok`);
}
