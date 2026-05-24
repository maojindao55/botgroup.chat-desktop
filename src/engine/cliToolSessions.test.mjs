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

const { cliToolSessionKey, withCliToolSession } = await importTsModule(new URL('./cliToolSessions.ts', import.meta.url));

assert.equal(
  cliToolSessionKey('group-1', 'cli-opencode', '/workspace/project'),
  'cliToolSession:group-1:cli-opencode:/workspace/project',
);

{
  const agent = {
    id: 'cli-opencode',
    name: 'OpenCode',
    tags: [],
    cli: { adapter: 'opencode', extraArgs: ['--pure'] },
  };

  const next = withCliToolSession(agent, 'ses_abc123');

  assert.notEqual(next, agent);
  assert.deepEqual(next.cli.extraArgs, ['--pure', '--session', 'ses_abc123']);
}

{
  const agent = {
    id: 'cli-opencode',
    name: 'OpenCode',
    tags: [],
    cli: { adapter: 'opencode', extraArgs: ['--session', 'ses_old'] },
  };

  const next = withCliToolSession(agent, 'ses_new');

  assert.deepEqual(next.cli.extraArgs, ['--session', 'ses_old']);
}

{
  const agent = {
    id: 'cli-opencode',
    name: 'OpenCode',
    tags: [],
    cli: { adapter: 'opencode', extraArgs: ['--session=ses_old'] },
  };

  const next = withCliToolSession(agent, 'ses_new');

  assert.deepEqual(next.cli.extraArgs, ['--session=ses_old']);
}

{
  const agent = {
    id: 'cli-codex',
    name: 'Codex',
    tags: [],
    cli: { adapter: 'codex', extraArgs: [] },
  };

  assert.equal(withCliToolSession(agent, 'ses_abc123'), agent);
}

console.log('cliToolSessions.test.mjs: ok');
