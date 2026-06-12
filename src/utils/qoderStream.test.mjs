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

const { parseQoderJsonLine } = await importTsModule(new URL('./qoderStream.ts', import.meta.url));

{
  const parsed = parseQoderJsonLine(JSON.stringify({
    type: 'assistant',
    session_id: 'qoder-session',
    message: { content: [{ type: 'text', text: 'hello from qoder' }] },
  }));

  assert.deepEqual(parsed, {
    sessionId: 'qoder-session',
    content: 'hello from qoder',
  });
}

{
  const parsed = parseQoderJsonLine(JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    session_id: 'qoder-real-session',
    result: '真实 qodercli 输出',
  }));

  assert.deepEqual(parsed, {
    sessionId: 'qoder-real-session',
    content: '真实 qodercli 输出',
  });
}

{
  const parsed = parseQoderJsonLine(JSON.stringify({
    sessionId: 'qoder-camel',
    result: 'final answer',
  }));

  assert.deepEqual(parsed, {
    sessionId: 'qoder-camel',
    content: 'final answer',
  });
}

{
  const parsed = parseQoderJsonLine(JSON.stringify({
    type: 'error',
    session_id: 'qoder-session',
    error: { message: 'login required' },
  }));

  assert.deepEqual(parsed, {
    sessionId: 'qoder-session',
    error: 'login required',
  });
}

{
  const parsed = parseQoderJsonLine(JSON.stringify({
    type: 'result',
    subtype: 'error_during_execution',
    is_error: true,
    session_id: 'qoder-error-session',
    errors: ["EPERM: operation not permitted, mkdir '/Users/hongbin9/.qoder/projects/demo'"],
  }));

  assert.deepEqual(parsed, {
    sessionId: 'qoder-error-session',
    error: "EPERM: operation not permitted, mkdir '/Users/hongbin9/.qoder/projects/demo'",
  });
}

assert.equal(parseQoderJsonLine('not json'), null);

console.log('qoderStream.test.mjs: ok');
