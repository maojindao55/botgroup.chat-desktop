import type { CLIGroup, CLIStrategy, CLIExecutionPlan, CLISessionPolicy } from './groups';

export type CLITaskStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timeout'
  | 'archived';

export type { CLISessionPolicy };

export const cliSessionPolicyOptions: Array<{
  value: CLISessionPolicy;
  label: string;
  description: string;
}> = [
  {
    value: 'task',
    label: '按任务隔离',
    description: '每个开发任务使用独立 CLI 会话；继续同一任务会复用该任务的会话。',
  },
  {
    value: 'workspace',
    label: '按 Workspace 共享',
    description: '同一 Workspace 与开发群友下的所有任务共享 CLI 会话。',
  },
  {
    value: 'template',
    label: '按模板共享',
    description: '使用同一团队模板创建的所有任务共享 CLI 会话，上下文隔离最弱。',
  },
];

export function sessionPolicyLabel(policy: CLISessionPolicy): string {
  return cliSessionPolicyOptions.find(item => item.value === policy)?.label ?? policy;
}

/** 解析输入开头的 @开发群友，用于指定单个 agent 执行任务 */
export function parseAgentMention(
  input: string,
  memberIds: string[],
  resolveName: (agentId: string) => string | undefined,
): { agentId?: string; prompt: string; raw: string } {
  const raw = input.trim();
  const match = raw.match(/^@([^\s@]+)(?:\s+([\s\S]*))?$/);
  if (!match) return { prompt: raw, raw };

  const token = match[1].toLowerCase();
  const rest = (match[2] ?? '').trim();
  if (!rest) return { prompt: raw, raw };

  for (const id of memberIds) {
    const name = resolveName(id) || '';
    const candidates = [id, id.replace(/^cli-/, ''), name]
      .filter(Boolean)
      .map(value => value.toLowerCase());
    if (candidates.some(candidate => candidate === token || candidate.startsWith(token))) {
      return { agentId: id, prompt: rest, raw };
    }
  }

  return { prompt: raw, raw };
}

export interface CLITeamTemplate {
  id: string;
  name: string;
  description: string;
  memberIds: string[];
  workspacePath?: string;
  approvalMode: 'auto' | 'ask';
  timeout: number;
  showStderr: boolean;
  strategy: CLIStrategy;
  executionPlan?: Partial<CLIExecutionPlan>;
  sessionPolicy: CLISessionPolicy;
}

export interface CLITaskMessage {
  id: string;
  taskId: string;
  role: 'user' | 'agent' | 'system';
  agentId?: string;
  agentName?: string;
  content: string;
  status?: CLITaskStatus;
  cliCwd?: string;
  cliBranch?: string;
  baseSha?: string;
  toolSessionId?: string;
  /** 关联的后端 CLI 执行 task ID */
  agentTaskId?: string;
  prompt?: string;
  stageLabel?: string;
  isError?: boolean;
  /** Race worktree 结果是否被用户标记采纳 */
  adopted?: boolean;
}

export interface CLIDevelopmentTask {
  id: string;
  title: string;
  prompt: string;
  status: CLITaskStatus;
  templateId: string;
  templateSnapshot: CLITeamTemplate;
  workspacePath: string;
  createdAt: string;
  updatedAt: string;
  agentTaskIds: string[];
  messages: CLITaskMessage[];
}

const DEFAULT_SESSION_POLICY: CLISessionPolicy = 'task';

/** 将现有 CLIGroup 转为团队模板（Phase 1 兼容层） */
export function cliGroupToTeamTemplate(group: CLIGroup): CLITeamTemplate {
  return {
    id: group.id,
    name: group.name,
    description: group.description,
    memberIds: group.memberIds || group.members || [],
    workspacePath: group.workspacePath || undefined,
    approvalMode: group.approvalMode || 'auto',
    timeout: group.timeout ?? 300000,
    showStderr: group.showStderr !== false,
    strategy: group.strategy || 'sequential',
    executionPlan: group.executionPlan,
    sessionPolicy: group.sessionPolicy ?? DEFAULT_SESSION_POLICY,
  };
}

