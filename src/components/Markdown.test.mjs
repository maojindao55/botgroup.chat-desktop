import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./Markdown.tsx', import.meta.url), 'utf8');

assert.match(
  source,
  /components=\{chatMarkdownComponents\}/,
  'ChatMarkdown must override markdown image rendering',
);
assert.match(
  source,
  /reactMarkdownProps=\{chatMarkdownReactProps\}/,
  'ChatMarkdown must pass react-markdown options',
);
assert.match(
  source,
  /urlTransform:\s*\(url:\s*string\)\s*=>\s*url/,
  'react-markdown must not strip Tauri asset URLs from image src attributes',
);
assert.match(
  source,
  /function\s+ChatMarkdownImage/,
  'ChatMarkdown must define a dedicated image renderer',
);
assert.match(
  source,
  /basePath\?: string/,
  'ChatMarkdown should accept a basePath for relative CLI image paths',
);
assert.match(
  source,
  /resolveImagePath\(path, basePath\)/,
  'ChatMarkdown should resolve relative image paths against basePath before convertFileSrc',
);
assert.match(
  source,
  /data-local-cli-image=\{resolvedSrc \? 'true' : undefined\}/,
  'local CLI images should render through a native img element',
);
assert.match(
  source,
  /const resolvedSrc = resolveMarkdownImageSrc\(src\);[\s\S]*?<img[\s\S]*?src=\{imageSrc\}/,
  'local Tauri asset images must bypass Lobe/Ant Image fallback rendering',
);
assert.doesNotMatch(
  source,
  /<LobeImage|from '@lobehub\/ui'.*Image as LobeImage/,
  'chat markdown images should not fall back to Lobe/Ant Image rendering',
);
assert.match(
  source,
  /asset:\|tauri:/,
  'local image detection should include Tauri asset and tauri protocols',
);
assert.match(
  source,
  /asset\|tauri\)\\\.localhost/,
  'local image detection should include convertFileSrc localhost forms',
);
assert.match(
  source,
  /rawLocalImageSrcPattern/,
  'local image rendering should recognize raw absolute image paths from historical markdown',
);
assert.match(
  source,
  /resolveMarkdownImageSrc\(src\)/,
  'image renderer should resolve raw local image src values before deciding renderer',
);
assert.match(
  source,
  /stripImageSrcQuotes/,
  'image renderer should strip quotes around markdown image src values',
);
assert.match(
  source,
  /data-original-src=\{src === imageSrc \? undefined : src\}/,
  'converted raw local image elements should retain their original src for debugging',
);

console.log('Markdown.test.mjs: ok');
