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
  renderCursorThinking,
  shouldEmitCursorSummary,
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
    type: 'assistant',
    message: {
      role: 'assistant',
      content: '纯字符串回复',
    },
  }));

  assert.equal(parsed?.content, '纯字符串回复');
}

{
  const parsed = parseCursorJsonLine(JSON.stringify({
    type: 'thinking',
    subtype: 'delta',
    text: '分析需求',
  }));

  assert.deepEqual(parsed?.thinking, { phase: 'delta', text: '分析需求' });
}

{
  const parsed = parseCursorJsonLine(JSON.stringify({
    type: 'thinking',
    subtype: 'completed',
    session_id: 'abc',
  }));

  assert.deepEqual(parsed, {
    sessionId: 'abc',
    thinking: { phase: 'completed' },
  });
}

{
  const parsed = parseCursorJsonLine(JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: '最终摘要\n\n## 小节',
  }));

  assert.equal(parsed?.resultContent, '最终摘要\n\n## 小节');
}

{
  const parsed = parseCursorJsonLine(JSON.stringify({
    type: 'tool_call',
    subtype: 'started',
    tool_call: {
      editToolCall: {
        args: { path: '/tmp/game.js' },
      },
    },
  }));

  assert.deepEqual(parsed?.command, {
    phase: 'started',
    command: '写入 /tmp/game.js',
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
    renderCursorThinking('先读代码\n再改文件'),
    renderCursorCommandGroupEnd(),
  ].join('');

  assert.match(content, /<details open data-cli-command-group="cursor">/);
  assert.match(content, /<summary>💭 思考<\/summary>/);
}

{
  assert.equal(shouldEmitCursorSummary('短摘要', ''), true);
  assert.equal(shouldEmitCursorSummary('相同', '相同'), false);
  assert.equal(shouldEmitCursorSummary('前缀\n完整摘要', '完整摘要'), false);
}

assert.equal(parseCursorJsonLine('not json'), null);

console.log('cursorStream.test.mjs: ok');