/** 从模板快照构建执行用的 CLIGroup（保持 executeCLIStrategy 兼容） */
export function templateSnapshotToCLIGroup(template: CLITeamTemplate): CLIGroup {
  return {
    id: template.id,
    type: 'cli',
    name: template.name,
    description: template.description,
    memberIds: template.memberIds,
    workspacePath: template.workspacePath || '',
    approvalMode: template.approvalMode,
    timeout: template.timeout,
    showStderr: template.showStderr,
    strategy: template.strategy,
    executionPlan: template.executionPlan,
  };
}

export function truncateTaskTitle(prompt: string, maxLen = 48): string {
  const line = prompt.trim().split('\n')[0] || '新开发任务';
  if (line.length <= maxLen) return line;
  return `${line.slice(0, maxLen - 1)}…`;
}

export function createDevelopmentTask(params: {
  prompt: string;
  template: CLITeamTemplate;
  workspacePath?: string;
  title?: string;
}): CLIDevelopmentTask {
  const now = new Date().toISOString();
  const unique = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const id = `devtask-${unique}`;
  const workspacePath = params.workspacePath ?? params.template.workspacePath ?? '';
  const userMsg: CLITaskMessage = {
    id: `msg-${unique}-user`,
    taskId: id,
    role: 'user',
    content: params.prompt,
  };

  return {
    id,
    title: params.title || truncateTaskTitle(params.prompt),
    prompt: params.prompt,
    status: 'queued',
    templateId: params.template.id,
    templateSnapshot: { ...params.template },
    workspacePath,
    createdAt: now,
    updatedAt: now,
    agentTaskIds: [],
    messages: [userMsg],
  };
}

export function deriveTaskStatus(messages: CLITaskMessage[]): CLITaskStatus {
  const agentMsgs = messages.filter(m => m.role === 'agent');
  if (agentMsgs.length === 0) return 'queued';
  if (agentMsgs.some(m => m.status === 'running')) return 'running';
  if (agentMsgs.some(m => m.status === 'failed' || m.status === 'timeout')) return 'failed';
  if (agentMsgs.every(m => m.status === 'completed' || m.status === 'cancelled')) {
    const last = agentMsgs[agentMsgs.length - 1];
    if (last?.status === 'cancelled') return 'cancelled';
    return 'completed';
  }
  return 'running';
}

/** 确保两个任务的 messages 数组互不影响（深拷贝快照） */
export function cloneTaskMessages(messages: CLITaskMessage[]): CLITaskMessage[] {
  return messages.map(m => ({ ...m }));
}

export type CLITaskListFilter = {
  search?: string;
  status?: CLITaskStatus | 'all';
  templateId?: string;
  workspacePath?: string;
  agentId?: string;
  showArchived?: boolean;
};

/** 任务是否与某开发群友相关（模板成员或实际参与过） */
export function taskInvolvesAgent(task: CLIDevelopmentTask, agentId: string): boolean {
  if (task.templateSnapshot.memberIds.includes(agentId)) return true;
  return task.messages.some(message => message.agentId === agentId);
}

/** 侧栏任务列表筛选 */
export function filterDevelopmentTasks(
  tasks: CLIDevelopmentTask[],
  filter: CLITaskListFilter,
): CLIDevelopmentTask[] {
  const search = filter.search?.trim().toLowerCase();
  return tasks.filter(task => {
    if (!filter.showArchived && task.status === 'archived') return false;
    if (filter.status && filter.status !== 'all' && task.status !== filter.status) return false;
    if (filter.templateId && task.templateId !== filter.templateId) return false;
    if (filter.workspacePath !== undefined && filter.workspacePath !== '' && task.workspacePath !== filter.workspacePath) {
      return false;
    }
    if (filter.agentId && !taskInvolvesAgent(task, filter.agentId)) return false;
    if (search) {
      const haystack = `${task.title}\n${task.prompt}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
}

export function canMutateTask(task: CLIDevelopmentTask): boolean {
  return task.status !== 'running' && !task.messages.some(message => message.status === 'running');
}
