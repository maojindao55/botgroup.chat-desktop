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

const mod = await importTsModule(new URL('./cliTasks.ts', import.meta.url));
const sessions = await importTsModule(new URL('../engine/cliToolSessions.ts', import.meta.url));

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
assert.equal(mod.cliGroupToTeamTemplate({ ...sampleGroup, sessionPolicy: 'workspace' }).sessionPolicy, 'workspace');
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
