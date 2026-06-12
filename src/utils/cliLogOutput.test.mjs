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

const cliOutput = await importTsModule(new URL('./cliOutput.ts', import.meta.url));
globalThis.__cliLogOutputTestDeps = cliOutput;

const { reconstructCliOutputFromLogEntries } = await importTsModule(
  new URL('./cliLogOutput.ts', import.meta.url),
  source => source.replace(
    "import { cleanCliOutputLine, shouldSuppressCliOutputLine } from './cliOutput';",
    'const { cleanCliOutputLine, shouldSuppressCliOutputLine } = globalThis.__cliLogOutputTestDeps;',
  ),
);

{
  const output = reconstructCliOutputFromLogEntries([
    {
      type: 'system',
      content: 'Starting task execution. Adapter: antigravity',
    },
    {
      type: 'stdout',
      content: 'I will inspect the contents of the `index.html` file.',
    },
    {
      type: 'stdout',
      content: '该项目是一个单文件网页应用 **像素三消 Ultra**。',
    },
    {
      type: 'system',
      content: 'Process finished. Status: completed, exit_code: Some(0)',
    },
  ]);

  assert.match(output, /index\.html/);
  assert.match(output, /像素三消 Ultra/);
  assert.doesNotMatch(output, /Starting task execution/);
  assert.doesNotMatch(output, /Process finished/);
}

{
  const output = reconstructCliOutputFromLogEntries([
    { type: 'stderr', content: 'rendering final answer' },
  ], { includeStderr: true });

  assert.equal(output, '> _rendering final answer_');
}

{
  const output = reconstructCliOutputFromLogEntries([
    { type: 'stderr', content: 'hidden debug line' },
  ], { includeStderr: false });

  assert.equal(output, '');
}

console.log('cliLogOutput.test.mjs: ok');
