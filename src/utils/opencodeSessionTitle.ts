import type { CLIDevelopmentTask } from '@/config/cliTasks';
import {
  shouldSyncOpenCodeTaskTitle,
  normalizeOpenCodeSessionTitle,
  truncateTaskTitle,
  isPlaceholderOpenCodeTitle,
  needsTaskTitleSummary,
} from '@/config/cliTasks';
import { request } from '@/utils/request';
import { llmChatComplete } from '@/utils/llmClient';
import { resolveLlmCredentials } from '@/utils/resolveLlmCredentials';
import { useAIMemberStore } from '@/store/aiMemberStore';
import { useProviderStore } from '@/store/providerStore';
import { buildTitleModelCandidates } from '@/utils/cliTaskTitleCandidates';

const POLL_DELAYS_MS = [0, 2000, 4000, 8000, 15000, 25000];

export { isPlaceholderOpenCodeTitle, normalizeOpenCodeSessionTitle } from '@/config/cliTasks';

const scheduledKeys = new Set<string>();

export async function fetchOpenCodeSessionTitle(sessionId: string): Promise<string | null> {
  const response = await request('/api/cli/opencode/session-title', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  });

  if (!response.ok) return null;

  let payload: { success?: boolean; data?: { title?: string | null } } | null = null;
  try {
    payload = await response.json();
  } catch {
    return null;
  }

  if (!payload?.success) return null;

  const title = payload.data?.title;
  if (typeof title !== 'string') return null;
  return normalizeOpenCodeSessionTitle(title);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** 轮询 OpenCode export，等待 hidden title agent 生成非占位标题 */
export async function fetchOpenCodeSessionTitleWithRetry(sessionId: string): Promise<string | null> {
  for (const delay of POLL_DELAYS_MS) {
    if (delay > 0) await sleep(delay);
    const title = await fetchOpenCodeSessionTitle(sessionId);
    if (title) return title;
  }
  return null;
}

