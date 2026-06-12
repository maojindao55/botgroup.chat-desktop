import type { CLIGroup, CLIStrategy, CLIExecutionPlan, CLISessionPolicy, CLIReviewLoopRoles, CLICustomWorkflow } from './groups';
import { adapterUsesOpenCodeSessionTitle } from './cliAdapters';
import { applyExecutorDefaultsToCliConfig } from '@/store/cliExecutorStore';
import i18n from '@/i18n';

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
    description: '同一 Workspace 与开发成员下的所有任务共享 CLI 会话。',
  },
  {
    value: 'template',
    label: '按模板共享',
    description: '使用同一团队模板创建的所有任务共享 CLI 会话，上下文隔离最弱。',
  },
];

export function sessionPolicyLabel(policy: CLISessionPolicy): string {
  const item = cliSessionPolicyOptions.find((entry) => entry.value === policy);
  return i18n.t(`product:cliSessionPolicy.${policy}.label`, {
    defaultValue: item?.label ?? policy,
  });
}

/** 解析输入开头的 @开发成员，用于指定单个 agent 执行任务 */
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
  workflowTemplateId?: string;
  executionPlan?: Partial<CLIExecutionPlan>;
  sessionPolicy: CLISessionPolicy;
  reviewLoopRoles?: CLIReviewLoopRoles;
  customWorkflow?: CLICustomWorkflow;
}

export interface CLITaskMemberSnapshot {
  id: string;
  name: string;
  avatar?: string;
  tags?: string[];
  modelHint?: string;
  cli: {
    adapter: string;
    binary?: string;
    extraArgs?: string[];
    env?: Record<string, string>;
    approvalMode?: 'auto' | 'ask';
    showStderr?: boolean;
    wsl?: boolean;
    wslDistro?: string;
  };
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

export type CLITaskTitleSource = 'auto' | 'manual';

export interface CLIDevelopmentTask {
  id: string;
  title: string;
  /** 标题来源；manual 时不被 OpenCode session 标题覆盖 */
  titleSource?: CLITaskTitleSource;
  prompt: string;
  status: CLITaskStatus;
  templateId: string;
  templateSnapshot: CLITeamTemplate;
  workspacePath: string;
  createdAt: string;
  updatedAt: string;
  agentTaskIds: string[];
  /** 创建任务时的 CLI 成员运行配置快照；旧任务可为空并回退到当前成员配置 */
  memberSnapshots?: CLITaskMemberSnapshot[];
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
    workflowTemplateId: group.workflowTemplateId,
    executionPlan: group.executionPlan,
    sessionPolicy: group.sessionPolicy ?? DEFAULT_SESSION_POLICY,
    reviewLoopRoles: group.reviewLoopRoles,
    customWorkflow: group.customWorkflow,
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
    workflowTemplateId: template.workflowTemplateId,
    executionPlan: template.executionPlan,
    reviewLoopRoles: template.reviewLoopRoles,
    customWorkflow: template.customWorkflow,
  };
}

export function truncateTaskTitle(prompt: string, maxLen = 48): string {
  const line = prompt.trim().split('\n')[0]
    || i18n.t('cli:tasks.defaultTitle', { defaultValue: '新开发任务' });
  if (line.length <= maxLen) return line;
  return `${line.slice(0, maxLen - 1)}…`;
}

/** 任务标题是否仍是 prompt 截断占位、尚未完成自动总结 */
export function needsTaskTitleSummary(task: CLIDevelopmentTask): boolean {
  if (task.titleSource === 'manual') return false;
  const autoTitle = truncateTaskTitle(task.prompt);
  if (task.title === autoTitle) return true;
  return task.titleSource !== 'auto';
}

export function getFirstAgentMessage(task: CLIDevelopmentTask): CLITaskMessage | undefined {
  return task.messages.find(message => message.role === 'agent');
}

/** 第一个有效发言的 agent（跳过失败/取消/超时） */
export function getFirstSpeakingAgentMessage(task: CLIDevelopmentTask): CLITaskMessage | undefined {
  return task.messages.find(message => {
    if (message.role !== 'agent') return false;
    if (message.status === 'failed' || message.status === 'cancelled' || message.status === 'timeout') {
      return false;
    }
    return true;
  });
}

/** 是否 OpenCode CLI 成员 */
export function isOpenCodeCliAgent(
  agentId: string,
  resolveMember: (agentId: string) => { kind?: string; cli?: { adapter?: string } } | undefined,
): boolean {
  const member = resolveMember(agentId);
  return member?.kind === 'cli' && adapterUsesOpenCodeSessionTitle(member.cli?.adapter);
}

