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

const adapterModule = await importTsModule(new URL('./cliAdapters.ts', import.meta.url));
globalThis.__cliTasksTestDeps = adapterModule;
globalThis.__cliTasksI18n = {
  t: (_key, opts) => opts?.defaultValue ?? _key,
  language: 'zh-CN',
};
globalThis.__cliTasksExecutorStore = {
  applyExecutorDefaultsToCliConfig: (cli) => cli,
};
const mod = await importTsModule(
  new URL('./cliTasks.ts', import.meta.url),
  source => source
    .replace(
      "import { adapterUsesOpenCodeSessionTitle } from './cliAdapters';",
      'const { adapterUsesOpenCodeSessionTitle } = globalThis.__cliTasksTestDeps;',
    )
    .replace(
      "import i18n from '@/i18n';",
      'const i18n = globalThis.__cliTasksI18n;',
    )
    .replace(
      "import { applyExecutorDefaultsToCliConfig } from '@/store/cliExecutorStore';",
      'const { applyExecutorDefaultsToCliConfig } = globalThis.__cliTasksExecutorStore;',
    ),
);
globalThis.__cliTasksExecutorStoreForSessions = {
  parseCLICommandInput: () => ({ args: [] }),
  mergeCLIExtraArgs: (executorArgs, memberArgs) => [...(executorArgs || []), ...(memberArgs || [])].filter(Boolean),
  resolveCLIExecutorForConfig: () => undefined,
  useCLIExecutorStore: { getState: () => ({ overrides: {} }) },
};
const sessions = await importTsModule(
  new URL('../engine/cliToolSessions.ts', import.meta.url),
  source => source
    .replace(
      "import { hasExplicitToolSessionArg, supportsCliToolSession } from '@/config/cliAdapters';",
      'const { hasExplicitToolSessionArg, supportsCliToolSession } = globalThis.__cliTasksTestDeps;',
    )
    .replace(
      "import { mergeCLIExtraArgs, parseCLICommandInput, resolveCLIExecutorForConfig, useCLIExecutorStore } from '@/store/cliExecutorStore';",
      'const { mergeCLIExtraArgs, parseCLICommandInput, resolveCLIExecutorForConfig, useCLIExecutorStore } = globalThis.__cliTasksExecutorStoreForSessions;',
    ),
);

const sampleGroup = {
  id: 'group-coding',
  type: 'cli',
  name: 'AI Coding 工作组',
  description: '协作编码',
  memberIds: ['cli-codex', 'cli-claude-code'],
  workspacePath: '/Users/dev/project',
  approvalMode: 'auto',
  timeout: 300000,
  showStderr: true,
  strategy: 'review',
};

const template = mod.cliGroupToTeamTemplate(sampleGroup);

assert.equal(template.id, 'group-coding');
assert.equal(template.name, 'AI Coding 工作组');
assert.deepEqual(template.memberIds, ['cli-codex', 'cli-claude-code']);
assert.equal(template.strategy, 'review');
assert.equal(template.sessionPolicy, 'task');
assert.equal(template.debugMode, false);
assert.equal(mod.cliGroupToTeamTemplate({ ...sampleGroup, sessionPolicy: 'workspace' }).sessionPolicy, 'workspace');
assert.equal(mod.cliGroupToTeamTemplate({ ...sampleGroup, debugMode: true }).debugMode, true);
assert.equal(mod.cliGroupToTeamTemplate({ ...sampleGroup, debugMode: false }).debugMode, false);
assert.equal(mod.templateSnapshotToCLIGroup({ ...template, debugMode: true }).debugMode, true);
assert.equal(mod.templateSnapshotToCLIGroup({ ...template, debugMode: false }).debugMode, false);
assert.equal(mod.sessionPolicyLabel('template'), '按模板共享');
assert.equal(template.workspacePath, '/Users/dev/project');

const task = mod.createDevelopmentTask({
  prompt: 'Fix login page validation',
  template,
  workspacePath: '/Users/dev/project',
});

assert.ok(task.id.startsWith('devtask-'));
assert.equal(task.templateId, 'group-coding');
assert.equal(task.templateSnapshot.name, 'AI Coding 工作组');
assert.equal(task.templateSnapshot.strategy, 'review');
assert.notEqual(task.templateSnapshot, template);
assert.deepEqual(task.templateSnapshot, template);
assert.equal(task.messages.length, 1);
assert.equal(task.messages[0].role, 'user');
assert.equal(task.messages[0].content, 'Fix login page validation');