async function tryGenerateTaskTitle(prompt: string, model: string, providerId?: string): Promise<string | null> {
  try {
    const creds = await resolveLlmCredentials(model, providerId);
    const text = await llmChatComplete({
      ...creds,
      messages: [
        {
          role: 'system',
          content: '根据用户的开发任务描述，生成一条简洁的中文任务标题（不超过24字）。只输出标题文本，不要引号或解释。',
        },
        { role: 'user', content: prompt.trim().slice(0, 800) },
      ],
    });
    const line = text.trim().split('\n')[0]?.replace(/^["'「『]+|["'」』]+$/g, '').trim();
    return line ? truncateTaskTitle(line, 48) : null;
  } catch {
    return null;
  }
}

async function generateTaskTitleFromAvailableProviders(prompt: string): Promise<string | null> {
  const store = useProviderStore.getState();
  await store.load();
  const latestStore = useProviderStore.getState();
  const candidates = buildTitleModelCandidates(Object.values(latestStore.providers));

  for (const { model, providerId } of candidates) {
    let ready = false;
    try {
      ready = await useProviderStore.getState().ensureSecret(providerId);
    } catch {
      ready = false;
    }
    if (!ready) continue;
    const title = await tryGenerateTaskTitle(prompt, model, providerId);
    if (title) return title;
  }
  return null;
}

export type ScheduleOpenCodeTaskTitleSyncParams = {
  taskId: string;
  agentId: string;
  sessionId: string;
  openCodeLedThisRun?: boolean;
  getTask: () => CLIDevelopmentTask | undefined;
  resolveMember?: (agentId: string) => { kind?: string; cli?: { adapter?: string } } | undefined;
  updateTask: (taskId: string, patch: Partial<CLIDevelopmentTask>) => void;
};

export type ScheduleCLITaskTitleSyncParams = {
  taskId: string;
  prompt?: string;
  sessionId?: string;
  getTask: () => CLIDevelopmentTask | undefined;
  updateTask: (taskId: string, patch: Partial<CLIDevelopmentTask>) => void;
};

function resolveMemberFromStore(agentId: string) {
  return useAIMemberStore.getState().members[agentId];
}

/**
 * 任务结束后异步拉取 OpenCode session 标题并写回任务。
 * 仅当 OpenCode 是该任务第一个发言的 agent 时触发。
 */
export function scheduleOpenCodeTaskTitleSync(params: ScheduleOpenCodeTaskTitleSyncParams): void {
  const {
    taskId,
    agentId,
    sessionId,
    openCodeLedThisRun,
    getTask,
    updateTask,
  } = params;
  const resolveMember = params.resolveMember ?? resolveMemberFromStore;

  const dedupeKey = `${taskId}:${sessionId}`;
  if (scheduledKeys.has(dedupeKey)) return;
  scheduledKeys.add(dedupeKey);

  void (async () => {
    const task = getTask();
    if (!task || !shouldSyncOpenCodeTaskTitle(task, agentId, resolveMember, { openCodeLedThisRun })) {
      scheduledKeys.delete(dedupeKey);
      return;
    }

    const autoTitle = truncateTaskTitle(task.prompt);
    let title = await fetchOpenCodeSessionTitleWithRetry(sessionId);
    if (!title || title === autoTitle || isPlaceholderOpenCodeTitle(title)) {
      title = await generateTaskTitleFromAvailableProviders(task.prompt);
    }
    if (!title) {
      scheduledKeys.delete(dedupeKey);
      return;
    }

    const latest = getTask();
    if (!latest || !shouldSyncOpenCodeTaskTitle(latest, agentId, resolveMember, { openCodeLedThisRun })) {
      scheduledKeys.delete(dedupeKey);
      return;
    }
    if (!needsTaskTitleSummary(latest)) {
      scheduledKeys.delete(dedupeKey);
      return;
    }
    if (title === latest.title) {
      scheduledKeys.delete(dedupeKey);
      return;
    }

    updateTask(taskId, {
      title,
      titleSource: 'auto',
    });
    scheduledKeys.delete(dedupeKey);
  })();
}

/**
 * 新建 CLI 任务后异步生成任务标题。主路径使用已配置 Provider 中可用的 LLM；
 * 若传入 OpenCode sessionId，只在标题仍是默认截断标题时尝试使用 session title。
 */
export function scheduleCLITaskTitleSync(params: ScheduleCLITaskTitleSyncParams): void {
  const { taskId, prompt, sessionId, getTask, updateTask } = params;
  const dedupeKey = `${taskId}:cli-task-title:${sessionId || 'llm'}`;
  if (scheduledKeys.has(dedupeKey)) return;
  scheduledKeys.add(dedupeKey);

  void (async () => {
    const task = getTask();
    if (!task || task.titleSource === 'manual') {
      scheduledKeys.delete(dedupeKey);
      return;
    }

    const sourcePrompt = prompt || task.prompt;
    const autoTitle = truncateTaskTitle(sourcePrompt);
    let title: string | null = null;

    if (sessionId && task.title === autoTitle) {
      title = await fetchOpenCodeSessionTitleWithRetry(sessionId);
      if (title === autoTitle || (title && isPlaceholderOpenCodeTitle(title))) {
        title = null;
      }
    }

    if (!title) {
      title = await generateTaskTitleFromAvailableProviders(sourcePrompt);
    }
    if (!title) {
      scheduledKeys.delete(dedupeKey);
      return;
    }

    const latest = getTask();
    if (!latest || latest.titleSource === 'manual') {
      scheduledKeys.delete(dedupeKey);
      return;
    }
    if (!needsTaskTitleSummary(latest)) {
      scheduledKeys.delete(dedupeKey);
      return;
    }
    if (title === latest.title) {
      scheduledKeys.delete(dedupeKey);
      return;
    }

    updateTask(taskId, {
      title,
      titleSource: 'auto',
    });
    scheduledKeys.delete(dedupeKey);
  })();
}
