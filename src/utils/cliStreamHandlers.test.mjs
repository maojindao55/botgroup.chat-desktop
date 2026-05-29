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
] = await Promise.all([
  importTsModule(new URL('../config/cliAdapters.ts', import.meta.url)),
  importTsModule(new URL('./claudeStream.ts', import.meta.url)),
  importTsModule(new URL('./cursorStream.ts', import.meta.url)),
  importTsModule(new URL('./codexStream.ts', import.meta.url)),
  importTsModule(new URL('./opencodeStream.ts', import.meta.url)),
]);

globalThis.__cliStreamHandlersTestDeps = {
  ...cliAdapters,
  ...claudeStream,
  ...cursorStream,
  ...codexStream,
  ...opencodeStream,
};

const { createCLIStreamHandler } = await importTsModule(
  new URL('./cliStreamHandlers.ts', import.meta.url),
  source => source
    .replace(
      "import { adapterUsesOpenCodeSessionTitle, getCLIAdapterDefinition, type CLIStreamMode } from '../config/cliAdapters';",
      "const { adapterUsesOpenCodeSessionTitle, getCLIAdapterDefinition } = globalThis.__cliStreamHandlersTestDeps;\ntype CLIStreamMode = import('../config/cliAdapters').CLIStreamMode;",
    )
    .replace(
      `import {
  parseClaudeJsonLine,
  renderClaudeCommandCompleted,
  renderClaudeCommandGroupEnd,
  renderClaudeCommandGroupStart,
  renderClaudeCommandStarted,
} from './claudeStream';`,
      `const {
  parseClaudeJsonLine,
  renderClaudeCommandCompleted,
  renderClaudeCommandGroupEnd,
  renderClaudeCommandGroupStart,
  renderClaudeCommandStarted,
} = globalThis.__cliStreamHandlersTestDeps;`,
    )
    .replace(
      `import {
  parseCursorJsonLine,
  renderCursorCommandCompleted,
  renderCursorCommandGroupEnd,
  renderCursorCommandGroupStart,
  renderCursorCommandStarted,
  renderCursorThinking,
  renderCursorToolCompleted,
  shouldEmitCursorSummary,
} from './cursorStream';`,
      `const {
  parseCursorJsonLine,
  renderCursorCommandCompleted,
  renderCursorCommandGroupEnd,
  renderCursorCommandGroupStart,
  renderCursorCommandStarted,
  renderCursorThinking,
  renderCursorToolCompleted,
  shouldEmitCursorSummary,
} = globalThis.__cliStreamHandlersTestDeps;`,
    )
    .replace(
      `import {
  parseCodexJsonLine,
  renderCodexCommandCompleted,
  renderCodexCommandGroupEnd,
  renderCodexCommandGroupStart,
  renderCodexCommandStarted,
} from './codexStream';`,
      `const {
  parseCodexJsonLine,
  renderCodexCommandCompleted,
  renderCodexCommandGroupEnd,
  renderCodexCommandGroupStart,
  renderCodexCommandStarted,
} = globalThis.__cliStreamHandlersTestDeps;`,
    )
    .replace(
      `import {
  parseOpenCodeJsonLine,
  renderOpenCodeCommand,
  renderOpenCodeCommandGroupEnd,
  renderOpenCodeCommandGroupStart,
} from './opencodeStream';`,
      `const {
  parseOpenCodeJsonLine,
  renderOpenCodeCommand,
  renderOpenCodeCommandGroupEnd,
  renderOpenCodeCommandGroupStart,
} = globalThis.__cliStreamHandlersTestDeps;`,
    ),
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