assert.equal(mod.inferCliModelFromArgs(['--model', 'gpt-5-codex']), 'gpt-5-codex');
assert.equal(mod.inferCliModelFromArgs(['--model=gpt-5-codex']), 'gpt-5-codex');
assert.equal(mod.inferCliModelFromArgs(['-m', 'claude-sonnet-4.5']), 'claude-sonnet-4.5');
assert.equal(mod.inferCliModelFromArgs(['-m=claude-sonnet-4.5']), 'claude-sonnet-4.5');
assert.equal(mod.inferCliModelFromArgs(['--model']), undefined);
assert.equal(mod.inferCliModelFromArgs(['--model', '--sandbox']), undefined);
assert.equal(mod.inferCliModelFromArgs(['--json']), undefined);

{
  const sourceMembers = [
    {
      id: 'cli-codex',
      kind: 'cli',
      name: 'Codex Stable',
      avatar: '/img/codex.webp',
      tags: ['编码'],
      cli: {
        adapter: 'codex',
        binary: '/usr/local/bin/codex',
        extraArgs: ['--json', '--model', 'gpt-5-codex'],
        env: { CODEX_HOME: '/tmp/codex-home' },
        approvalMode: 'auto',
        showStderr: true,
      },
    },
    {
      id: 'llm-qwen',
      kind: 'llm',
      name: 'Qwen',
    },
  ];
  const memberSnapshots = mod.createCLITaskMemberSnapshots(sourceMembers);
  const snapshotTask = mod.createDevelopmentTask({
    prompt: 'Use original runtime',
    template,
    workspacePath: '/Users/dev/project',
    memberSnapshots,
  });

  assert.deepEqual(snapshotTask.memberSnapshots.map((m) => m.id), ['cli-codex']);
  assert.equal(snapshotTask.memberSnapshots[0].name, 'Codex Stable');
  assert.equal(snapshotTask.memberSnapshots[0].cli.adapter, 'codex');
  assert.equal(snapshotTask.memberSnapshots[0].cli.binary, '/usr/local/bin/codex');
  assert.deepEqual(snapshotTask.memberSnapshots[0].cli.extraArgs, ['--json', '--model', 'gpt-5-codex']);
  assert.deepEqual(snapshotTask.memberSnapshots[0].cli.env, { CODEX_HOME: '/tmp/codex-home' });
  assert.equal(snapshotTask.memberSnapshots[0].modelHint, 'gpt-5-codex');

  sourceMembers[0].cli.adapter = 'opencode';
  sourceMembers[0].cli.extraArgs.push('--mutated');
  sourceMembers[0].cli.env.CODEX_HOME = '/tmp/mutated';

  assert.equal(snapshotTask.memberSnapshots[0].cli.adapter, 'codex');
  assert.deepEqual(snapshotTask.memberSnapshots[0].cli.extraArgs, ['--json', '--model', 'gpt-5-codex']);
  assert.deepEqual(snapshotTask.memberSnapshots[0].cli.env, { CODEX_HOME: '/tmp/codex-home' });
  assert.equal(snapshotTask.memberSnapshots[0].modelHint, 'gpt-5-codex');

  const restoredAgent = mod.cliTaskMemberSnapshotToAgent(snapshotTask.memberSnapshots[0]);
  assert.equal(restoredAgent.id, 'cli-codex');
  assert.equal(restoredAgent.name, 'Codex Stable');
  assert.equal(restoredAgent.runtime, 'cli');
  assert.equal(restoredAgent.cli.adapter, 'codex');
  assert.deepEqual(restoredAgent.cli.extraArgs, ['--json', '--model', 'gpt-5-codex']);
  assert.equal(restoredAgent.cli.modelHint, 'gpt-5-codex');
}

const task2 = mod.createDevelopmentTask({
  prompt: 'Second isolated task',
  template,
});

assert.notEqual(task.id, task2.id);
assert.equal(task2.messages.length, 1);
assert.notEqual(task.messages[0].id, task2.messages[0].id);

{
  const scopeTask = sessions.resolveCliToolSessionScope({
    developmentTaskId: task.id,
    templateId: template.id,
    workspacePath: '/Users/dev/project',
    sessionPolicy: 'task',
  });
  const scopeTask2 = sessions.resolveCliToolSessionScope({
    developmentTaskId: task2.id,
    templateId: template.id,
    workspacePath: '/Users/dev/project',
    sessionPolicy: 'task',
  });
  assert.notEqual(scopeTask, scopeTask2);
  assert.equal(scopeTask, task.id);
}

{
  const scopeTemplate = sessions.resolveCliToolSessionScope({
    developmentTaskId: task.id,
    templateId: template.id,
    workspacePath: '/Users/dev/project',
    sessionPolicy: 'template',
  });
  const scopeTemplate2 = sessions.resolveCliToolSessionScope({
    developmentTaskId: task2.id,
    templateId: template.id,
    workspacePath: '/Users/dev/project',
    sessionPolicy: 'template',
  });
  assert.equal(scopeTemplate, scopeTemplate2);
  assert.equal(scopeTemplate, template.id);
}

