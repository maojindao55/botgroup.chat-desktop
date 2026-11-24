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

const memory = new Map();
globalThis.localStorage = {
  getItem: (key) => (memory.has(key) ? memory.get(key) : null),
  setItem: (key, value) => memory.set(key, String(value)),
  removeItem: (key) => memory.delete(key),
};

const mod = await importTsModule(new URL('./chatRuntimeSettings.ts', import.meta.url));

assert.equal(mod.DEFAULT_CHAT_REPLY_TIMEOUT_MS, 15000);
assert.equal(mod.loadChatReplyTimeoutMs(), 15000);

assert.equal(mod.saveChatReplyTimeoutMs(25000), 25000);
assert.equal(mod.loadChatReplyTimeoutMs(), 25000);

assert.equal(mod.saveChatReplyTimeoutMs(1000), 5000, 'clamped to minimum');
assert.equal(mod.saveChatReplyTimeoutMs(999999), 180000, 'clamped to maximum');
assert.equal(mod.normalizeChatReplyTimeoutMs('abc'), 15000);
assert.equal(mod.normalizeChatReplyTimeoutMs('20000'), 20000);

console.log('chatRuntimeSettings.test.mjs: ok');
