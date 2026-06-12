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
globalThis.__cliToolSessionExecutorStore = {
  parseCLICommandInput: () => ({ args: [] }),
  mergeCLIExtraArgs: (executorArgs, memberArgs) => [...(executorArgs || []), ...(memberArgs || [])].filter(Boolean),
  resolveCLIExecutorForConfig: () => undefined,
  useCLIExecutorStore: { getState: () => ({ overrides: {} }) },
};

const { cliToolSessionKey, resolveCliToolSessionKey, withCliToolSession } = await importTsModule(
  new URL('./cliToolSessions.ts', import.meta.url),
  source => source
    .replace(
      "import { hasExplicitToolSessionArg, supportsCliToolSession } from '@/config/cliAdapters';",
      'const { hasExplicitToolSessionArg, supportsCliToolSession } = globalThis.__cliToolSessionTestDeps;',
    )
    .replace(
      "import { mergeCLIExtraArgs, parseCLICommandInput, resolveCLIExecutorForConfig, useCLIExecutorStore } from '@/store/cliExecutorStore';",
      'const { mergeCLIExtraArgs, parseCLICommandInput, resolveCLIExecutorForConfig, useCLIExecutorStore } = globalThis.__cliToolSessionExecutorStore;',
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

// Pipeline 多阶段 session 复用：onToolSession 更新 agent 内存值后，
// 后续阶段通过同一对象引用能读到更新后的 toolSessionId
{
  // 模拟 pipeline 第一阶段：agent 初始 toolSessionId 为 null（通过 withCliToolSession 未设置）
  const agent = withCliToolSession(
    { id: 'cli-opencode', name: 'OpenCode', tags: [], cli: { adapter: 'opencode', extraArgs: [] } },
    null,
  );
  // withCliToolSession 在 sessionId 为 null 时返回原 agent，不设置 toolSessionId
  assert.equal(agent.cli.toolSessionId, undefined, 'first stage: toolSessionId not set by withCliToolSession(null)');

  // 模拟 prepareExecutionContexts：将 agent 包装到 context 中
  const contexts = [agent].map(a => ({ agent: a, cwd: '/tmp' }));

  // 模拟第一阶段 onToolSession 回调：捕获到 sessionId 后更新内存
  const mockOnToolSession = (agentId, sessionId) => {
    const memAgent = [agent].find(a => a.id === agentId);
    if (memAgent?.cli) {
      memAgent.cli.toolSessionId = sessionId;
    }
  };
  mockOnToolSession('cli-opencode', 'ses_15596ba3cffewUFEMIPkoHkfmx');

  // 验证：agent 内存值已更新
  assert.equal(agent.cli.toolSessionId, 'ses_15596ba3cffewUFEMIPkoHkfmx',
    'after onToolSession: agent.cli.toolSessionId updated in memory');

  // 验证：context 中的 agent 引用看到同一更新（pipeline 后续阶段复用）
  assert.equal(contexts[0].agent.cli.toolSessionId, 'ses_15596ba3cffewUFEMIPkoHkfmx',
    'context.agent.cli.toolSessionId reflects the same mutation');

  // 模拟后续阶段 callCLIAgent 读取 ctx.agent.cli.toolSessionId
  const ctx = contexts[0];
  const cliCfg = ctx.agent.cli || { adapter: 'codex' };
  assert.equal(cliCfg.toolSessionId || null, 'ses_15596ba3cffewUFEMIPkoHkfmx',
    'subsequent stage: cliCfg.toolSessionId carries the first stage sessionId');
}

// Pipeline 多阶段：不同 agent 各自独立，互不干扰
{
  const agentA = withCliToolSession(
    { id: 'cli-opencode', name: 'OpenCode', tags: [], cli: { adapter: 'opencode', extraArgs: [] } },
    null,
  );
  const agentB = withCliToolSession(
    { id: 'cli-codex', name: 'Codex', tags: [], cli: { adapter: 'codex', extraArgs: [] } },
    null,
  );
  const activeAgents = [agentA, agentB];

  // 模拟第一阶段：agentA 捕获到 sessionId
  const agentAId = 'cli-opencode';
  const memA = activeAgents.find(a => a.id === agentAId);
  memA.cli.toolSessionId = 'ses_AAA';

  // 验证：agentA 被更新，agentB 不受影响
  assert.equal(agentA.cli.toolSessionId, 'ses_AAA');
  assert.equal(agentB.cli.toolSessionId, undefined, 'agentB is not affected by agentA session capture');

  // 模拟第二阶段：agentB 也能捕获自己的 sessionId
  const agentBId = 'cli-codex';
  const memB = activeAgents.find(a => a.id === agentBId);
  memB.cli.toolSessionId = 'ses_BBB';

  assert.equal(agentA.cli.toolSessionId, 'ses_AAA', 'agentA sessionId preserved');
  assert.equal(agentB.cli.toolSessionId, 'ses_BBB');
}

console.log('cliToolSessions.test.mjs: ok');
