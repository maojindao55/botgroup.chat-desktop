import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function importTsModule(url, transform = (source) => source) {
  const source = transform(await readFile(url, 'utf8'));
  const compiled = ts.transpileModule(`${source}\n// cache-bust:${Date.now()}:${Math.random()}`, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`;
  return import(moduleUrl);
}

const [
  cliAdapters,
  claudeStream,
  cursorStream,
  codexStream,
  opencodeStream,
  qoderStream,
  kimiStream,
] = await Promise.all([
  importTsModule(new URL('../config/cliAdapters.ts', import.meta.url)),
  importTsModule(new URL('./claudeStream.ts', import.meta.url)),
  importTsModule(new URL('./cursorStream.ts', import.meta.url)),
  importTsModule(new URL('./codexStream.ts', import.meta.url)),
  importTsModule(new URL('./opencodeStream.ts', import.meta.url)),
  importTsModule(new URL('./qoderStream.ts', import.meta.url)),
  importTsModule(new URL('./kimiStream.ts', import.meta.url)),
]);

globalThis.__cliStreamHandlersTestDeps = {
  ...cliAdapters,
  ...claudeStream,
  ...cursorStream,
  ...codexStream,
  ...opencodeStream,
  ...qoderStream,
  ...kimiStream,
};

const { createCLIStreamHandler } = await importTsModule(
  new URL('./cliStreamHandlers.ts', import.meta.url),
  source => {
    let out = source.replace(
      "import { adapterUsesOpenCodeSessionTitle, getCLIAdapterDefinition, type CLIStreamMode } from '../config/cliAdapters';",
      "const { adapterUsesOpenCodeSessionTitle, getCLIAdapterDefinition } = globalThis.__cliStreamHandlersTestDeps;\ntype CLIStreamMode = import('../config/cliAdapters').CLIStreamMode;",
    );
    out = out.replace(/import \{\r?\n\s*parseClaudeJsonLine,\r?\n\s*renderClaudeCommandCompleted,\r?\n\s*renderClaudeCommandGroupEnd,\r?\n\s*renderClaudeCommandGroupStart,\r?\n\s*renderClaudeCommandStarted,\r?\n\} from '\.\/claudeStream';/, `const {
  parseClaudeJsonLine,
  renderClaudeCommandCompleted,
  renderClaudeCommandGroupEnd,
  renderClaudeCommandGroupStart,
  renderClaudeCommandStarted,
} = globalThis.__cliStreamHandlersTestDeps;`);
    out = out.replace(/import \{\r?\n\s*parseCursorJsonLine,\r?\n\s*renderCursorCommandCompleted,\r?\n\s*renderCursorCommandGroupEnd,\r?\n\s*renderCursorCommandGroupStart,\r?\n\s*renderCursorCommandStarted,\r?\n\s*renderCursorThinking,\r?\n\s*renderCursorToolCompleted,\r?\n\s*shouldEmitCursorSummary,\r?\n\} from '\.\/cursorStream';/, `const {
  parseCursorJsonLine,
  renderCursorCommandCompleted,
  renderCursorCommandGroupEnd,
  renderCursorCommandGroupStart,
  renderCursorCommandStarted,
  renderCursorThinking,
  renderCursorToolCompleted,
  shouldEmitCursorSummary,
} = globalThis.__cliStreamHandlersTestDeps;`);
    out = out.replace(/import \{\r?\n\s*parseCodexJsonLine,\r?\n\s*renderCodexCommandCompleted,\r?\n\s*renderCodexCommandGroupEnd,\r?\n\s*renderCodexCommandGroupStart,\r?\n\s*renderCodexCommandStarted,\r?\n\} from '\.\/codexStream';/, `const {
  parseCodexJsonLine,
  renderCodexCommandCompleted,
  renderCodexCommandGroupEnd,
  renderCodexCommandGroupStart,
  renderCodexCommandStarted,
} = globalThis.__cliStreamHandlersTestDeps;`);
    out = out.replace(/import \{\r?\n\s*parseOpenCodeJsonLine,\r?\n\s*renderOpenCodeCommand,\r?\n\s*renderOpenCodeCommandGroupEnd,\r?\n\s*renderOpenCodeCommandGroupStart,\r?\n\} from '\.\/opencodeStream';/, `const {
  parseOpenCodeJsonLine,
  renderOpenCodeCommand,
  renderOpenCodeCommandGroupEnd,
  renderOpenCodeCommandGroupStart,
} = globalThis.__cliStreamHandlersTestDeps;`);
    out = out.replace(/import \{\r?\n\s*parseQoderJsonLine,\r?\n\} from '\.\/qoderStream';/, `const {
  parseQoderJsonLine,
} = globalThis.__cliStreamHandlersTestDeps;`);
    out = out.replace(/import \{\r?\n\s*parseKimiJsonLine,\r?\n\s*renderKimiCommandGroupEnd,\r?\n\s*renderKimiCommandGroupStart,\r?\n\s*renderKimiCommandCompleted,\r?\n\s*renderKimiCommandStarted,\r?\n\s*formatToolCallLabel,\r?\n\s*type KimiToolCallInfo,\r?\n\} from '\.\/kimiStream';/, `const {
  parseKimiJsonLine,
  renderKimiCommandGroupEnd,
  renderKimiCommandGroupStart,
  renderKimiCommandCompleted,
  renderKimiCommandStarted,
  formatToolCallLabel,
} = globalThis.__cliStreamHandlersTestDeps;
type KimiToolCallInfo = import('./kimiStream').KimiToolCallInfo;`);
    return out;
  },
);

function createRecorder() {
  const chunks = [];
  const events = [];
  return {
    chunks,
    events,
    emitters: {
      enqueueChunk: (chunk) => chunks.push(chunk),
      enqueueEvent: (event) => events.push(event),
    },
  };
}

{
  const recorder = createRecorder();
  const handler = createCLIStreamHandler('codex', recorder.emitters);

  assert.equal(handler.streamMode, 'codex-json');
  assert.equal(handler.usesJsonModeStderr, true);
  assert.equal(handler.hasCommandGroupOpen(), false);

  const handled = handler.handleStdoutLine(JSON.stringify({
    type: 'item.started',
    thread_id: 'codex-session',
    item: { type: 'command_execution', command: 'npm test' },
  }));

  assert.equal(handled, true);
  assert.equal(handler.hasCommandGroupOpen(), true);
  assert.deepEqual(recorder.events, [
    { type: 'tool_session', adapter: 'codex', sessionId: 'codex-session' },
  ]);
  assert.match(recorder.chunks.join(''), /data-cli-command-group="codex"/);
  assert.match(recorder.chunks.join(''), /npm test/);

  handler.closeCommandGroups();
  assert.equal(handler.hasCommandGroupOpen(), false);
}

{
  const recorder = createRecorder();
  let closedIntermediate = false;
  const handler = createCLIStreamHandler('codex', {
    ...recorder.emitters,
    closeIntermediateDetails: () => {
      closedIntermediate = true;
      recorder.chunks.push('</details>');
    },
  });

  assert.equal(handler.handleStdoutLine(JSON.stringify({
    type: 'item.completed',
    item: { type: 'agent_message', text: 'final answer' },
  })), true);

  assert.equal(closedIntermediate, true);
  assert.match(recorder.chunks.join(''), /<\/details>final answer/);
}

{
  const recorder = createRecorder();
  const handler = createCLIStreamHandler('opencode', recorder.emitters);

  assert.equal(handler.streamMode, 'opencode-json');
  assert.equal(handler.handleStdoutLine(JSON.stringify({
    type: 'text',
    sessionID: 'open-session',
    part: { text: 'hello from opencode' },
  })), true);

  handler.flushDone();

  assert.deepEqual(recorder.events, [
    { type: 'tool_session', adapter: 'opencode', sessionId: 'open-session' },
    { type: 'tool_session', adapter: 'opencode', sessionId: 'open-session' },
  ]);
  assert.equal(recorder.chunks.join(''), 'hello from opencode');
}

// opencode step_start event — first event with sessionID but no renderable content
{
  const recorder = createRecorder();
  const handler = createCLIStreamHandler('opencode', recorder.emitters);

  assert.equal(handler.handleStdoutLine(JSON.stringify({
    type: 'step_start',
    sessionID: 'ses-step-start',
    part: { id: 'prt-1', type: 'step-start' },
  })), true);

  assert.deepEqual(recorder.events, [
    { type: 'tool_session', adapter: 'opencode', sessionId: 'ses-step-start' },
  ]);
  assert.equal(recorder.chunks.length, 0);
}

// opencode fallback: stream has no sessionID, but request carries toolSessionId
{
  const recorder = createRecorder();
  const handler = createCLIStreamHandler('opencode', {
    ...recorder.emitters,
    toolSessionId: 'ses-from-request',
  });

  // text event without sessionID (edge case)
  assert.equal(handler.handleStdoutLine(JSON.stringify({
    type: 'text',
    part: { text: 'response without session' },
  })), true);

  assert.equal(recorder.chunks.join(''), 'response without session');
  assert.equal(recorder.events.length, 0, 'no tool_session from handleStdoutLine when sessionID is missing');

  handler.flushDone();

  assert.deepEqual(recorder.events, [
    { type: 'tool_session', adapter: 'opencode', sessionId: 'ses-from-request' },
  ]);
}

// opencode: stream has sessionID, request also has toolSessionId — stream wins
{
  const recorder = createRecorder();
  const handler = createCLIStreamHandler('opencode', {
    ...recorder.emitters,
    toolSessionId: 'ses-from-request',
  });

  handler.handleStdoutLine(JSON.stringify({
    type: 'step_start',
    sessionID: 'ses-from-stream',
    part: { id: 'prt-1', type: 'step-start' },
  }));

  handler.flushDone();

  assert.deepEqual(recorder.events, [
    { type: 'tool_session', adapter: 'opencode', sessionId: 'ses-from-stream' },
    { type: 'tool_session', adapter: 'opencode', sessionId: 'ses-from-stream' },
  ]);
}

// opencode: no sessionID in stream, no toolSessionId in request — flushDone silent
{
  const recorder = createRecorder();
  const handler = createCLIStreamHandler('opencode', recorder.emitters);

  handler.handleStdoutLine(JSON.stringify({
    type: 'text',
    part: { text: 'no session here' },
  }));

  handler.flushDone();

  assert.equal(recorder.events.length, 0, 'no tool_session when neither stream nor request has sessionId');
}

{
  const recorder = createRecorder();
  const handler = createCLIStreamHandler('qodercli', recorder.emitters);

  assert.equal(handler.streamMode, 'qoder-json');
  assert.equal(handler.handleStdoutLine(JSON.stringify({
    type: 'assistant',
    session_id: 'qoder-session',
    message: { content: [{ type: 'text', text: 'hello from qoder' }] },
  })), true);

  assert.deepEqual(recorder.events, [
    { type: 'tool_session', adapter: 'qodercli', sessionId: 'qoder-session' },
  ]);
  assert.equal(recorder.chunks.join(''), 'hello from qoder');
}

{
  const recorder = createRecorder();
  const handler = createCLIStreamHandler('kimi', recorder.emitters);

  assert.equal(handler.streamMode, 'kimi-json');
  assert.equal(handler.handleStdoutLine(JSON.stringify({
    role: 'meta',
    type: 'session.resume_hint',
    session_id: 'session_f4472906',
    content: 'To resume this session: kimi -r session_f4472906',
  })), true);
  assert.equal(handler.handleStdoutLine(JSON.stringify({
    role: 'assistant',
    content: '你好！很高兴见到你。',
  })), true);

  assert.deepEqual(recorder.events, [
    { type: 'tool_session', adapter: 'kimi', sessionId: 'session_f4472906' },
  ]);
  assert.equal(recorder.chunks.join(''), '你好！很高兴见到你。\n');
}

{
  const recorder = createRecorder();
  const handler = createCLIStreamHandler('kimi', recorder.emitters);

  assert.equal(handler.streamMode, 'kimi-json');
  assert.equal(handler.handleStdoutLine(JSON.stringify({
    role: 'meta',
    type: 'session.resume_hint',
    session_id: 'session_kimi_tool',
  })), true);
  assert.equal(handler.handleStdoutLine(JSON.stringify({
    role: 'assistant',
    tool_calls: [{
      type: 'function',
      id: 'tool_read_1',
      function: { name: 'Read', arguments: '{"path":"workspace/main.py"}' },
    }],
  })), true);
  assert.equal(handler.handleStdoutLine(JSON.stringify({
    role: 'tool',
    tool_call_id: 'tool_read_1',
    content: '"workspace/main.py" does not exist.',
  })), true);
  assert.equal(handler.handleStdoutLine(JSON.stringify({
    role: 'assistant',
    content: '文件不存在。',
  })), true);

  assert.equal(handler.hasCommandGroupOpen(), false);
  const content = recorder.chunks.join('');
  assert.match(content, /<details open data-cli-command-group="kimi">/);
  assert.match(content, /读取 workspace\/main\.py/);
  assert.match(content, /"workspace\/main\.py" does not exist\./);
  assert.match(content, /<\/details>/);
  assert.match(content, /文件不存在。/);
}

{
  const recorder = createRecorder();
  const handler = createCLIStreamHandler('cursor', recorder.emitters);

  handler.handleStdoutLine(JSON.stringify({
    type: 'tool_call',
    subtype: 'started',
    tool_call: {
      generateImageToolCall: {
        args: { prompt: 'rainy homework illustration' },
      },
    },
  }));
  handler.handleStdoutLine(JSON.stringify({
    type: 'tool_call',
    subtype: 'completed',
    tool_call: {
      generateImageToolCall: {
        result: {
          success: {
            images: [{ path: 'vibe_images/rain-homework.png' }],
          },
        },
      },
    },
  }));
  handler.handleStdoutLine(JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: '画好了！\n\n图片应该已经在对话里显示了。',
  }));

  const content = recorder.chunks.join('');
  assert.match(content, /<details open data-cli-command-group="cursor">/);
  assert.match(content, /✓ generateImage 完成/);
  assert.match(content, /<\/details>\n\n画好了！/);
  assert.match(content, /!\[generateImage\]\(vibe_images\/rain-homework\.png\)/);
}

{
  const recorder = createRecorder();
  const handler = createCLIStreamHandler('custom-cli', recorder.emitters);

  assert.equal(handler.streamMode, 'raw');
  assert.equal(handler.usesJsonModeStderr, false);
  assert.equal(handler.handleStdoutLine('plain output'), false);
  handler.closeCommandGroups();
  handler.flushDone();
  assert.deepEqual(recorder.chunks, []);
  assert.deepEqual(recorder.events, []);
}

console.log('cliStreamHandlers.test.mjs: ok');