/**
 * 是否应使用 OpenCode session 标题更新任务名：
 * - 用户未手动改过标题
 * - 该 OpenCode agent 是任务里第一个发言的 agent
 */
export function shouldSyncOpenCodeTaskTitle(
  task: CLIDevelopmentTask,
  agentId: string,
  resolveMember: (agentId: string) => { kind?: string; cli?: { adapter?: string } } | undefined,
  options?: { openCodeLedThisRun?: boolean },
): boolean {
  if (task.titleSource === 'manual') return false;
  if (!isOpenCodeCliAgent(agentId, resolveMember)) return false;
  if (options?.openCodeLedThisRun) return true;
  const firstAgent = getFirstSpeakingAgentMessage(task);
  return firstAgent?.agentId === agentId;
}

const OPENCODE_DEFAULT_TITLE_PREFIX = 'New session -';

export function isPlaceholderOpenCodeTitle(title: string): boolean {
  const trimmed = title.trim();
  if (!trimmed) return true;
  if (trimmed.startsWith(OPENCODE_DEFAULT_TITLE_PREFIX)) return true;
  return false;
}

export function normalizeOpenCodeSessionTitle(title: string): string | null {
  const trimmed = title.trim();
  if (!trimmed || isPlaceholderOpenCodeTitle(trimmed)) return null;
  return trimmed;
}

function normalizeCliModelValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.startsWith('-')) return undefined;
  return trimmed;
}

export function inferCliModelFromArgs(extraArgs?: string[] | null): string | undefined {
  if (!extraArgs?.length) return undefined;
  for (let index = 0; index < extraArgs.length; index += 1) {
    const arg = extraArgs[index]?.trim();
    if (!arg) continue;
    if (arg === '--model' || arg === '-m') {
      const value = normalizeCliModelValue(extraArgs[index + 1]);
      if (value) return value;
      continue;
    }
    if (arg.startsWith('--model=')) {
      const value = normalizeCliModelValue(arg.slice('--model='.length));
      if (value) return value;
      continue;
    }
    if (arg.startsWith('-m=')) {
      const value = normalizeCliModelValue(arg.slice('-m='.length));
      if (value) return value;
    }
  }
  return undefined;
}

export function createCLITaskMemberSnapshots(
  members: Array<{
    id?: string;
    kind?: string;
    name?: string;
    avatar?: string;
    tags?: string[];
    cli?: {
      adapter?: string;
      binary?: string;
      extraArgs?: string[];
      env?: Record<string, string>;
      approvalMode?: 'auto' | 'ask';
      showStderr?: boolean;
      wsl?: boolean;
      wslDistro?: string;
    };
  } | null | undefined>,
): CLITaskMemberSnapshot[] {
  return members
    .filter((member): member is NonNullable<typeof member> => !!member && member.kind === 'cli' && !!member.cli?.adapter && !!member.id && !!member.name)
    .map((member) => {
      const cli = applyExecutorDefaultsToCliConfig(member.cli!);
      return {
        id: member.id as string,
        name: member.name as string,
        avatar: member.avatar,
        tags: member.tags ? [...member.tags] : undefined,
        modelHint: inferCliModelFromArgs(cli.extraArgs),
        cli: {
          adapter: cli.adapter as string,
          binary: cli.binary,
          extraArgs: cli.extraArgs ? [...cli.extraArgs] : undefined,
          env: cli.env ? { ...cli.env } : undefined,
          approvalMode: cli.approvalMode,
          showStderr: cli.showStderr,
          wsl: cli.wsl,
          wslDistro: cli.wslDistro,
        },
      };
    });
}

export function cloneCLITaskMemberSnapshots(
  snapshots: CLITaskMemberSnapshot[] | undefined,
): CLITaskMemberSnapshot[] | undefined {
  if (!snapshots) return undefined;
  return snapshots.map((snapshot) => ({
    ...snapshot,
    tags: snapshot.tags ? [...snapshot.tags] : undefined,
    cli: {
      ...snapshot.cli,
      modelHint: snapshot.modelHint,
      extraArgs: snapshot.cli.extraArgs ? [...snapshot.cli.extraArgs] : undefined,
      env: snapshot.cli.env ? { ...snapshot.cli.env } : undefined,
    },
  }));
}

export function cliTaskMemberSnapshotToAgent(snapshot: CLITaskMemberSnapshot) {
  return {
    id: snapshot.id,
    name: snapshot.name,
    personality: `${snapshot.id}-cli`,
    model: 'qwen-plus',
    avatar: snapshot.avatar,
    custom_prompt: '',
    tags: snapshot.tags,
    runtime: 'cli' as const,
    cli: {
      ...snapshot.cli,
      extraArgs: snapshot.cli.extraArgs ? [...snapshot.cli.extraArgs] : undefined,
      env: snapshot.cli.env ? { ...snapshot.cli.env } : undefined,
    },
  };
}

