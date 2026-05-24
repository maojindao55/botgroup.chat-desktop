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
  parseClaudeJsonLine,
  renderClaudeCommandCompleted,
  renderClaudeCommandGroupEnd,
  renderClaudeCommandGroupStart,
  renderClaudeCommandStarted,
} = await importTsModule(new URL('./claudeStream.ts', import.meta.url));

{
  const parsed = parseClaudeJsonLine(JSON.stringify({
    type: 'system',
    subtype: 'init',
    session_id: '7d9c0000-0000-4000-8000-000000000001',
  }));

  assert.deepEqual(parsed, { sessionId: '7d9c0000-0000-4000-8000-000000000001' });
}

{
  const parsed = parseClaudeJsonLine(JSON.stringify({
    type: 'assistant',
    session_id: '7d9c0000-0000-4000-8000-000000000001',
    message: {
      content: [
        { type: 'text', text: 'hello' },
      ],
    },
  }));

  assert.deepEqual(parsed, {
    sessionId: '7d9c0000-0000-4000-8000-000000000001',
    content: 'hello',
  });
}

{
  const parsed = parseClaudeJsonLine(JSON.stringify({
    type: 'assistant',
    message: {
      content: [
        {
          type: 'tool_use',
          name: 'Bash',
          input: { command: 'npm test' },
        },
      ],
    },
  }));

  assert.deepEqual(parsed, {
    command: {
      phase: 'started',
      command: 'npm test',
    },
  });
}

{
  const parsed = parseClaudeJsonLine(JSON.stringify({
    type: 'user',
    message: {
      content: [
        { type: 'tool_result', content: 'ok' },
      ],
    },
  }));

  assert.deepEqual(parsed, {
    command: {
      phase: 'completed',
      output: 'ok',
    },
  });
}

{
  const content = [
    renderClaudeCommandGroupStart(),
    renderClaudeCommandStarted('/bin/zsh -lc "nl -ba sort-algorithm.test.js"', 1),
    renderClaudeCommandCompleted('ok'),
    renderClaudeCommandGroupEnd(),
  ].join('');

  assert.match(content, /<details open data-cli-command-group="claude">/);
  assert.match(content, /<small>1\. <code>\/bin\/zsh -lc "nl -ba sort-algorithm\.test\.js"<\/code><\/small>/);
  assert.doesNotMatch(content, /#### 1\./);
}

assert.equal(parseClaudeJsonLine('not json'), null);

console.log('claudeStream.test.mjs: ok');
