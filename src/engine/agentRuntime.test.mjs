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
let storeMembers = {};

globalThis.__agentRuntimeTestDeps = {
  lookupProviderByEnvName: () => 'provider-test',
  te: (key, params = {}) => `[${key}] ${params.message || params.status || ''}`,
  request: async () => {
    llmRequestCalls++;
    const stream = new ReadableStream({
      start(controller) {
        const enc = new TextEncoder();
        controller.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"hello"}}]}\n'));
        controller.enqueue(enc.encode('data: [DONE]\n'));
        controller.close();
      },
    });
    return new Response(stream, { status: 200 });
  },
  useAIMemberStore: {
    getState: () => ({ members: storeMembers }),
  },
  mapAIMemberToLegacy: (agent) => ({
    id: agent.id,
    name: agent.name,
    personality: `${agent.id}-cli`,
    model: 'qwen-plus',
    runtime: 'cli',
    cli: agent.cli,
  }),
  withCliToolSession: (agent, sessionId) => ({
    ...agent,
    cli: { ...agent.cli, toolSessionId: sessionId },
  }),
  callCLIAgent: async (_groupId, ctx, prompt, _options, callbacks) => {
    cliCalls.push({ agentId: ctx.agent.id, cwd: ctx.cwd, prompt });
    callbacks.onAgentStart('task', ctx.agent.id, ctx.agent.name, {});
    callbacks.onToken('task', `CLI:${ctx.agent.name}`);
    callbacks.onAgentEnd('task', `CLI:${ctx.agent.name}`);
    return { content: `CLI:${ctx.agent.name}`, status: 'completed', exitCode: 0 };
  },
};

const runtime = await importTsModule(
  new URL('./agentRuntime.ts', import.meta.url),
  source => source
    .replace(
      "import { lookupProviderByEnvName } from '@/config/providers';",
      'const { lookupProviderByEnvName } = globalThis.__agentRuntimeTestDeps;',
    )
    .replace(
      "import { te } from '@/i18n/translate';",
      'const { te } = globalThis.__agentRuntimeTestDeps;',
    )
    .replace(
      "import { request } from '@/utils/request';",
      'const { request } = globalThis.__agentRuntimeTestDeps;',
    )
    .replace(
      "import { useAIMemberStore } from '@/store/aiMemberStore';",
      'const { useAIMemberStore } = globalThis.__agentRuntimeTestDeps;',
    )
    .replace(
      "import { mapAIMemberToLegacy } from '@/config/aiCharacters';",
      'const { mapAIMemberToLegacy } = globalThis.__agentRuntimeTestDeps;',
    )
    .replace(
      "import { callCLIAgent as callCLIAgentRaw } from './cliEngine';",
      'const { callCLIAgent: callCLIAgentRaw } = globalThis.__agentRuntimeTestDeps;',
    )
    .replace(
      "import { withCliToolSession } from './cliToolSessions';",
      'const { withCliToolSession } = globalThis.__agentRuntimeTestDeps;',
    ),
);

function cliAgent(id, name = id) {
  return {
    id, name,
    kind: 'cli',
    role: 'developer',
    systemPrompt: '',
    providerId: '',
    model: '',
    tools: [],
    cli: { adapter: 'codex', extraArgs: ['--json'] },
  };
}

function llmAgent(id, name = id) {
  return {
    id, name,
    kind: 'agent',
    role: 'reviewer',
    systemPrompt: 'You review.',
    providerId: 'provider-test',
    model: 'gpt-test',
    tools: [],
    temperature: 0,
  };
}

function callbacks() {
  const events = [];
  return {
    events,
    onAgentStart: (id, name, meta) => events.push(['start', id, name, meta?.phaseId]),
    onToken: (id, tok, meta) => events.push(['tok', id, tok, meta?.phaseId]),
    onAgentEnd: (id, content, meta) => events.push(['end', id, content, meta?.phaseId]),
    onError: (id, err, meta) => events.push(['err', id, err, meta?.phaseId]),
  };
}

