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
  parseCursorJsonLine,
  renderCursorCommandCompleted,
  renderCursorCommandGroupEnd,
  renderCursorCommandGroupStart,
  renderCursorCommandStarted,
} = await importTsModule(new URL('./cursorStream.ts', import.meta.url));

{
  const parsed = parseCursorJsonLine(JSON.stringify({
    type: 'system',
    subtype: 'init',
    session_id: '0f373dc8-07f8-4c79-8953-9d30ccb34053',
  }));

  assert.deepEqual(parsed, { sessionId: '0f373dc8-07f8-4c79-8953-9d30ccb34053' });
}

{
  const parsed = parseCursorJsonLine(JSON.stringify({
    type: 'assistant',
    session_id: '0f373dc8-07f8-4c79-8953-9d30ccb34053',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: '你好' }],
    },
  }));

  assert.deepEqual(parsed, {
    sessionId: '0f373dc8-07f8-4c79-8953-9d30ccb34053',
    content: '你好',
  });
}

{
  const parsed = parseCursorJsonLine(JSON.stringify({
    type: 'tool_call',
    subtype: 'started',
    tool_call: {
      shellToolCall: {
        args: { command: 'ls -la' },
      },
    },
  }));

  assert.deepEqual(parsed, {
    command: {
      phase: 'started',
      command: 'ls -la',
    },
  });
}

{
  const parsed = parseCursorJsonLine(JSON.stringify({
    type: 'tool_call',
    subtype: 'completed',
    tool_call: {
      shellToolCall: {
        result: {
          success: {
            exitCode: 0,
            stdout: 'total 24\n',
          },
        },
      },
    },
  }));

  assert.deepEqual(parsed, {
    command: {
      phase: 'completed',
      exitCode: 0,
      output: 'total 24\n',
    },
  });
}

{
  const content = [
    renderCursorCommandGroupStart(),
    renderCursorCommandStarted('ls -la', 1),
    renderCursorCommandCompleted(0, 'total 24'),
    renderCursorCommandGroupEnd(),
  ].join('');

  assert.match(content, /<details open data-cli-command-group="cursor">/);
  assert.match(content, /<small>1\. <code>ls -la<\/code><\/small>/);
}

assert.equal(parseCursorJsonLine('not json'), null);

console.log('cursorStream.test.mjs: ok');
