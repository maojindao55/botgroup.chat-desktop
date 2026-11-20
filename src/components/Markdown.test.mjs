import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./Markdown.tsx', import.meta.url), 'utf8');

assert.match(source, /allowHtml=\{false\}/, 'raw HTML must not be rendered in kid chat');
assert.match(source, /enableLatex=\{false\}/, 'formulas are disabled for kids');
assert.match(source, /enableMermaid=\{false\}/, 'mermaid diagrams are disabled for kids');
assert.match(source, /\{toKidFriendlyMarkdown\(content\)\}/, 'content is cleaned before rendering');
assert.match(source, /components=\{chatMarkdownComponents\}/, 'images use the dedicated renderer');
assert.doesNotMatch(source, /convertFileSrc|save_image_as|basePath/, 'local file access is gone');

console.log('Markdown.test.mjs: ok');