// ---------- helpers ----------
{
  assert.equal(runtime.isCLIMember(cliAgent('a')), true);
  assert.equal(runtime.isCLIMember(llmAgent('b')), false);
  assert.equal(runtime.isCLIMember(null), false);
}

{
  const n = runtime.normalizeAgentMember({ id: 'x', name: 'X', llm: { apiKey: 'DEEPSEEK_API_KEY', model: 'foo' } });
  assert.equal(n.providerId, 'provider-test');
  assert.equal(n.model, 'foo');
}

{
  assert.equal(runtime.hasCLIWorkspace({ groupId: 'g' }), false);
  assert.equal(runtime.hasCLIWorkspace({ groupId: 'g', workspacePath: '' }), false);
  assert.equal(runtime.hasCLIWorkspace({ groupId: 'g', workspacePath: '/tmp' }), true);
}

// ---------- getGroupAgents reads only from store, no inline fallback ----------
{
  storeMembers = {
    'a': cliAgent('a'),
    'b': llmAgent('b'),
    'c': { id: 'c', kind: 'persona' }, // filtered out
  };
  const group = { id: 'g', memberIds: ['a', 'b', 'c', 'missing'] };
  const agents = runtime.getGroupAgents(group);
  assert.deepEqual(agents.map(a => a.id), ['a', 'b']);
}

// ---------- runSingleAgent dispatches to CLI when member is CLI ----------
{
  cliCalls.length = 0;
  llmRequestCalls = 0;
  const cb = callbacks();
  const result = await runtime.runSingleAgent(
    cliAgent('cli-1', 'Codex'),
    'fix bug', 'context',
    cb,
    { groupId: 'g', workspacePath: '/ws' },
    { phaseId: 'p1' },
  );
  assert.equal(llmRequestCalls, 0);
  assert.equal(cliCalls.length, 1);
  assert.equal(cliCalls[0].agentId, 'cli-1');
  assert.match(cliCalls[0].prompt, /\[Context\]\ncontext/);
  assert.match(cliCalls[0].prompt, /\[User\]\nfix bug/);
  assert.equal(result.content, 'CLI:Codex');
  assert.equal(result.agentName, 'Codex');
  // phaseId propagated through cb meta
  const startEvt = cb.events.find(e => e[0] === 'start');
  assert.equal(startEvt[3], 'p1');
}

// ---------- runSingleAgent CLI requires workspacePath ----------
{
  await assert.rejects(
    () => runtime.runSingleAgent(
      cliAgent('cli-2'), 'task', '',
      callbacks(),
      { groupId: 'g', workspacePath: '' },
    ),
    /workspace path/,
  );
}

// ---------- runSingleAgent dispatches LLM path for non-CLI member ----------
{
  cliCalls.length = 0;
  llmRequestCalls = 0;
  const cb = callbacks();
  const result = await runtime.runSingleAgent(
    llmAgent('llm-1', 'Reviewer'),
    'question?', '',
    cb,
    { groupId: 'g' },
    { phaseId: 'p2', agentIdOverride: 'llm-1_r1' },
  );
  assert.equal(cliCalls.length, 0);
  assert.equal(llmRequestCalls, 1);
  assert.equal(result.agentId, 'llm-1_r1');
  assert.equal(result.content, 'hello');
  assert.ok(cb.events.some(e => e[0] === 'tok' && e[1] === 'llm-1_r1' && e[2] === 'hello' && e[3] === 'p2'));
}

// ---------- toolSessionLookup is invoked for CLI agents ----------
{
  cliCalls.length = 0;
  const lookups = [];
  await runtime.runSingleAgent(
    cliAgent('cli-3', 'C3'), 't', '',
    callbacks(),
    {
      groupId: 'g',
      workspacePath: '/ws',
      toolSessionLookup: (id) => { lookups.push(id); return 'sess-123'; },
    },
  );
  assert.deepEqual(lookups, ['cli-3']);
}

console.log('agentRuntime.test.mjs: ok');
