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

globalThis.__cliExecutorStoreDeps = {
  create: (init) => {
    let state;
    const set = (patch) => {
      state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
    };
    const get = () => state;
    const store = (selector) => (selector ? selector(state) : state);
    state = init(set, get);
    store.getState = () => state;
    return store;
  },
  cliAdapterDefinitions: [
    {
      id: 'codex',
      label: 'Codex',
      defaultBinary: 'codex',
      streamMode: 'codex-json',
      capabilities: { toolSession: true },
    },
  ],
  hasExplicitToolSessionArg: () => false,
};

const mod = await importTsModule(
  new URL('./cliExecutorStore.ts', import.meta.url),
  source => source
    .replace(
      "import { create } from 'zustand';",
      'const { create } = globalThis.__cliExecutorStoreDeps;',
    )
    .replace(
      "import { hasExplicitToolSessionArg, cliAdapterDefinitions, type CLIAdapterDefinition, type CLIAdapterId } from '@/config/cliAdapters';",
      'const { hasExplicitToolSessionArg, cliAdapterDefinitions } = globalThis.__cliExecutorStoreDeps;',
    ),
);

{
  const command = 'C:\\Users\\me\\AppData\\Roaming\\npm\\codex.cmd --json';
  const parsed = mod.parseCLICommandInput(command);
  assert.equal(parsed.binary, 'C:\\Users\\me\\AppData\\Roaming\\npm\\codex.cmd');
  assert.deepEqual(parsed.args, ['--json']);
}

{
  const command = '"C:\\Program Files\\Codex\\codex.cmd" --json';
  const parsed = mod.parseCLICommandInput(command);
  assert.equal(parsed.binary, 'C:\\Program Files\\Codex\\codex.cmd');
  assert.deepEqual(parsed.args, ['--json']);
}

{
  const parsed = mod.parseCLICommandInput('/opt/my\\ codex/bin/codex --json');
  assert.equal(parsed.binary, '/opt/my codex/bin/codex');
  assert.deepEqual(parsed.args, ['--json']);
}

{
  const merged = mod.mergeCLIExtraArgs(
    ['--config', 'a=1'],
    ['--config', 'b=2'],
  );
  assert.deepEqual(merged, ['--config', 'a=1', '--config', 'b=2']);
}

{
  const overrides = {
    'codex-windows': {
      id: 'codex-windows',
      baseAdapter: 'codex',
      label: 'Codex Windows',
      binary: 'C:\\Users\\me\\AppData\\Roaming\\npm\\codex.cmd',
    },
  };
  const executor = mod.resolveCLIExecutorForConfig(
    overrides,
    'codex',
    'C:\\Users\\me\\AppData\\Roaming\\npm\\codex.cmd',
  );
  assert.equal(executor.id, 'codex-windows');
}

console.log('cliExecutorStore.test.mjs: ok');
