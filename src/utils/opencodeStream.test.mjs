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

const { parseOpenCodeJsonLine } = await importTsModule(new URL('./opencodeStream.ts', import.meta.url));

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
    part: { tool: 'read', state: { title: 'Read package.json' } },
  }));

  assert.deepEqual(parsed, { sessionId: 'ses_abc123', content: '→ Read package.json\n' });
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
