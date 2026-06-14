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

const mod = await importTsModule(new URL('./kimiStream.ts', import.meta.url));
const { parseKimiJsonLine, formatToolCallLabel } = mod;

{
  const parsed = parseKimiJsonLine(JSON.stringify({
    role: 'assistant',
    content: '你好！很高兴见到你。',
  }));

  assert.deepEqual(parsed, {
    content: '你好！很高兴见到你。',
  });
}

{
  const parsed = parseKimiJsonLine(JSON.stringify({
    role: 'meta',
    type: 'session.resume_hint',
    session_id: 'session_f4472906-8586-4ed6-92fa-f0641f642374',
    command: 'kimi -r session_f4472906-8586-4ed6-92fa-f0641f642374',
    content: 'To resume this session: kimi -r session_f4472906-8586-4ed6-92fa-f0641f642374',
  }));

  assert.deepEqual(parsed, {
    sessionId: 'session_f4472906-8586-4ed6-92fa-f0641f642374',
  });
}

{
  const parsed = parseKimiJsonLine(JSON.stringify({
    role: 'assistant',
    content: '',
  }));

  assert.equal(parsed, null);
}

{
  const parsed = parseKimiJsonLine(JSON.stringify({
    role: 'assistant',
    tool_calls: [
      {
        type: 'function',
        id: 'tool_yk0kl2Y2VmV06L7iV03KZxdw',
        function: { name: 'Read', arguments: '{"path":"workspace/main.py"}' },
      },
      {
        type: 'function',
        id: 'tool_I1FwUnzU8gyTXS3Wd7knP9Bw',
        function: { name: 'Glob', arguments: '{"pattern":"**/*.py"}' },
      },
    ],
  }));

  assert.deepEqual(parsed, {
    toolCalls: [
      { id: 'tool_yk0kl2Y2VmV06L7iV03KZxdw', name: 'Read', arguments: '{"path":"workspace/main.py"}' },
      { id: 'tool_I1FwUnzU8gyTXS3Wd7knP9Bw', name: 'Glob', arguments: '{"pattern":"**/*.py"}' },
    ],
  });
}

{
  const parsed = parseKimiJsonLine(JSON.stringify({
    role: 'tool',
    tool_call_id: 'tool_yk0kl2Y2VmV06L7iV03KZxdw',
    content: '"workspace/main.py" does not exist.',
  }));

  assert.deepEqual(parsed, {
    toolResult: {
      toolCallId: 'tool_yk0kl2Y2VmV06L7iV03KZxdw',
      content: '"workspace/main.py" does not exist.',
    },
  });
}

{
  const parsed = parseKimiJsonLine(JSON.stringify({
    role: 'assistant',
    tool_calls: [{
      type: 'function',
      id: 'tool_6qXvURvCalsLfepNcidTmuvk',
      function: { name: 'Bash', arguments: '{"command":"ls -la","timeout":10}' },
    }],
  }));

  assert.deepEqual(parsed, {
    toolCalls: [
      { id: 'tool_6qXvURvCalsLfepNcidTmuvk', name: 'Bash', arguments: '{"command":"ls -la","timeout":10}' },
    ],
  });
}

{
  const parsed = parseKimiJsonLine(JSON.stringify({
    type: 'error',
    message: 'Authentication required',
  }));

  assert.deepEqual(parsed, {
    error: 'Authentication required',
  });
}

assert.equal(parseKimiJsonLine('not json'), null);

assert.equal(
  formatToolCallLabel({ id: 'x', name: 'Bash', arguments: '{"command":"git status"}' }),
  'git status',
);
assert.equal(
  formatToolCallLabel({ id: 'x', name: 'Read', arguments: '{"path":"src/main.py"}' }),
  '读取 src/main.py',
);
assert.equal(
  formatToolCallLabel({ id: 'x', name: 'Write', arguments: '{"path":"src/main.py"}' }),
  '写入 src/main.py',
);
assert.equal(
  formatToolCallLabel({ id: 'x', name: 'Glob', arguments: '{"pattern":"**/*.ts"}' }),
  '搜索 **/*.ts',
);
assert.equal(
  formatToolCallLabel({ id: 'x', name: 'Grep', arguments: '{"pattern":"TODO"}' }),
  '搜索 TODO',
);
assert.equal(
  formatToolCallLabel({ id: 'x', name: 'UnknownTool', arguments: '{}' }),
  'UnknownTool',
);

console.log('kimiStream.test.mjs: ok');