export function createDevelopmentTask(params: {
  prompt: string;
  template: CLITeamTemplate;
  workspacePath?: string;
  title?: string;
  memberSnapshots?: CLITaskMemberSnapshot[];
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
    memberSnapshots: cloneCLITaskMemberSnapshots(params.memberSnapshots),
    messages: [userMsg],
  };
}

function getLatestRoundMessages(
  messages: CLITaskMessage[],
  predicate: (message: CLITaskMessage) => boolean,
): CLITaskMessage[] {
  let lastUserIndex = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === 'user') {
      lastUserIndex = i;
      break;
    }
  }
  if (lastUserIndex < 0) {
    return messages.filter(predicate);
  }
  return messages.slice(lastUserIndex + 1).filter(predicate);
}

/** 取最后一次用户消息之后的 agent 回复（最新一轮对话） */
export function getLatestAgentRoundMessages(messages: CLITaskMessage[]): CLITaskMessage[] {
  return getLatestRoundMessages(messages, message => message.role === 'agent');
}

/** 取最后一次用户消息之后会影响任务状态的消息（最新一轮对话） */
export function getLatestStatusRoundMessages(messages: CLITaskMessage[]): CLITaskMessage[] {
  return getLatestRoundMessages(
    messages,
    message => message.role === 'agent' || (message.role === 'system' && !!message.status),
  );
}

function deriveAgentRoundStatus(agentMsgs: CLITaskMessage[]): CLITaskStatus {
  if (agentMsgs.length === 0) return 'queued';
  if (agentMsgs.some(message => message.status === 'running')) return 'running';
  if (agentMsgs.some(message => message.status === 'failed' || message.status === 'timeout')) return 'failed';
  if (agentMsgs.every(message => message.status === 'completed' || message.status === 'cancelled')) {
    const last = agentMsgs[agentMsgs.length - 1];
    if (last?.status === 'cancelled') return 'cancelled';
    return 'completed';
  }
  return 'running';
}

export function deriveTaskStatus(messages: CLITaskMessage[]): CLITaskStatus {
  return deriveAgentRoundStatus(getLatestStatusRoundMessages(messages));
}

/** 侧栏/列表展示用状态：归档保留，其余按最新一轮状态消息推导 */
export function getTaskDisplayStatus(task: CLIDevelopmentTask): CLITaskStatus {
  if (task.status === 'archived') return 'archived';
  return deriveTaskStatus(task.messages);
}

/** 确保两个任务的 messages 数组互不影响（深拷贝快照） */
export function cloneTaskMessages(messages: CLITaskMessage[]): CLITaskMessage[] {
  return messages.map(m => ({ ...m }));
}

export type CLIRaceWorktreeEntry = {
  messageId: string;
  agentId?: string;
  agentName?: string;
  status?: CLITaskStatus;
  cliCwd: string;
  cliBranch?: string;
  baseSha?: string;
  adopted?: boolean;
  contentPreview: string;
};

export function isRaceTask(task: CLIDevelopmentTask): boolean {
  return task.templateSnapshot.strategy === 'race';
}

/** 从任务消息中提取 race 模式的独立 worktree 结果（按路径去重） */
export function getRaceWorktreeEntries(
  task: CLIDevelopmentTask,
  mainWorkspace?: string,
): CLIRaceWorktreeEntry[] {
  const seen = new Set<string>();
  const entries: CLIRaceWorktreeEntry[] = [];

  for (const message of task.messages) {
    if (message.role !== 'agent' || !message.cliCwd) continue;
    if (mainWorkspace && message.cliCwd === mainWorkspace) continue;
    if (seen.has(message.cliCwd)) continue;
    seen.add(message.cliCwd);

    entries.push({
      messageId: message.id,
      agentId: message.agentId,
      agentName: message.agentName,
      status: message.status,
      cliCwd: message.cliCwd,
      cliBranch: message.cliBranch,
      baseSha: message.baseSha,
      adopted: message.adopted,
      contentPreview: message.content.slice(0, 160),
    });
  }

  return entries;
}

export type CLITaskListFilter = {
  search?: string;
  status?: CLITaskStatus | 'all';
  templateId?: string;
  workspacePath?: string;
  agentId?: string;
  showArchived?: boolean;
};

/** 任务是否与某开发成员相关（模板成员或实际参与过） */
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
    if (filter.status && filter.status !== 'all' && getTaskDisplayStatus(task) !== filter.status) return false;
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
  if (task.status === 'running') return false;
  const latestAgents = getLatestAgentRoundMessages(task.messages);
  return !latestAgents.some(message => message.status === 'running');
}