{
  const cloned = mod.cloneTaskMessages(task.messages);
  cloned[0].content = 'mutated';
  assert.notEqual(cloned[0].content, task.messages[0].content);
}

{
  const archived = { ...task, status: 'archived' };
  const active = { ...task2, status: 'completed' };
  const filtered = mod.filterDevelopmentTasks([archived, active, task], {
    showArchived: false,
  });
  assert.equal(filtered.length, 2);
  assert.ok(!filtered.some(t => t.status === 'archived'));
}

{
  const filtered = mod.filterDevelopmentTasks([task, task2], {
    status: 'queued',
    templateId: 'group-coding',
  });
  assert.equal(filtered.length, 2);
}

{
  const taskWsA = { ...task, workspacePath: '/Users/dev/project-a' };
  const taskWsB = { ...task2, workspacePath: '/Users/dev/project-b' };
  const filtered = mod.filterDevelopmentTasks([taskWsA, taskWsB], {
    workspacePath: '/Users/dev/project-a',
  });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].id, taskWsA.id);
}

{
  const taskWithAgent = {
    ...task,
    messages: [
      ...task.messages,
      {
        id: 'msg-agent',
        taskId: task.id,
        role: 'agent',
        agentId: 'cli-codex',
        agentName: 'Codex',
        content: 'done',
        status: 'completed',
      },
    ],
  };
  const taskOtherTemplate = {
    ...task2,
    templateSnapshot: {
      ...task2.templateSnapshot,
      memberIds: ['cli-claude-code'],
    },
  };
  assert.equal(mod.taskInvolvesAgent(taskWithAgent, 'cli-codex'), true);
  assert.equal(mod.taskInvolvesAgent(taskOtherTemplate, 'cli-codex'), false);
  assert.equal(mod.taskInvolvesAgent(taskOtherTemplate, 'cli-claude-code'), true);
  const filtered = mod.filterDevelopmentTasks([taskWithAgent, taskOtherTemplate], {
    agentId: 'cli-codex',
  });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].id, taskWithAgent.id);
}

{
  const parsed = mod.parseAgentMention('@Codex fix login', ['cli-codex', 'cli-claude-code'], (id) => (
    id === 'cli-codex' ? 'Codex' : 'Claude Code'
  ));
  assert.equal(parsed.agentId, 'cli-codex');
  assert.equal(parsed.prompt, 'fix login');
}

{
  const parsed = mod.parseAgentMention('fix login without mention', ['cli-codex'], () => 'Codex');
  assert.equal(parsed.agentId, undefined);
  assert.equal(parsed.prompt, 'fix login without mention');
}

{
  const raceTask = {
    ...task,
    templateSnapshot: { ...task.templateSnapshot, strategy: 'race' },
    messages: [
      ...task.messages,
      {
        id: 'race-msg',
        taskId: task.id,
        role: 'agent',
        agentId: 'cli-codex',
        agentName: 'Codex',
        content: 'implemented',
        status: 'completed',
        cliCwd: '/tmp/cli-worktrees/codex',
        baseSha: 'abc123',
      },
    ],
  };
  const entries = mod.getRaceWorktreeEntries(raceTask, '/Users/dev/project');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].agentId, 'cli-codex');
  assert.equal(mod.isRaceTask(raceTask), true);
}

assert.equal(mod.canMutateTask({ ...task, status: 'running' }), false);
assert.equal(mod.canMutateTask({ ...task, status: 'completed' }), true);
assert.equal(
  mod.canMutateTask({
    ...task,
    status: 'completed',
    messages: [
      ...task.messages,
      {
        id: 'msg-running',
        taskId: task.id,
        role: 'agent',
        content: '',
        status: 'running',
      },
    ],
  }),
  false,
);

