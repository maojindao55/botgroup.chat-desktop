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

const adapterModule = await importTsModule(new URL('../config/cliAdapters.ts', import.meta.url));
const requestCalls = [];

globalThis.__cliPreflightRequest = async (url, options) => {
  requestCalls.push({ url, body: JSON.parse(options.body) });
  return {
    ok: true,
    async json() {
      return { success: true, data: { installed: false } };
    },
  };
};

globalThis.__cliPreflightTestDeps = {
  getCLIAdapterDefinition: adapterModule.getCLIAdapterDefinition,
  te: (key, values = {}) => `${key}:${JSON.stringify(values)}`,
  request: (...args) => globalThis.__cliPreflightRequest(...args),
};

const mod = await importTsModule(
  new URL('./cliPreflight.ts', import.meta.url),
  source => source
    .replace(
      "import { getCLIAdapterDefinition } from '@/config/cliAdapters';",
      'const { getCLIAdapterDefinition } = globalThis.__cliPreflightTestDeps;',
    )
    .replace(
      "import { te } from '@/i18n/translate';",
      'const { te } = globalThis.__cliPreflightTestDeps;',
    )
    .replace(
      "import { request } from '@/utils/request';",
      'const { request } = globalThis.__cliPreflightTestDeps;',
    ),
);

function agent(id, cli) {
  return {
    id,
    name: id,
    personality: `${id}-cli`,
    model: 'qwen-plus',
    runtime: 'cli',
    cli,
  };
}

{
  requestCalls.length = 0;
  const agents = [
    agent('cli-codex-custom', { adapter: 'codex', binary: '/opt/codex/bin/codex' }),
    agent('cli-codex-wsl', { adapter: 'codex', wsl: true }),
  ];

  const decision = await mod.decideCliPreflight(agents, { interchangeable: false });

  assert.equal(decision.action, 'proceed');
  assert.deepEqual(decision.agents.map(a => a.id), ['cli-codex-custom', 'cli-codex-wsl']);
  assert.deepEqual(requestCalls, []);
}

{
  requestCalls.length = 0;
  const agents = [
    agent('cli-codex-default', { adapter: 'codex' }),
    agent('cli-codex-custom', { adapter: 'codex', binary: '/opt/codex/bin/codex' }),
    agent('cli-codex-wsl', { adapter: 'codex', wsl: true }),
  ];

  const decision = await mod.decideCliPreflight(agents, { interchangeable: true });

  assert.equal(decision.action, 'proceed-filtered');
  assert.deepEqual(decision.agents.map(a => a.id), ['cli-codex-custom', 'cli-codex-wsl']);
  assert.deepEqual(requestCalls.map(call => call.body), [{ adapter: 'codex' }]);
  assert.deepEqual(decision.missing[0].agentNames, ['cli-codex-default']);
}

console.log('cliPreflight.test.mjs: ok');
