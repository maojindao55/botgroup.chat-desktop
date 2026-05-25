import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CLIDevelopmentTask, CLITaskMessage, CLITeamTemplate } from '@/config/cliTasks';
import {
  createDevelopmentTask,
  deriveTaskStatus,
  cliGroupToTeamTemplate,
  canMutateTask,
} from '@/config/cliTasks';
import type { CLIGroup } from '@/config/groups';

interface CLITaskStore {
  tasks: CLIDevelopmentTask[];
  loadFromGroups: (groups: CLIGroup[]) => void;
  createTask: (params: {
    prompt: string;
    template: CLITeamTemplate;
    workspacePath?: string;
  }) => CLIDevelopmentTask;
  updateTask: (taskId: string, patch: Partial<CLIDevelopmentTask>) => void;
  appendMessage: (taskId: string, message: CLITaskMessage) => void;
  updateMessage: (taskId: string, messageId: string, patch: Partial<CLITaskMessage>) => void;
  getTask: (taskId: string) => CLIDevelopmentTask | undefined;
  syncTaskStatus: (taskId: string) => void;
  archiveTask: (taskId: string) => boolean;
  restoreTask: (taskId: string) => boolean;
  deleteTask: (taskId: string) => boolean;
}

export const useCLITaskStore = create<CLITaskStore>()(
  persist(
    (set, get) => ({
      tasks: [],

      loadFromGroups: (_groups) => {
        // Phase 1: templates come from CLIGroup; tasks stay in local store.
      },

      createTask: (params) => {
        const task = createDevelopmentTask(params);
        set(state => ({ tasks: [task, ...state.tasks] }));
        return task;
      },

      updateTask: (taskId, patch) => {
        set(state => ({
          tasks: state.tasks.map(t =>
            t.id === taskId
              ? { ...t, ...patch, updatedAt: new Date().toISOString() }
              : t,
          ),
        }));
      },

      appendMessage: (taskId, message) => {
        set(state => ({
          tasks: state.tasks.map(t => {
            if (t.id !== taskId) return t;
            const messages = [...t.messages, message];
            return {
              ...t,
              messages,
              status: deriveTaskStatus(messages),
              updatedAt: new Date().toISOString(),
            };
          }),
        }));
      },

      updateMessage: (taskId, messageId, patch) => {
        set(state => ({
          tasks: state.tasks.map(t => {
            if (t.id !== taskId) return t;
            const messages = t.messages.map(m =>
              m.id === messageId ? { ...m, ...patch } : m,
            );
            return {
              ...t,
              messages,
              status: deriveTaskStatus(messages),
              updatedAt: new Date().toISOString(),
            };
          }),
        }));
      },

      getTask: (taskId) => get().tasks.find(t => t.id === taskId),

      syncTaskStatus: (taskId) => {
        const task = get().getTask(taskId);
        if (!task) return;
        const status = deriveTaskStatus(task.messages);
        get().updateTask(taskId, { status });
      },

      archiveTask: (taskId) => {
        const task = get().getTask(taskId);
        if (!task || !canMutateTask(task)) return false;
        get().updateTask(taskId, { status: 'archived' });
        return true;
      },

      restoreTask: (taskId) => {
        const task = get().getTask(taskId);
        if (!task || task.status !== 'archived') return false;
        const status = deriveTaskStatus(task.messages);
        get().updateTask(taskId, { status });
        return true;
      },

      deleteTask: (taskId) => {
        const task = get().getTask(taskId);
        if (!task || !canMutateTask(task)) return false;
        set(state => ({ tasks: state.tasks.filter(t => t.id !== taskId) }));
        return true;
      },
    }),
    {
      name: 'cli_development_tasks',
      partialize: (state) => ({ tasks: state.tasks }),
    },
  ),
);

export function getTeamTemplatesFromGroups(groups: CLIGroup[]): CLITeamTemplate[] {
  return groups.map(cliGroupToTeamTemplate);
}

export function taskMessageToChatRow(
  msg: CLITaskMessage,
  userName: string,
): {
  id: string;
  sender: { id: string; name: string; avatar?: string };
  content: string;
  isAI: boolean;
  isError?: boolean;
  taskId?: string;
  status?: string;
  prompt?: string;
  stageLabel?: string;
  cliCwd?: string;
  cliBranch?: string;
  baseSha?: string;
  adopted?: boolean;
} {
  if (msg.role === 'user') {
    return {
      id: msg.id,
      sender: { id: 'user', name: userName },
      content: msg.content,
      isAI: false,
    };
  }
  return {
    id: msg.id,
    sender: {
      id: msg.agentId || 'sys',
      name: msg.agentName || '系统',
    },
    content: msg.content,
    isAI: true,
    isError: msg.isError,
    taskId: msg.agentTaskId,
    status: msg.status,
    prompt: msg.prompt,
    stageLabel: msg.stageLabel,
    cliCwd: msg.cliCwd,
    cliBranch: msg.cliBranch,
    baseSha: msg.baseSha,
    adopted: msg.adopted,
  };
}
