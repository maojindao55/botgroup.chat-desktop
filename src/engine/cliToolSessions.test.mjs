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
globalThis.__cliToolSessionTestDeps = adapterModule;

const { cliToolSessionKey, resolveCliToolSessionKey, withCliToolSession } = await importTsModule(
  new URL('./cliToolSessions.ts', import.meta.url),
  source => source.replace(
    "import { hasExplicitToolSessionArg, supportsCliToolSession } from '@/config/cliAdapters';",
    'const { hasExplicitToolSessionArg, supportsCliToolSession } = globalThis.__cliToolSessionTestDeps;',
  ),
);

assert.equal(
  cliToolSessionKey('group-1', 'cli-opencode', '/workspace/project'),
  'cliToolSession:group-1:cli-opencode:/workspace/project',
);

assert.equal(
  resolveCliToolSessionKey({
    developmentTaskId: 'devtask-aaa',
    templateId: 'group-coding',
    agentId: 'cli-opencode',
    workspacePath: '/workspace/project',
    sessionPolicy: 'task',
  }),
  'cliToolSession:devtask-aaa:cli-opencode:/workspace/project',
);

assert.equal(
  resolveCliToolSessionKey({
    developmentTaskId: 'devtask-aaa',
    templateId: 'group-coding',
    agentId: 'cli-opencode',
    workspacePath: '/workspace/project',
    sessionPolicy: 'template',
  }),
  'cliToolSession:group-coding:cli-opencode:/workspace/project',
);

assert.equal(
  resolveCliToolSessionKey({
    developmentTaskId: 'devtask-aaa',
    templateId: 'group-coding',
    agentId: 'cli-opencode',
    workspacePath: '/workspace/project',
    sessionPolicy: 'workspace',
  }),
  'cliToolSession:ws:/workspace/project:cli-opencode:/workspace/project',
);

assert.notEqual(
  resolveCliToolSessionKey({
    developmentTaskId: 'devtask-aaa',
    templateId: 'group-coding',
    agentId: 'cli-opencode',
    workspacePath: '/workspace/project',
    sessionPolicy: 'task',
  }),
  resolveCliToolSessionKey({
    developmentTaskId: 'devtask-bbb',
    templateId: 'group-coding',
    agentId: 'cli-opencode',
    workspacePath: '/workspace/project',
    sessionPolicy: 'task',
  }),
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

{
  const agent = {
    id: 'cli-cursor',
    name: 'Cursor',
    tags: [],
    cli: { adapter: 'cursor', extraArgs: [] },
  };

  const next = withCliToolSession(agent, '0f373dc8-07f8-4c79-8953-9d30ccb34053');

  assert.notEqual(next, agent);
  assert.equal(next.cli.toolSessionId, '0f373dc8-07f8-4c79-8953-9d30ccb34053');
}

{
  const agent = {
    id: 'cli-cursor',
    name: 'Cursor',
    tags: [],
    cli: { adapter: 'cursor', extraArgs: ['--resume', 'manual-session'] },
  };

  const next = withCliToolSession(agent, '0f373dc8-07f8-4c79-8953-9d30ccb34053');

  assert.equal(next, agent);
}

{
  const agent = {
    id: 'cli-custom',
    name: 'Custom CLI',
    tags: [],
    cli: { adapter: 'custom-cli', extraArgs: [] },
  };

  const next = withCliToolSession(agent, 'session-not-supported');

  assert.equal(next, agent);
}

console.log('cliToolSessions.test.mjs: ok');
