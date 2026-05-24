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
  assert.deepEqual(next.cli.extraArgs, ['--pure']);
  assert.equal(next.cli.toolSessionId, 'ses_abc123');
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
  assert.equal(next.cli.toolSessionId, undefined);
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
  assert.equal(next.cli.toolSessionId, undefined);
}

{
  const agent = {
    id: 'cli-codex',
    name: 'Codex',
    tags: [],
    cli: { adapter: 'codex', extraArgs: [] },
  };

  const next = withCliToolSession(agent, '019e1234-abcd');

  assert.notEqual(next, agent);
  assert.equal(next.cli.toolSessionId, '019e1234-abcd');
}

{
  const agent = {
    id: 'cli-codex',
    name: 'Codex',
    tags: [],
    cli: { adapter: 'codex', extraArgs: ['resume', 'manual-session'] },
  };

  const next = withCliToolSession(agent, '019e1234-abcd');

  assert.equal(next, agent);
}

{
  const agent = {
    id: 'cli-claude-code',
    name: 'ClaudeCode',
    tags: [],
    cli: { adapter: 'claude', extraArgs: [] },
  };

  const next = withCliToolSession(agent, '7d9c0000-0000-4000-8000-000000000001');

  assert.notEqual(next, agent);
  assert.equal(next.cli.toolSessionId, '7d9c0000-0000-4000-8000-000000000001');
}

{
  const agent = {
    id: 'cli-claude-code',
    name: 'ClaudeCode',
    tags: [],
    cli: { adapter: 'claude', extraArgs: ['--resume', 'manual-session'] },
  };

  const next = withCliToolSession(agent, '7d9c0000-0000-4000-8000-000000000001');

  assert.equal(next, agent);
}

console.log('cliToolSessions.test.mjs: ok');
