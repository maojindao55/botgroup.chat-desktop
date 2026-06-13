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
  parseOpenCodeJsonLine,
  renderOpenCodeCommandGroupStart,
  renderOpenCodeCommand,
  renderOpenCodeCommandGroupEnd,
} = await importTsModule(new URL('./opencodeStream.ts', import.meta.url));

{
  const parsed = parseOpenCodeJsonLine(JSON.stringify({
    type: 'session.updated',
    sessionId: 'ses_camel_case',
    info: { id: 'ses_camel_case', title: 'Fix login' },
  }));

  assert.deepEqual(parsed, { sessionId: 'ses_camel_case' });
}

{
  const parsed = parseOpenCodeJsonLine(JSON.stringify({
    type: 'step_start',
    sessionID: 'ses_abc123',
    part: { type: 'step-start' },
  }));

  assert.deepEqual(parsed, { sessionId: 'ses_abc123' });
}

{
  const parsed = parseOpenCodeJsonLine(JSON.stringify({
    type: 'text',
    sessionID: 'ses_abc123',
    part: { type: 'text', text: 'hello\n' },
  }));

  assert.deepEqual(parsed, { sessionId: 'ses_abc123', content: 'hello\n' });
}

{
  const parsed = parseOpenCodeJsonLine(JSON.stringify({
    type: 'tool_use',
    sessionID: 'ses_abc123',
    part: {
      tool: 'read',
      state: {
        title: 'Read package.json',
        input: { filePath: 'package.json' },
        output: '{ "name": "demo" }',
      },
    },
  }));

  assert.equal(parsed.sessionId, 'ses_abc123');
  assert.deepEqual(parsed.command, {
    title: 'Read package.json',
    input: { filePath: 'package.json' },
    output: '{ "name": "demo" }',
  });
}

{
  const content = [
    renderOpenCodeCommandGroupStart(),
    renderOpenCodeCommand({
      title: '/bin/zsh -lc "nl -ba sort-algorithm.test.js"',
      input: { cwd: '/tmp/demo' },
      output: '1\tassert.equal(true, true)',
    }, 1),
    renderOpenCodeCommandGroupEnd(),
  ].join('');

  assert.match(content, /<details open data-cli-command-group="opencode">/);
  assert.match(content, /<summary>⚙️ 执行命令<\/summary>/);
  assert.match(content, /<p><small>1\. <code>\/bin\/zsh -lc "nl -ba sort-algorithm\.test\.js"<\/code><\/small><\/p>/);
  assert.doesNotMatch(content, /####/);
  assert.match(content, /\*\*Input\*\*\n\n```json\n\{\n  "cwd": "\/tmp\/demo"\n\}\n```/);
  assert.match(content, /\*\*Output\*\*\n\n```\n1\tassert\.equal\(true, true\)\n```/);
  assert.match(content, /<\/details>/);
}

{
  const parsed = parseOpenCodeJsonLine(JSON.stringify({
    type: 'reasoning',
    sessionID: 'ses_abc123',
    part: { type: 'reasoning', text: 'Need inspect files' },
  }));

  assert.equal(parsed.sessionId, 'ses_abc123');
  assert.match(parsed.content, /<details open><summary>💭 思考<\/summary>/);
  assert.match(parsed.content, /> Need inspect files/);
}

{
  const parsed = parseOpenCodeJsonLine(JSON.stringify({
    type: 'step_finish',
    sessionID: 'ses_abc123',
    part: {
      reason: 'tool-calls',
      cost: 0.001,
      tokens: { input: 100, output: 20, reasoning: 3 },
    },
  }));

  assert.equal(parsed.sessionId, 'ses_abc123');
  assert.match(parsed.content, /<details><summary>✓ Step: tool-calls<\/summary>/);
  assert.match(parsed.content, /cost: \$0\.001/);
  assert.match(parsed.content, /tokens: input 100, output 20, reasoning 3/);
}

{
  const parsed = parseOpenCodeJsonLine(JSON.stringify({
    type: 'step_finish',
    sessionID: 'ses_abc123',
    part: { reason: 'stop' },
  }));

  assert.deepEqual(parsed, { sessionId: 'ses_abc123' });
}

{
  const parsed = parseOpenCodeJsonLine(JSON.stringify({
    type: 'error',
    sessionID: 'ses_abc123',
    error: { data: { message: 'Rate limit exceeded' } },
  }));

  assert.deepEqual(parsed, { sessionId: 'ses_abc123', error: 'Rate limit exceeded' });
}

assert.equal(parseOpenCodeJsonLine('not json'), null);

console.log('opencodeStream.test.mjs: ok');
