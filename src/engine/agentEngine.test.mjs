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

const cliCalls = [];
let llmRequestCalls = 0;

globalThis.__agentEngineTestDeps = {
  lookupProviderByEnvName: () => 'provider-test',
  translateEngineRole: (role) => ({
    judge: '裁判',
    reducer: '汇总者',
    supervisorSuffix: '监督者',
  }[role] || role),
  te: (key, params = {}) => `[${key}] ${params.message || params.status || params.code || ''}`,
  request: async () => {
    llmRequestCalls++;
    throw new Error('LLM request should not be used for CLI-only strategy coordination');
  },
  useAIMemberStore: {
    getState: () => ({ members: {} }),
  },
  Blackboard: class Blackboard {},
  mapAIMemberToLegacy: (agent) => ({
    id: agent.id,
    name: agent.name,
    personality: `${agent.id}-cli`,
    model: 'qwen-plus',
    runtime: 'cli',
    cli: agent.cli,
  }),
  callCLIAgent: async (_groupId, ctx, prompt, _options, callbacks) => {
    cliCalls.push({ agentId: ctx.agent.id, cwd: ctx.cwd, prompt });
    callbacks.onAgentStart('task', ctx.agent.id, ctx.agent.name, {});
    callbacks.onToken('task', `CLI:${ctx.agent.name}`);
    callbacks.onAgentEnd('task', `CLI:${ctx.agent.name}`);
    return { content: `CLI:${ctx.agent.name}`, status: 'completed', exitCode: 0 };
  },
};

const { executeAgentStrategy } = await importTsModule(
  new URL('./agentEngine.ts', import.meta.url),
  source => source
    .replace(
      "import { lookupProviderByEnvName } from '@/config/providers';",
      'const { lookupProviderByEnvName } = globalThis.__agentEngineTestDeps;',
    )
    .replace(
      "import { translateEngineRole } from '@/i18n/engineLabels';",
      'const { translateEngineRole } = globalThis.__agentEngineTestDeps;',
    )
    .replace(
      "import { te } from '@/i18n/translate';",
      'const { te } = globalThis.__agentEngineTestDeps;',
    )
    .replace(
      "import { request } from '@/utils/request';",
      'const { request } = globalThis.__agentEngineTestDeps;',
    )
    .replace(
      "import { useAIMemberStore } from '@/store/aiMemberStore';",
      'const { useAIMemberStore } = globalThis.__agentEngineTestDeps;',
    )
    .replace(
      "import { Blackboard } from './blackboard';",
      'const { Blackboard } = globalThis.__agentEngineTestDeps;',
    )
    .replace(
      "import { mapAIMemberToLegacy } from '@/config/aiCharacters';",
      'const { mapAIMemberToLegacy } = globalThis.__agentEngineTestDeps;',
    )
    .replace(
      "import { callCLIAgent as callCLIAgentRaw } from './cliEngine';",
      'const { callCLIAgent: callCLIAgentRaw } = globalThis.__agentEngineTestDeps;',
    ),
);

function cliAgent(id, name = id) {
  return {
    id,
    kind: 'cli',
    name,
    role: '开发成员',
    systemPrompt: '',
    providerId: '',
    model: '',
    tools: [],
    maxTurns: 1,
    temperature: 0,
    cli: { adapter: 'codex', extraArgs: ['--json'] },
  };
}

function group(strategy, overrides = {}) {
  return {
    id: `group-${strategy}`,
    type: 'agent',
    name: strategy,
    description: '',
    memberIds: [],
    agents: [cliAgent('cli-codex', 'Codex'), cliAgent('cli-claude', 'Claude')],
    strategy,
    maxRounds: 1,
    workspacePath: '/workspace/project',
    approvalMode: 'auto',
    showStderr: true,
    ...overrides,
  };
}

function callbacks() {
  const events = [];
  return {
    events,
    onAgentStart: (agentId, agentName) => events.push(['start', agentId, agentName]),
    onToken: (agentId, token) => events.push(['token', agentId, token]),
    onAgentEnd: (agentId, content) => events.push(['end', agentId, content]),
    onError: (agentId, error) => events.push(['error', agentId, error]),
    onInfo: (message) => events.push(['info', message]),
  };
}

{
  cliCalls.length = 0;
  llmRequestCalls = 0;
  const cb = callbacks();
  const results = await executeAgentStrategy(group('react'), 'fix bug', '', [], cb);

  assert.equal(llmRequestCalls, 0);
  assert.deepEqual(cliCalls.map(c => c.agentId), ['cli-codex', 'cli-claude']);
  assert.equal(results.length, 2);
  assert.ok(cb.events.some(e => e[0] === 'info' && /回退/.test(e[1])));
}

{
  cliCalls.length = 0;
  llmRequestCalls = 0;
  const cb = callbacks();
  const results = await executeAgentStrategy(group('debate'), 'review decision', '', [], cb);

  assert.equal(llmRequestCalls, 0);
  assert.deepEqual(cliCalls.map(c => c.agentId), ['cli-codex', 'cli-claude']);
  assert.ok(results.some(r => r.agentId === '__sys_judge' && /最终观点汇总/.test(r.content)));
}

{
  cliCalls.length = 0;
  llmRequestCalls = 0;
  const cb = callbacks();

  await assert.rejects(
    () => executeAgentStrategy(group('sequential', { workspacePath: '' }), 'fix bug', '', [], cb),
    /工作目录/,
  );
  assert.equal(llmRequestCalls, 0);
  assert.equal(cliCalls.length, 0);
}

console.log('agentEngine.test.mjs: ok');
