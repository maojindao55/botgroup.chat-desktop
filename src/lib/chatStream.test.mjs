import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function importTsModule(url) {
  const source = await readFile(url, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  });
  return import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`);
}

const { readSseContent, stripSpeakerPrefix, StreamTimeoutError } = await importTsModule(new URL('./chatStream.ts', import.meta.url));

const encoder = new TextEncoder();
function readerFrom(chunks) {
  let i = 0;
  return {
    cancelled: false,
    async read() {
      if (i >= chunks.length) return { done: true };
      return { done: false, value: encoder.encode(chunks[i++]) };
    },
    async cancel() {
      this.cancelled = true;
    },
  };
}

assert.equal(stripSpeakerPrefix('好奇博士：你好', ['好奇博士']), '你好');
assert.equal(stripSpeakerPrefix('好奇博士: 你好', ['好奇博士']), '你好');
assert.equal(stripSpeakerPrefix('你好，好奇博士：', ['好奇博士']), '你好，好奇博士：');

{
  const deltas = [];
  const text = await readSseContent(
    readerFrom([
      'data: {"content":"好奇',
      '博士：咦"}\r\ndata: {"content":"，这是"}\n',
      'data: [DONE]\n: comment\ndata: not-json\n',
      'data: {"content":"为什么呢？"}',
    ]),
    { onDelta: (t) => deltas.push(t), speakerNames: ['好奇博士'] },
  );
  assert.equal(text, '咦，这是为什么呢？', 'joins split lines, strips speaker prefix, handles CRLF and trailing line');
  assert.deepEqual(deltas, ['咦', '咦，这是', '咦，这是为什么呢？']);
}

{
  // 多字节字符被拆在两个 chunk 之间
  const bytes = encoder.encode('data: {"content":"小熊"}\n');
  let step = 0;
  const reader = {
    async read() {
      step += 1;
      if (step === 1) return { done: false, value: bytes.slice(0, 20) };
      if (step === 2) return { done: false, value: bytes.slice(20) };
      return { done: true };
    },
  };
  assert.equal(await readSseContent(reader), '小熊');
}

{
  // 空闲超时：已有内容时返回已收到的部分
  let calls = 0;
  const reader = {
    cancelled: false,
    async read() {
      calls += 1;
      if (calls === 1) return { done: false, value: encoder.encode('data: {"content":"半句"}\n') };
      return new Promise(() => {});
    },
    async cancel() {
      this.cancelled = true;
    },
  };
  assert.equal(await readSseContent(reader, { idleTimeoutMs: 30 }), '半句');
  assert.equal(reader.cancelled, true);

  // 没有任何内容时抛出超时
  const silent = { async read() { return new Promise(() => {}); }, async cancel() {} };
  await assert.rejects(readSseContent(silent, { idleTimeoutMs: 30 }), (e) => e instanceof StreamTimeoutError);
}

console.log('chatStream.test.mjs: ok');
