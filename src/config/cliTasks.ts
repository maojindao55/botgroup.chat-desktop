import type { CLIGroup, CLIStrategy, CLIExecutionPlan } from './groups';

export type CLITaskStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timeout'
  | 'archived';

export type CLISessionPolicy = 'task' | 'workspace' | 'template';

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
    sessionPolicy: DEFAULT_SESSION_POLICY,
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