{
  const roundOneFailedRoundTwoCompleted = [
    { id: 'msg-user-1', taskId: task.id, role: 'user', content: '第一轮' },
    { id: 'msg-agent-1', taskId: task.id, role: 'agent', content: '失败', status: 'failed' },
    { id: 'msg-user-2', taskId: task.id, role: 'user', content: '第二轮' },
    { id: 'msg-agent-2', taskId: task.id, role: 'agent', content: '完成', status: 'completed' },
  ];
  assert.equal(mod.deriveTaskStatus(roundOneFailedRoundTwoCompleted), 'completed');

  const roundOneCompletedRoundTwoRunning = [
    { id: 'msg-user-1', taskId: task.id, role: 'user', content: '第一轮' },
    { id: 'msg-agent-1', taskId: task.id, role: 'agent', content: '完成', status: 'completed' },
    { id: 'msg-user-2', taskId: task.id, role: 'user', content: '第二轮' },
    { id: 'msg-agent-2', taskId: task.id, role: 'agent', content: '执行中', status: 'running' },
  ];
  assert.equal(mod.deriveTaskStatus(roundOneCompletedRoundTwoRunning), 'running');

  const staleRunningFromEarlierRound = [
    { id: 'msg-user-1', taskId: task.id, role: 'user', content: '第一轮' },
    { id: 'msg-agent-1', taskId: task.id, role: 'agent', content: '卡住', status: 'running' },
    { id: 'msg-user-2', taskId: task.id, role: 'user', content: '第二轮' },
    { id: 'msg-agent-2', taskId: task.id, role: 'agent', content: '完成', status: 'completed' },
  ];
  assert.equal(mod.deriveTaskStatus(staleRunningFromEarlierRound), 'completed');
  assert.equal(
    mod.canMutateTask({ ...task, status: 'completed', messages: staleRunningFromEarlierRound }),
    true,
  );

  const preflightBlockedBeforeAgentStart = [
    { id: 'msg-user-1', taskId: task.id, role: 'user', content: '执行任务' },
    { id: 'sys-preflight', taskId: task.id, role: 'system', content: 'CLI missing', isError: true, status: 'failed' },
  ];
  assert.equal(mod.deriveTaskStatus(preflightBlockedBeforeAgentStart), 'failed');
}

{
  const resolveMember = (id) => (
    id === 'cli-opencode'
      ? { kind: 'cli', cli: { adapter: 'opencode' } }
      : { kind: 'cli', cli: { adapter: 'codex' } }
  );
  const opencodeFirst = {
    ...task,
    messages: [
      ...task.messages,
      {
        id: 'msg-opencode',
        taskId: task.id,
        role: 'agent',
        agentId: 'cli-opencode',
        content: 'done',
        status: 'completed',
      },
    ],
  };
  const codexFirst = {
    ...task,
    messages: [
      ...task.messages,
      {
        id: 'msg-codex',
        taskId: task.id,
        role: 'agent',
        agentId: 'cli-codex',
        content: 'done',
        status: 'completed',
      },
      {
        id: 'msg-opencode',
        taskId: task.id,
        role: 'agent',
        agentId: 'cli-opencode',
        content: 'done',
        status: 'completed',
      },
    ],
  };
  assert.equal(mod.shouldSyncOpenCodeTaskTitle(opencodeFirst, 'cli-opencode', resolveMember), true);
  assert.equal(mod.shouldSyncOpenCodeTaskTitle(codexFirst, 'cli-opencode', resolveMember), false);
  assert.equal(
    mod.shouldSyncOpenCodeTaskTitle({ ...opencodeFirst, titleSource: 'manual' }, 'cli-opencode', resolveMember),
    false,
  );
  assert.equal(
    mod.shouldSyncOpenCodeTaskTitle(codexFirst, 'cli-opencode', resolveMember, { openCodeLedThisRun: true }),
    true,
  );

  const codexFailedThenOpenCode = {
    ...task,
    messages: [
      ...task.messages,
      {
        id: 'msg-codex-failed',
        taskId: task.id,
        role: 'agent',
        agentId: 'cli-codex',
        content: '[错误: not installed]',
        status: 'failed',
      },
      {
        id: 'msg-opencode',
        taskId: task.id,
        role: 'agent',
        agentId: 'cli-opencode',
        content: 'done',
        status: 'completed',
      },
    ],
  };
  assert.equal(mod.shouldSyncOpenCodeTaskTitle(codexFailedThenOpenCode, 'cli-opencode', resolveMember), true);
  assert.equal(mod.isPlaceholderOpenCodeTitle('New session - 2026-05-25T23:06:02.246Z'), true);
  assert.equal(mod.normalizeOpenCodeSessionTitle('  修复登录页校验  '), '修复登录页校验');
}

{
  const task = {
    id: 'devtask-1',
    title: mod.truncateTaskTitle('修复登录页面的验证码校验逻辑'),
    prompt: '修复登录页面的验证码校验逻辑',
    status: 'queued',
    templateId: 'tmpl-1',
    templateSnapshot: { id: 'tmpl-1', name: '默认', memberIds: [], strategy: 'sequential' },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    agentTaskIds: [],
    messages: [],
  };

  assert.equal(mod.needsTaskTitleSummary(task), true);
  assert.equal(
    mod.needsTaskTitleSummary({ ...task, title: '修复登录页验证码', titleSource: 'auto' }),
    false,
  );
  assert.equal(
    mod.needsTaskTitleSummary({ ...task, title: '修复登录页验证码', titleSource: 'manual' }),
    false,
  );
}
