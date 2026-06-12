import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function transpileTsModule(url, replacements = new Map()) {
  let source = await readFile(url, 'utf8');
  for (const [from, to] of replacements) {
    source = source.split(from).join(to);
  }
  const compiled = ts.transpileModule(`${source}\n// cache-bust:${Date.now()}:${Math.random()}`, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  });
  return `data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`;
}

async function importTsModule(url) {
  const configUrl = await transpileTsModule(new URL('../config/chatSessions.ts', import.meta.url));
  const moduleUrl = await transpileTsModule(url, new Map([['@/config/chatSessions', configUrl]]));
  return import(moduleUrl);
}

const mod = await importTsModule(new URL('./chatAttachments.ts', import.meta.url));

const {
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_ATTACHMENT_BYTES,
  classifyAttachmentPath,
  createChatAttachment,
  validateAttachmentCandidate,
  formatBytes,
  formatAttachmentForPrompt,
  composeMessageWithAttachments,
  formatAttachmentsForHistory,
  resolveAttachmentPreviewSrc,
} = mod;

assert.equal(MAX_ATTACHMENTS_PER_MESSAGE, 10);
assert.equal(MAX_ATTACHMENT_BYTES, 50 * 1024 * 1024);

assert.deepEqual(classifyAttachmentPath('/tmp/screen.PNG'), { kind: 'image', extension: 'png', mimeType: 'image/png' });
assert.deepEqual(classifyAttachmentPath('/tmp/photo.jpeg'), { kind: 'image', extension: 'jpeg', mimeType: 'image/jpeg' });
assert.deepEqual(classifyAttachmentPath('/tmp/readme.md'), { kind: 'document', extension: 'md', mimeType: 'text/markdown' });
assert.deepEqual(classifyAttachmentPath('/tmp/data.json'), { kind: 'document', extension: 'json', mimeType: 'application/json' });
assert.deepEqual(classifyAttachmentPath('/tmp/App.tsx'), { kind: 'code', extension: 'tsx', mimeType: 'text/plain' });
assert.deepEqual(classifyAttachmentPath('/tmp/script.sh'), { kind: 'code', extension: 'sh', mimeType: 'text/plain' });
assert.equal(classifyAttachmentPath('/tmp/archive.zip'), null);
assert.equal(classifyAttachmentPath('/tmp/no-extension'), null);

{
  const attachment = createChatAttachment({
    path: '/Users/me/Desktop/screen.png',
    name: 'screen.png',
    size: 1536,
  });
  assert.equal(attachment.kind, 'image');
  assert.equal(attachment.name, 'screen.png');
  assert.equal(attachment.path, '/Users/me/Desktop/screen.png');
  assert.equal(attachment.mimeType, 'image/png');
  assert.equal(attachment.size, 1536);
  assert.equal(attachment.extension, 'png');
  assert.equal(typeof attachment.id, 'string');
}

{
  const attachment = createChatAttachment({
    path: 'C:\\Users\\me\\project\\main.TS',
    mimeType: 'application/typescript',
  });
  assert.equal(attachment.kind, 'code');
  assert.equal(attachment.name, 'main.TS');
  assert.equal(attachment.mimeType, 'application/typescript');
  assert.equal(attachment.extension, 'ts');
}

assert.equal(createChatAttachment({ path: '   ' }), null);
assert.equal(createChatAttachment({ path: '/tmp/archive.zip' }), null);

assert.equal(validateAttachmentCandidate(createChatAttachment({ path: '/tmp/a.png', size: 1 })).ok, true);
assert.deepEqual(validateAttachmentCandidate(null), { ok: false, reason: 'unsupported_type' });
assert.deepEqual(
  validateAttachmentCandidate(createChatAttachment({ path: '/tmp/big.pdf', size: MAX_ATTACHMENT_BYTES + 1 })),
  { ok: false, reason: 'file_too_large' },
);

assert.equal(formatBytes(0), '0 B');
assert.equal(formatBytes(1024), '1 KB');
assert.equal(formatBytes(1536), '1.5 KB');
assert.equal(formatBytes(1024 * 1024), '1 MB');

{
  const image = createChatAttachment({ path: '/Users/me/Desktop/screen.png', size: 1536 });
  assert.equal(formatAttachmentForPrompt(image), '- screen.png (image/png, 1.5 KB): /Users/me/Desktop/screen.png');
  assert.equal(composeMessageWithAttachments('  plain text  ', []), 'plain text');
  assert.equal(
    composeMessageWithAttachments('请分析', [image]),
    '用户消息：\n请分析\n\n附件：\n- screen.png (image/png, 1.5 KB): /Users/me/Desktop/screen.png',
  );
  assert.equal(
    composeMessageWithAttachments('', [image]),
    '用户消息：\n请查看这些附件。\n\n附件：\n- screen.png (image/png, 1.5 KB): /Users/me/Desktop/screen.png',
  );
  assert.equal(formatAttachmentsForHistory([image]), '[附件: screen.png -> /Users/me/Desktop/screen.png]');
  assert.equal(resolveAttachmentPreviewSrc(image, path => `asset://${path}`), 'asset:///Users/me/Desktop/screen.png');
}

{
  const doc = createChatAttachment({ path: '/tmp/report.pdf', size: 12 });
  assert.equal(resolveAttachmentPreviewSrc(doc, path => `asset://${path}`), null);
  assert.equal(formatAttachmentForPrompt(doc), '- report.pdf (application/pdf, 12 B): /tmp/report.pdf');
  assert.equal(formatAttachmentsForHistory([doc, createChatAttachment({ path: '/tmp/log.txt' })]), '[附件: report.pdf -> /tmp/report.pdf; log.txt -> /tmp/log.txt]');
}

assert.equal(formatAttachmentsForHistory([]), '');
assert.equal(formatAttachmentsForHistory(), '');

console.log('chatAttachments.test.mjs: ok');
