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

const { parseCodexJsonLine } = await importTsModule(new URL('./codexStream.ts', import.meta.url));

{
  const parsed = parseCodexJsonLine(JSON.stringify({
    type: 'thread.started',
    thread_id: '019e1234-abcd',
  }));

  assert.deepEqual(parsed, { sessionId: '019e1234-abcd' });
}

{
  const parsed = parseCodexJsonLine(JSON.stringify({
    type: 'item.completed',
    item: { type: 'agent_message', text: 'done' },
  }));

  assert.deepEqual(parsed, { content: 'done\n' });
}

{
  const parsed = parseCodexJsonLine(JSON.stringify({
    type: 'item.completed',
    item: { type: 'reasoning', text: 'Need inspect files' },
  }));

  assert.match(parsed.content, /<details open><summary>💭 思考<\/summary>/);
  assert.match(parsed.content, /> Need inspect files/);
}

{
  const parsed = parseCodexJsonLine(JSON.stringify({
    type: 'item.started',
    item: { type: 'command_execution', command: 'npm test' },
  }));

  assert.match(parsed.content, /<details open><summary>▶ npm test<\/summary>/);
}

{
  const parsed = parseCodexJsonLine(JSON.stringify({
    type: 'item.completed',
    item: { type: 'command_execution', exit_code: 0, output: 'ok' },
  }));

  assert.match(parsed.content, /<details><summary>✓ 命令完成<\/summary>/);
  assert.match(parsed.content, /exit: 0/);
  assert.match(parsed.content, /```\nok\n```/);
}

assert.equal(parseCodexJsonLine('not json'), null);

console.log('codexStream.test.mjs: ok');
