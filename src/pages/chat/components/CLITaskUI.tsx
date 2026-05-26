/**
 * CLI 开发任务 UI — 以任务为主对象的聊天界面
 * Phase 1: 团队模板来自 CLIGroup，任务消息本地持久化，执行走 executeCLIStrategy
 */
import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  Send,
  PanelLeftOpen,
  Terminal,
  Info,
  GitCompare,
} from 'lucide-react';
import { Input as AntdInput, Button as AntdButton, Tag, Modal, Select, Tooltip } from 'antd';
import { ActionIcon, Avatar as LobeAvatar } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { request } from '@/utils/request';
import { executeCLIStrategy } from '@/engine/cliEngine';
import { isCodeChangeIntent } from '@/engine/cliIntent';
import { buildCliUserPrompt } from '@/engine/cliPrompt';
import { resolveCliToolSessionKey, withCliToolSession } from '@/engine/cliToolSessions';
import type { CLIAgent } from '@/config/aiCharacters';
import { mapAIMemberToLegacy } from '@/config/aiCharacters';
import { ChatMarkdown } from '@/components/Markdown';
import CLIGroupSettings from './CLIGroupSettings';
import CLITaskInfoPanel from './CLITaskInfoPanel';
import CLITemplateListPanel from './CLITemplateListPanel';
import CLIRaceResultsDrawer from './CLIRaceResultsDrawer';
import CLITaskLogModal from './CLITaskLogModal';
import CLITaskSidebar from './CLITaskSidebar';
import CreateGroupWizard from './CreateGroupWizard';
import Sidebar from './Sidebar';
import { AdBanner, AdBannerMobile } from './AdSection';
import { useUserStore } from '@/store/userStore';
import { useIsMobile } from '@/hooks/use-mobile';
import { AIMemberLibrary } from './AIMemberLibrary';
import { useAIMemberStore } from '@/store/aiMemberStore';
import { getAvatarData, resolveAvatarByName } from '@/utils/avatar';
import type { Group, CLIGroup } from '@/config/groups';
import {
  templateSnapshotToCLIGroup,
  parseAgentMention,
  isRaceTask,
  getRaceWorktreeEntries,
  type CLIDevelopmentTask,
  type CLITaskStatus,
} from '@/config/cliTasks';
import {
  useCLITaskStore,
  getTeamTemplatesFromGroups,
  taskMessageToChatRow,
} from '@/store/cliTaskStore';
import {
  scheduleCLITaskTitleSync,
  scheduleOpenCodeTaskTitleSync,
} from '@/utils/opencodeSessionTitle';
import { openPath } from '@tauri-apps/plugin-opener';
import { toast } from 'sonner';

interface CLITaskUIProps {
  groups: Group[];
  cliGroups: CLIGroup[];
  selectedGroupIndex: number;
  onSelectGroup: (index: number) => void;
  onCreateGroup?: (group: Group) => void;
  onUpdateCLIGroup?: (group: CLIGroup) => void;
  onDeleteCLIGroup?: (templateId: string) => void;
  initialTaskId?: string | null;
}

const DRAFT_COMPOSE_KEY = '__draft__';

const resolveComposeKey = (taskId: string | null) => taskId ?? DRAFT_COMPOSE_KEY;

const useStyles = createStyles(({ token, css }) => ({
  page: css`
    position: fixed;
    inset: 0;
    overflow: hidden;
    background: ${token.colorBgContainer};
    display: flex;
  `,
  container: css`
    height: 100%;
    display: flex;
    width: 100%;
    position: relative;
    overflow: hidden;
  `,
  rightCol: css`
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    position: relative;
  `,
  taskSidebarExpandHandle: css`
    position: absolute;
    left: 0;
    top: 18px;
    z-index: 5;
    transform: translateX(-50%);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 32px;
    padding: 0;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 0 8px 8px 0;
    background: ${token.colorBgContainer};
    color: ${token.colorTextSecondary};
    cursor: pointer;
    box-shadow: 1px 0 4px rgba(0, 0, 0, 0.06);
    transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
    &:hover {
      color: #ff6600;
      border-color: rgba(255, 102, 0, 0.35);
      background: rgba(255, 102, 0, 0.06);
    }
  `,
  headerBar: css`
    background: ${token.colorBgContainer};
    border-bottom: 1px solid ${token.colorBorderSecondary};
    flex: none;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
  `,
  headerInner: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
  `,
  avatarStack: css`
    display: flex;
    align-items: center;
    & > * + * {
      margin-left: -8px;
    }
  `,
  avatarMore: css`
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: ${token.colorFillSecondary};
    color: ${token.colorTextSecondary};
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 600;
    border: 2px solid ${token.colorBgContainer};
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
  `,
  chatArea: css`
    flex: 1;
    overflow: auto;
    background: ${token.colorBgLayout};
    padding: 12px 16px;
  `,
  inputArea: css`
    background: ${token.colorBgContainer};
    border-top: 1px solid ${token.colorBorderSecondary};
    padding: 12px 20px 16px;
  `,
  composeBox: css`
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 12px;
    background: ${token.colorBgContainer};
    overflow: hidden;
    transition: border-color 0.2s, box-shadow 0.2s;
    &:focus-within {
      border-color: #ff6600;
      box-shadow: 0 0 0 2px rgba(255, 102, 0, 0.12);
    }
  `,
  composeTextarea: css`
    textarea {
      border: none !important;
      box-shadow: none !important;
      resize: none;
      padding: 12px 14px 4px !important;
      background: transparent !important;
    }
  `,
  composeFooter: css`
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px 10px;
    border-top: 1px solid ${token.colorBorderSecondary};
    flex-wrap: wrap;
  `,
  composeFooterSpacer: css`
    flex: 1;
    min-width: 8px;
  `,
  composeHint: css`
    font-size: 11px;
    color: ${token.colorTextTertiary};
    line-height: 1.4;
  `,
  agentChipRow: css`
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
  `,
  agentChip: css`
    border: 1px solid ${token.colorBorderSecondary};
    background: ${token.colorFillTertiary};
    border-radius: 999px;
    padding: 2px 10px;
    font-size: 11px;
    cursor: pointer;
    color: ${token.colorTextSecondary};
    &:hover {
      border-color: #ff6600;
      color: #ff6600;
    }
  `,
  cliWorktreeInfo: css`
    margin-top: 8px;
    padding: 8px 10px;
    background: ${token.colorFillTertiary};
    border-radius: 8px;
    font-size: 11px;
    color: ${token.colorTextSecondary};
    display: flex;
    flex-direction: column;
    gap: 4px;
    word-break: break-all;
  `,
  cliWorktreePath: css`
    font-family: var(--ant-font-family-code);
    font-size: 11px;
    color: ${token.colorTextSecondary};
    word-break: break-all;
  `,
  cliWorktreeActionBtn: css`
    align-self: flex-start;
    padding: 0 8px;
    height: 22px;
    line-height: 22px;
    font-size: 11px;
    background: transparent;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 6px;
    cursor: pointer;
    &:hover {
      border-color: #ff6600;
      color: #ff6600;
    }
  `,
  bubbleUser: css`
    background: linear-gradient(to top right, #f97316, #f59e0b);
    color: #fff;
    border-radius: 16px;
    border-top-right-radius: 4px;
    padding: 12px 16px;
    margin-top: 4px;
    text-align: left;
  `,
  bubbleAI: css`
    background: ${token.colorBgContainer};
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 16px;
    border-top-left-radius: 4px;
    padding: 12px 16px;
    margin-top: 4px;
    text-align: left;
  `,
  bubbleError: css`
    background: ${token.colorErrorBg};
    border: 1px solid ${token.colorErrorBorder};
    border-radius: 16px;
    border-top-left-radius: 4px;
    padding: 12px 16px;
    margin-top: 4px;
    text-align: left;
  `,
  metaRow: css`
    font-size: 12px;
    color: ${token.colorTextTertiary};
    padding: 0 4px;
    display: flex;
    align-items: center;
    gap: 6px;
  `,
  messageList: css`
    display: flex;
    flex-direction: column;
    gap: 16px;
  `,
  messageRow: css`
    display: flex;
    align-items: flex-start;
    gap: 12px;
  `,
  emptyState: css`
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 80px 24px;
    color: ${token.colorTextTertiary};
    text-align: center;
    gap: 12px;
  `,
  cwdLabel: css`
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    opacity: 0.6;
  `,
  cwdPath: css`
    font-family: ${token.fontFamilyCode};
    font-size: 10px;
    background: ${token.colorFillTertiary};
    padding: 1px 6px;
    border-radius: 4px;
    cursor: pointer;
    max-width: 300px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  streaming: css`
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 10px;
    color: #f97316;
  `,
  streamingDot: css`
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #f97316;
    animation: pulse 1s infinite;
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
  `,
  cliTaskFooter: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid ${token.colorBorderSecondary};
    font-size: 11px;
  `,
  cliActionBtnRetry: css`
    padding: 0 6px;
    height: 18px;
    font-size: 10px;
    background: transparent;
    color: ${token.colorPrimary};
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 3px;
    cursor: pointer;
  `,
  cliActionBtnCancel: css`
    padding: 0 6px;
    height: 18px;
    font-size: 10px;
    background: transparent;
    color: #ff4d4f;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 3px;
    cursor: pointer;
  `,
  cliActionBtnLog: css`
    padding: 0 6px;
    height: 18px;
    font-size: 10px;
    background: transparent;
    color: ${token.colorTextSecondary};
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 3px;
    cursor: pointer;
  `,
  cliTaskActions: css`
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  `,
  spinnerIcon: css`
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 2px solid ${token.colorInfo};
    border-top-color: transparent;
    animation: spin 1s linear infinite;
    @keyframes spin { to { transform: rotate(360deg); } }
  `,
  mobileOverlay: css`
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 10;
    @media (min-width: 768px) { display: none; }
  `,
  desktopOnly: css`
    @media (max-width: 767px) { display: none; }
  `,
  mobileOnly: css`
    @media (min-width: 768px) { display: none; }
  `,
}));

const CLITaskUI = ({
  groups,
  cliGroups,
  selectedGroupIndex,
  onSelectGroup,
  onCreateGroup,
  onUpdateCLIGroup,
  onDeleteCLIGroup,
  initialTaskId,
}: CLITaskUIProps) => {
  const userStore = useUserStore();
  const isMobile = useIsMobile();
  const { styles, cx } = useStyles();
  const aiMembers = useAIMemberStore(s => s.members);
  const { load: loadAIMembers } = useAIMemberStore();

  const tasks = useCLITaskStore(s => s.tasks);
  const createTask = useCLITaskStore(s => s.createTask);
  const updateTask = useCLITaskStore(s => s.updateTask);
  const appendMessage = useCLITaskStore(s => s.appendMessage);
  const updateMessage = useCLITaskStore(s => s.updateMessage);
  const archiveTask = useCLITaskStore(s => s.archiveTask);
  const restoreTask = useCLITaskStore(s => s.restoreTask);
  const deleteTask = useCLITaskStore(s => s.deleteTask);

  const templates = useMemo(() => getTeamTemplatesFromGroups(cliGroups), [cliGroups]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(initialTaskId || null);
  const [selectedTemplateId, setSelectedTemplateId] = useState(templates[0]?.id || '');
  const [inputMessage, setInputMessage] = useState('');
  const [executingTaskIds, setExecutingTaskIds] = useState<Set<string>>(() => new Set());
  const [sidebarOpen, setSidebarOpen] = useState(!isMobile);
  const [taskSidebarOpen, setTaskSidebarOpen] = useState(!isMobile);
  const [taskInfoOpen, setTaskInfoOpen] = useState(false);
  const [templateSettingsOpen, setTemplateSettingsOpen] = useState(false);
  const [templateListOpen, setTemplateListOpen] = useState(false);
  const [templateSettingsReturnTo, setTemplateSettingsReturnTo] = useState<'template-list' | null>(null);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [forkModalOpen, setForkModalOpen] = useState(false);
  const [forkTemplateId, setForkTemplateId] = useState('');
  const [createTemplateOpen, setCreateTemplateOpen] = useState(false);
  const [raceDrawerOpen, setRaceDrawerOpen] = useState(false);
  const [logTarget, setLogTarget] = useState<{
    agentTaskId: string;
    messageId: string;
    agentName: string;
    adapter?: string;
    prompt?: string;
    status?: string;
  } | null>(null);
  const [showLibrary, setShowLibrary] = useState(false);
  const [showAd, setShowAd] = useState(false);
  const [mutedUsers, setMutedUsers] = useState<string[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const selectedTask = tasks.find(t => t.id === selectedTaskId) || null;
  const selectedTemplate = templates.find(t => t.id === selectedTemplateId) || templates[0];
  const draftTemplate = selectedTemplate;
  const composeKey = resolveComposeKey(selectedTaskId);
  const isComposeBusy = executingTaskIds.has(composeKey);

  const beginTaskExecution = useCallback((key: string) => {
    setExecutingTaskIds(prev => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }, []);

  const endTaskExecution = useCallback((key: string) => {
    setExecutingTaskIds(prev => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, []);

  const transferTaskExecution = useCallback((from: string, to: string) => {
    setExecutingTaskIds(prev => {
      const next = new Set(prev);
      next.delete(from);
      next.add(to);
      return next;
    });
  }, []);

  const workspacePath = selectedTask
    ? selectedTask.workspacePath
    : (draftTemplate?.workspacePath || '');
  const headerTemplateName = selectedTask
    ? selectedTask.templateSnapshot.name
    : draftTemplate?.name;

  const userName = userStore.userInfo.nickname || '我';

  const chatMessages = useMemo(() => {
    if (!selectedTask) return [];
    return selectedTask.messages.map(m => taskMessageToChatRow(m, userName));
  }, [selectedTask, userName]);

  const editingCLIGroup = editingTemplateId
    ? cliGroups.find(g => g.id === editingTemplateId) || null
    : null;
  const editingTemplateMembers = (editingCLIGroup?.memberIds || [])
    .map(id => aiMembers[id])
    .filter(m => m && m.kind === 'cli')
    .map(m => mapAIMemberToLegacy(m) as CLIAgent);

  const taskCountByTemplate = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const task of tasks) {
      counts[task.templateId] = (counts[task.templateId] || 0) + 1;
    }
    return counts;
  }, [tasks]);

  const raceEntries = useMemo(() => {
    if (!selectedTask || !isRaceTask(selectedTask)) return [];
    return getRaceWorktreeEntries(selectedTask, workspacePath);
  }, [selectedTask, workspacePath]);

  useEffect(() => { loadAIMembers(); }, [loadAIMembers]);
  useEffect(() => { if (isMobile !== undefined) { setSidebarOpen(!isMobile); setTaskSidebarOpen(!isMobile); } }, [isMobile]);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages]);

  // 仅在外部 URL 的 taskId 变化时同步选中项；tasks 更新时不应覆盖用户在侧栏的手动选择
  // （navigateToTask 用 replaceState 更新 URL，不会触发 ChatUI 重渲染，initialTaskId 可能滞后）
  const lastSyncedInitialTaskIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (initialTaskId === lastSyncedInitialTaskIdRef.current) return;
    lastSyncedInitialTaskIdRef.current = initialTaskId;
    if (initialTaskId && tasks.some(t => t.id === initialTaskId)) {
      setSelectedTaskId(initialTaskId);
    }
  }, [initialTaskId, tasks]);

  useEffect(() => {
    if (templates.length > 0 && !selectedTemplateId) {
      setSelectedTemplateId(templates[0].id);
    }
  }, [templates, selectedTemplateId]);

  const navigateToTask = (taskId: string) => {
    setSelectedTaskId(taskId);
    window.history.replaceState({}, '', `?view=cli-task&taskId=${encodeURIComponent(taskId)}`);
  };

  const navigateToList = () => {
    window.history.replaceState({}, '', '?view=cli-tasks');
  };

  const startNewTask = () => {
    setSelectedTaskId(null);
    setInputMessage('');
    navigateToList();
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  const getSessionKey = useCallback((developmentTask: CLIDevelopmentTask, agentId: string) => {
    const snapshot = developmentTask.templateSnapshot;
    const ws = developmentTask.workspacePath || snapshot.workspacePath || '';
    return resolveCliToolSessionKey({
      developmentTaskId: developmentTask.id,
      templateId: snapshot.id,
      agentId,
      workspacePath: ws,
      sessionPolicy: snapshot.sessionPolicy,
    });
  }, []);

  const runExecution = async (
    developmentTask: CLIDevelopmentTask,
    promptText: string,
    retryAgentId?: string,
  ) => {
    const snapshot = developmentTask.templateSnapshot;
    const execGroup = templateSnapshotToCLIGroup(snapshot);
    const ws = developmentTask.workspacePath || snapshot.workspacePath || '';

    const memberIds = snapshot.memberIds;
    let activeAgents = memberIds
      .map(id => aiMembers[id])
      .filter(m => m && m.kind === 'cli' && !mutedUsers.includes(m.id))
      .map(m => mapAIMemberToLegacy(m) as CLIAgent);

    if (retryAgentId) {
      activeAgents = activeAgents.filter(a => a.id === retryAgentId);
    }

    activeAgents = activeAgents.map(agent => withCliToolSession(
      agent,
      localStorage.getItem(getSessionKey(developmentTask, agent.id)),
    ));

    if (activeAgents.length === 0) {
      appendMessage(developmentTask.id, {
        id: `sys-${Date.now()}`,
        taskId: developmentTask.id,
        role: 'system',
        content: '没有启用的开发群友。请在模板设置中添加或开启成员。',
        isError: true,
      });
      return;
    }

    const taskPrompt = buildCliUserPrompt(promptText, ws);

    if (snapshot.strategy === 'discussion' && isCodeChangeIntent(promptText)) {
      appendMessage(developmentTask.id, {
        id: `sys-${Date.now()}`,
        taskId: developmentTask.id,
        role: 'system',
        content: '当前协作方式是"只读讨论"，不会修改 workspace。要写代码请切换到"写完再审"或"快速响应"模板。',
        isError: true,
      });
      return;
    }

    if (snapshot.approvalMode === 'ask') {
      const names = activeAgents.map(a => a.name).join('、');
      const confirmed = window.confirm(`确认让开发群友 ${names} 在 ${ws || '默认目录'} 协作处理这次任务？`);
      if (!confirmed) return;
    }

    updateTask(developmentTask.id, { status: 'running' });

    const customGroup: CLIGroup = {
      ...execGroup,
      strategy: snapshot.strategy,
      timeout: snapshot.timeout,
      approvalMode: snapshot.approvalMode,
      showStderr: snapshot.showStderr,
      executionPlan: snapshot.executionPlan,
      reviewLoopRoles: snapshot.reviewLoopRoles,
    };

    const messageIdByAgentTask = new Map<string, string>();
    const agentIdByAgentTask = new Map<string, string>();
    const opencodeSessionByAgentTask = new Map<string, string>();
    const openCodeLedThisRun = activeAgents.length > 0 && activeAgents[0].cli?.adapter === 'opencode';

    const flushOpenCodeTitleSync = () => {
      const seen = new Set<string>();
      const schedule = (agentId: string, sessionId: string) => {
        const key = `${agentId}:${sessionId}`;
        if (seen.has(key)) return;
        seen.add(key);
        scheduleOpenCodeTaskTitleSync({
          taskId: developmentTask.id,
          agentId,
          sessionId,
          openCodeLedThisRun,
          getTask: () => useCLITaskStore.getState().getTask(developmentTask.id),
          updateTask,
        });
      };

      for (const [agentTaskId, sessionId] of opencodeSessionByAgentTask.entries()) {
        const agentId = agentIdByAgentTask.get(agentTaskId);
        if (agentId && sessionId) schedule(agentId, sessionId);
      }

      const latestTask = useCLITaskStore.getState().getTask(developmentTask.id);
      latestTask?.messages.forEach(message => {
        if (message.agentId && message.toolSessionId) {
          schedule(message.agentId, message.toolSessionId);
        }
      });
    };

    try {
      await executeCLIStrategy(
        customGroup,
        activeAgents,
        taskPrompt,
        ws,
        {
          onAgentStart: (agentTaskId, agentId, agentName, meta) => {
            agentIdByAgentTask.set(agentTaskId, agentId);
            const agentMember = aiMembers[agentId];
            const agentInfo = agentMember?.kind === 'cli'
              ? mapAIMemberToLegacy(agentMember) as CLIAgent
              : undefined;
            const baseName = agentInfo?.name || agentName;
            const msgId = `msg-${agentTaskId}`;
            messageIdByAgentTask.set(agentTaskId, msgId);

            appendMessage(developmentTask.id, {
              id: msgId,
              taskId: developmentTask.id,
              role: 'agent',
              agentId,
              agentName: meta?.stageLabel ? `${baseName} · ${meta.stageLabel}` : baseName,
              content: '',
              status: 'running',
              agentTaskId,
              prompt: taskPrompt,
              stageLabel: meta?.stageLabel,
              cliCwd: meta?.cwd,
              cliBranch: meta?.branch,
              baseSha: meta?.baseSha,
            });

            const currentTask = useCLITaskStore.getState().getTask(developmentTask.id);
            updateTask(developmentTask.id, {
              agentTaskIds: [...(currentTask?.agentTaskIds || []), agentTaskId],
            });
          },
          onToolSession: (agentTaskId, agentId, adapter, sessionId) => {
            if (adapter === 'opencode' || adapter === 'codex' || adapter === 'claude') {
              localStorage.setItem(getSessionKey(developmentTask, agentId), sessionId);
            }
            if (adapter === 'opencode') {
              opencodeSessionByAgentTask.set(agentTaskId, sessionId);
              const msgId = messageIdByAgentTask.get(agentTaskId);
              if (msgId) {
                updateMessage(developmentTask.id, msgId, { toolSessionId: sessionId });
              }
            }
          },
          onToken: (agentTaskId, token) => {
            const msgId = messageIdByAgentTask.get(agentTaskId);
            if (!msgId) return;
            const task = useCLITaskStore.getState().getTask(developmentTask.id);
            const msg = task?.messages.find(m => m.id === msgId);
            if (msg) {
              updateMessage(developmentTask.id, msgId, { content: msg.content + token });
            }
          },
          onAgentEnd: (agentTaskId, fullContent) => {
            const msgId = messageIdByAgentTask.get(agentTaskId);
            if (!msgId) return;
            let finalContent = fullContent;
            if (finalContent.includes('<details open>')) {
              finalContent = finalContent.replace(/<details open>/g, '<details>');
            }
            updateMessage(developmentTask.id, msgId, {
              content: finalContent,
              status: 'completed',
            });
          },
          onError: (agentTaskId, error) => {
            const msgId = messageIdByAgentTask.get(agentTaskId);
            if (!msgId) return;
            const task = useCLITaskStore.getState().getTask(developmentTask.id);
            const msg = task?.messages.find(m => m.id === msgId);
            const normalized = String(error || '').toLowerCase();
            const status = normalized.includes('timeout')
              ? 'timeout' as const
              : normalized.includes('cancel')
                ? 'cancelled' as const
                : 'failed' as const;
            updateMessage(developmentTask.id, msgId, {
              content: msg?.content ? msg.content + `\n\n[错误: ${error}]` : `[错误: ${error}]`,
              status,
              isError: true,
            });
          },
        },
        {
          timeoutMs: snapshot.timeout,
          approvalMode: snapshot.approvalMode,
          showStderr: snapshot.showStderr,
        },
      );
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      appendMessage(developmentTask.id, {
        id: `sys-${Date.now()}`,
        taskId: developmentTask.id,
        role: 'system',
        content: `❌ 任务执行未启动：${errMsg}`,
        isError: true,
      });
    } finally {
      flushOpenCodeTitleSync();
      useCLITaskStore.getState().syncTaskStatus(developmentTask.id);
    }
  };

  const handleSendMessage = async () => {
    if (isComposeBusy || !inputMessage.trim()) return;
    const liveTemplate = draftTemplate;
    if (!liveTemplate && !selectedTask) return;

    const rawInput = inputMessage.trim();
    const memberIds = selectedTask?.templateSnapshot.memberIds ?? liveTemplate?.memberIds ?? [];
    const parsed = parseAgentMention(rawInput, memberIds, id => aiMembers[id]?.name);
    const executionPrompt = parsed.prompt;
    const targetAgentId = parsed.agentId;

    setInputMessage('');

    let activeScope = composeKey;
    beginTaskExecution(activeScope);

    try {
      let task = selectedTask;

      if (!task) {
        if (!liveTemplate) return;
        task = createTask({
          prompt: rawInput,
          template: liveTemplate,
          workspacePath: liveTemplate.workspacePath,
        });
        const createdTaskId = task.id;
        scheduleCLITaskTitleSync({
          taskId: createdTaskId,
          prompt: rawInput,
          getTask: () => useCLITaskStore.getState().getTask(createdTaskId),
          updateTask,
        });
        if (activeScope === DRAFT_COMPOSE_KEY) {
          transferTaskExecution(DRAFT_COMPOSE_KEY, task.id);
          activeScope = task.id;
        }
        navigateToTask(task.id);
      } else {
        appendMessage(task.id, {
          id: `msg-${Date.now()}-user`,
          taskId: task.id,
          role: 'user',
          content: rawInput,
        });
        updateTask(task.id, { prompt: executionPrompt });
      }

      await runExecution(task, executionPrompt, targetAgentId);
    } finally {
      endTaskExecution(activeScope);
    }
  };

  const handleAdoptRaceResult = (messageId: string) => {
    if (!selectedTask) return;
    updateMessage(selectedTask.id, messageId, { adopted: true });
  };

  const handleCleanupWorktree = async (path: string, agentName?: string) => {
    const confirmed = window.confirm(
      `确认清理${agentName ? ` ${agentName} 的` : ''} worktree？\n${path}\n此操作不可恢复。`,
    );
    if (!confirmed) return;
    try {
      const res = await request('/api/cli/worktree/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: [path] }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || '清理失败');
      toast.success('worktree 已清理');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '清理失败');
    }
  };

  const insertAgentMention = (agentName: string) => {
    const mention = `@${agentName} `;
    setInputMessage(prev => (prev.trim() ? `${mention}${prev}` : mention));
    inputRef.current?.focus();
  };

  const continueTaskAgents = useMemo(() => {
    if (!selectedTask) return [];
    return selectedTask.templateSnapshot.memberIds
      .map(id => aiMembers[id])
      .filter(member => member && member.kind === 'cli');
  }, [selectedTask, aiMembers]);

  const headerTeamMembers = useMemo(() => {
    const memberIds = selectedTask
      ? selectedTask.templateSnapshot.memberIds
      : draftTemplate?.memberIds ?? [];
    return memberIds
      .map(id => aiMembers[id])
      .filter(member => member && member.kind === 'cli')
      .map(member => {
        const agent = mapAIMemberToLegacy(member) as CLIAgent;
        return { id: agent.id, name: agent.name, avatar: agent.avatar };
      });
  }, [selectedTask, draftTemplate, aiMembers]);

  const openTaskLog = (message: ReturnType<typeof taskMessageToChatRow>) => {
    if (!message.taskId) return;
    const member = message.sender.id?.startsWith('cli-') ? aiMembers[message.sender.id] : undefined;
    const adapter = member?.kind === 'cli' ? member.cli?.adapter : undefined;
    setLogTarget({
      agentTaskId: message.taskId,
      messageId: message.id,
      agentName: message.sender.name,
      adapter,
      prompt: message.prompt,
      status: message.status,
    });
  };

  const handleCancelTask = async (agentTaskId: string) => {
    try {
      await request('/api/cli/tasks/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: agentTaskId }),
      });
      if (selectedTask) {
        const msg = selectedTask.messages.find(m => m.agentTaskId === agentTaskId);
        if (msg) {
          updateMessage(selectedTask.id, msg.id, { status: 'cancelled' });
        }
      }
    } catch (e) {
      console.error('Failed to cancel task:', e);
    }
  };

  const handleRetryTask = async (msg: ReturnType<typeof taskMessageToChatRow>) => {
    if (!selectedTask || !msg.prompt || !msg.sender?.id) return;
    if (executingTaskIds.has(selectedTask.id)) return;

    beginTaskExecution(selectedTask.id);
    try {
      await runExecution(selectedTask, msg.prompt, msg.sender.id);
    } finally {
      endTaskExecution(selectedTask.id);
    }
  };

  const handleUpdateEditingTemplate = (updates: Partial<CLIGroup>) => {
    if (!editingCLIGroup || !onUpdateCLIGroup) return;
    onUpdateCLIGroup({ ...editingCLIGroup, ...updates });
  };

  const closeTemplateSettings = () => {
    const shouldReturnToList = templateSettingsReturnTo === 'template-list';
    setTemplateSettingsOpen(false);
    setEditingTemplateId(null);
    setTemplateSettingsReturnTo(null);
    if (shouldReturnToList) {
      setTemplateListOpen(true);
    }
  };

  const performDeleteTemplate = (templateId: string) => {
    if (!onDeleteCLIGroup) return;

    onDeleteCLIGroup(templateId);

    if (editingTemplateId === templateId) {
      closeTemplateSettings();
    }

    if (selectedTemplateId === templateId) {
      const remaining = cliGroups.filter(g => g.id !== templateId);
      setSelectedTemplateId(remaining[0]?.id || '');
    }

    toast.success('团队模板已删除');
  };

  const handleDeleteTemplate = (templateId: string) => {
    if (!onDeleteCLIGroup) return;
    const template = templates.find(t => t.id === templateId);
    const taskCount = taskCountByTemplate[templateId] || 0;
    const name = template?.name || '此模板';
    const description = taskCount > 0
      ? `已有 ${taskCount} 个开发任务不会受影响（仍保留创建时的快照），但无法再以此模板创建新任务。`
      : '删除后无法再以此模板创建新任务，此操作不可恢复。';

    Modal.confirm({
      title: `删除团队模板「${name}」？`,
      content: description,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      centered: true,
      zIndex: 2100,
      getContainer: () => document.body,
      onOk: () => {
        performDeleteTemplate(templateId);
      },
    });
  };

  useEffect(() => {
    if (!editingTemplateId) return;
    if (!cliGroups.some(group => group.id === editingTemplateId)) {
      setTemplateSettingsOpen(false);
      setEditingTemplateId(null);
      setTemplateSettingsReturnTo(null);
    }
  }, [cliGroups, editingTemplateId]);

  const openTemplateSettings = (templateId: string) => {
    setEditingTemplateId(templateId);
    if (templateListOpen) {
      setTemplateSettingsReturnTo('template-list');
    } else {
      setTaskInfoOpen(false);
      setShowLibrary(false);
      setTemplateListOpen(false);
      setTemplateSettingsReturnTo(null);
    }
    setTemplateSettingsOpen(true);
  };

  const openTemplateList = () => {
    setTaskInfoOpen(false);
    setShowLibrary(false);
    if (templateSettingsOpen) {
      setTemplateSettingsOpen(false);
      setEditingTemplateId(null);
      setTemplateSettingsReturnTo(null);
    }
    setTemplateListOpen(true);
  };

  const openCreateTemplate = () => {
    setCreateTemplateOpen(true);
  };

  const handleCreateTemplateGroup = (group: Group) => {
    onCreateGroup?.(group);
    if (group.type === 'cli') {
      setSelectedTemplateId(group.id);
    }
  };

  const handleCreateTaskFromThis = () => {
    if (!selectedTask) return;
    setForkTemplateId(selectedTask.templateId);
    setForkModalOpen(true);
  };

  const confirmForkTask = () => {
    if (!selectedTask) return;
    const tmpl = templates.find(t => t.id === forkTemplateId);
    if (!tmpl) return;
    setInputMessage(selectedTask.prompt);
    setSelectedTemplateId(forkTemplateId);
    setSelectedTaskId(null);
    setTaskInfoOpen(false);
    setForkModalOpen(false);
    navigateToList();
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleArchiveTask = () => {
    if (!selectedTask) return;
    if (archiveTask(selectedTask.id)) {
      handleToggleTaskInfo(false);
    }
  };

  const handleRestoreTask = () => {
    if (!selectedTask) return;
    restoreTask(selectedTask.id);
  };

  const handleDeleteTask = () => {
    if (!selectedTask) return;
    const confirmed = window.confirm(`确定删除任务「${selectedTask.title}」？此操作不可恢复。`);
    if (!confirmed) return;
    if (!deleteTask(selectedTask.id)) return;
    handleToggleTaskInfo(false);
    setSelectedTaskId(null);
    navigateToList();
  };

  const statusTag = (status: string) => {
    const map: Record<string, { color: string; label: string }> = {
      running: { color: 'processing', label: '运行中' },
      completed: { color: 'success', label: '已完成' },
      failed: { color: 'error', label: '失败' },
      cancelled: { color: 'warning', label: '已取消' },
      timeout: { color: 'error', label: '超时' },
      queued: { color: 'default', label: '排队' },
      archived: { color: 'default', label: '已归档' },
    };
    const info = map[status] || map.queued;
    return <Tag color={info.color}>{info.label}</Tag>;
  };

  const closeManagementPanels = () => {
    setTaskInfoOpen(false);
    setTemplateListOpen(false);
    setTemplateSettingsOpen(false);
    setEditingTemplateId(null);
    setTemplateSettingsReturnTo(null);
    setShowLibrary(false);
  };

  const handleToggleTaskInfo = (nextOpen: boolean) => {
    if (!nextOpen) {
      setTaskInfoOpen(false);
      return;
    }
    setTemplateListOpen(false);
    setTemplateSettingsOpen(false);
    setEditingTemplateId(null);
    setShowLibrary(false);
    setTaskInfoOpen(true);
  };

  const handleToggleTemplateList = (nextOpen: boolean) => {
    if (!nextOpen) {
      setTemplateListOpen(false);
      if (templateSettingsOpen) {
        setTemplateSettingsOpen(false);
        setEditingTemplateId(null);
        setTemplateSettingsReturnTo(null);
      }
      return;
    }
    setTaskInfoOpen(false);
    setTemplateSettingsOpen(false);
    setEditingTemplateId(null);
    setTemplateSettingsReturnTo(null);
    setShowLibrary(false);
    setTemplateListOpen(true);
  };

  const handleToggleTemplateSettings = (nextOpen: boolean) => {
    if (!nextOpen) {
      closeTemplateSettings();
      return;
    }
    setTaskInfoOpen(false);
    setTemplateListOpen(false);
    setShowLibrary(false);
    setTemplateSettingsReturnTo(null);
    setTemplateSettingsOpen(true);
  };

  const handleToggleLibrary = (nextOpen: boolean) => {
    if (!nextOpen) {
      setShowLibrary(false);
      return;
    }
    closeManagementPanels();
    setShowLibrary(true);
  };

  return (
    <>
      <Modal
        title="从此任务创建新任务"
        open={forkModalOpen}
        onCancel={() => setForkModalOpen(false)}
        onOk={confirmForkTask}
        okText="创建新任务"
        cancelText="取消"
      >
        <p style={{ fontSize: 13, marginBottom: 12, opacity: 0.75 }}>
          将复制当前任务的需求描述，并使用所选团队模板创建一条隔离的新任务。
        </p>
        <Select
          value={forkTemplateId || undefined}
          onChange={setForkTemplateId}
          style={{ width: '100%' }}
          options={templates.map(t => ({ value: t.id, label: t.name }))}
        />
      </Modal>

      <CreateGroupWizard
        open={createTemplateOpen}
        onOpenChange={setCreateTemplateOpen}
        onCreateGroup={handleCreateTemplateGroup}
        fixedGroupType="cli"
      />

      <CLIRaceResultsDrawer
        open={raceDrawerOpen}
        onOpenChange={setRaceDrawerOpen}
        task={selectedTask}
        workspacePath={workspacePath}
        onAdopt={handleAdoptRaceResult}
      />

      <CLITaskLogModal
        open={!!logTarget}
        onOpenChange={(open) => { if (!open) setLogTarget(null); }}
        agentTaskId={logTarget?.agentTaskId ?? null}
        agentName={logTarget?.agentName}
        adapter={logTarget?.adapter}
        prompt={logTarget?.prompt}
        status={logTarget?.status}
        onStatusChange={(status) => {
          if (logTarget && selectedTask) {
            updateMessage(selectedTask.id, logTarget.messageId, { status: status as CLITaskStatus });
            setLogTarget(prev => (prev ? { ...prev, status } : null));
          }
        }}
        onCancel={logTarget ? () => handleCancelTask(logTarget.agentTaskId) : undefined}
      />

      <CLITaskInfoPanel
        open={taskInfoOpen}
        onOpenChange={handleToggleTaskInfo}
        task={selectedTask}
        members={aiMembers}
        onCreateTaskFromThis={selectedTask ? handleCreateTaskFromThis : undefined}
        onArchiveTask={handleArchiveTask}
        onRestoreTask={handleRestoreTask}
        onDeleteTask={handleDeleteTask}
      />

      <CLITemplateListPanel
        open={templateListOpen}
        onOpenChange={handleToggleTemplateList}
        templates={templates}
        taskCountByTemplate={taskCountByTemplate}
        onOpenTemplateSettings={openTemplateSettings}
        onCreateTemplate={openCreateTemplate}
        onDeleteTemplate={handleDeleteTemplate}
      />

      {editingCLIGroup && (
        <CLIGroupSettings
          open={templateSettingsOpen}
          onOpenChange={handleToggleTemplateSettings}
          mode="template"
          group={editingCLIGroup}
          members={editingTemplateMembers}
          mutedUsers={mutedUsers}
          onToggleMute={(id) => setMutedUsers(prev =>
            prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id],
          )}
          workspacePath={editingCLIGroup.workspacePath || ''}
          onWorkspacePathChange={(p) => handleUpdateEditingTemplate({ workspacePath: p })}
          approvalMode={editingCLIGroup.approvalMode || 'auto'}
          onApprovalModeChange={(mode) => handleUpdateEditingTemplate({ approvalMode: mode })}
          timeout={editingCLIGroup.timeout ?? 300000}
          onTimeoutChange={(t) => handleUpdateEditingTemplate({ timeout: t })}
          showStderr={editingCLIGroup.showStderr !== false}
          onShowStderrChange={(v) => handleUpdateEditingTemplate({ showStderr: v })}
          strategy={editingCLIGroup.strategy || 'sequential'}
          onStrategyChange={(s) => handleUpdateEditingTemplate({ strategy: s })}
          onWorkflowTemplateChange={(workflowTemplateId) => handleUpdateEditingTemplate({ workflowTemplateId })}
          onExecutionPlanChange={(p) => handleUpdateEditingTemplate({ executionPlan: p })}
          onMembersChange={(ids) => handleUpdateEditingTemplate({ memberIds: ids })}
          onNameChange={(name) => handleUpdateEditingTemplate({ name })}
          onDescriptionChange={(description) => handleUpdateEditingTemplate({ description })}
          onReviewLoopRolesChange={(reviewLoopRoles) => handleUpdateEditingTemplate({ reviewLoopRoles })}
          sessionPolicy={editingCLIGroup.sessionPolicy || 'task'}
          onSessionPolicyChange={(policy) => handleUpdateEditingTemplate({ sessionPolicy: policy })}
          onBack={templateSettingsReturnTo === 'template-list' ? closeTemplateSettings : undefined}
          backLabel="团队模板"
          linkedTaskCount={taskCountByTemplate[editingCLIGroup.id] || 0}
          onDeleteTemplate={handleDeleteTemplate}
          onSaveTemplate={handleUpdateEditingTemplate}
        />
      )}

      <AIMemberLibrary
        open={showLibrary}
        onClose={() => handleToggleLibrary(false)}
        groups={groups}
      />

      <div className={styles.page}>
        <div className={styles.container}>
          <Sidebar
            isOpen={sidebarOpen}
            toggleSidebar={() => setSidebarOpen(!sidebarOpen)}
            selectedGroupIndex={selectedGroupIndex}
            onSelectGroup={onSelectGroup}
            groups={groups}
            onCreateGroup={onCreateGroup}
            onOpenLibrary={() => handleToggleLibrary(true)}
            activeView="cli-tasks"
            onNavigateCLI={() => navigateToList()}
            hiddenGroupTypes={['cli']}
          />

          <CLITaskSidebar
            isOpen={taskSidebarOpen}
            toggleSidebar={() => setTaskSidebarOpen(!taskSidebarOpen)}
            tasks={tasks}
            selectedTaskId={selectedTaskId}
            onSelectTask={navigateToTask}
            onNewTask={startNewTask}
            onOpenTemplateList={openTemplateList}
          />

          <div className={styles.rightCol}>
            {!taskSidebarOpen && (
              <Tooltip title="展开任务列表" placement="right">
                <button
                  type="button"
                  className={styles.taskSidebarExpandHandle}
                  onClick={() => setTaskSidebarOpen(true)}
                  aria-label="展开任务列表"
                >
                  <PanelLeftOpen size={14} />
                </button>
              </Tooltip>
            )}
            <header className={styles.headerBar}>
              <div className={styles.headerInner}>
                <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Terminal size={16} color="#ff6600" />
                      <h1 style={{ margin: 0, fontWeight: 600, fontSize: 14 }}>
                        {selectedTask ? selectedTask.title : '开发任务'}
                      </h1>
                      {selectedTask && statusTag(selectedTask.status)}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2, flexWrap: 'wrap' }}>
                      {headerTemplateName && (
                        <span style={{ fontSize: 11, opacity: 0.6 }}>
                          模板：{headerTemplateName}
                        </span>
                      )}
                      {workspacePath && (
                        <>
                          <span className={styles.cwdLabel}>CWD:</span>
                          <span className={styles.cwdPath} title={workspacePath}>
                            {workspacePath}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div className={styles.desktopOnly}>
                    <AdBanner show={showAd} closeAd={() => setShowAd(false)} />
                  </div>
                  {headerTeamMembers.length > 0 && (
                    <div className={styles.avatarStack}>
                      {headerTeamMembers.slice(0, 4).map((member) => {
                        const a = getAvatarData(member.name);
                        const url = resolveAvatarByName(member.name, member.avatar, 32);
                        return (
                          <Tooltip key={member.id} title={member.name}>
                            <LobeAvatar
                              avatar={url || a.text}
                              background={a.backgroundColor}
                              shape="circle"
                              size={32}
                              title={member.name}
                              style={{ flexShrink: 0 }}
                            />
                          </Tooltip>
                        );
                      })}
                      {headerTeamMembers.length > 4 && (
                        <div className={styles.avatarMore}>+{headerTeamMembers.length - 4}</div>
                      )}
                    </div>
                  )}
                  {selectedTask && (
                    <ActionIcon
                      icon={Info}
                      size="small"
                      onClick={() => handleToggleTaskInfo(!taskInfoOpen)}
                      title="任务信息"
                    />
                  )}
                  {raceEntries.length > 0 && (
                    <ActionIcon
                      icon={GitCompare}
                      size="small"
                      onClick={() => setRaceDrawerOpen(true)}
                      title="Race 结果对比"
                    />
                  )}
                </div>
              </div>
            </header>

            <div className={styles.chatArea}>
              {!selectedTask && (
                <div className={styles.emptyState}>
                  <Terminal size={48} style={{ opacity: 0.3 }} />
                  <div style={{ fontSize: 16, fontWeight: 500 }}>
                    {tasks.length === 0 ? '开始第一个开发任务' : '新建或继续任务'}
                  </div>
                  <div style={{ fontSize: 13, maxWidth: 360, lineHeight: 1.6 }}>
                    {tasks.length === 0
                      ? '先新建团队模板，再在下方输入代码需求即可开始。'
                      : '在下方输入新需求将创建独立任务；点击左侧任务可继续已有对话。'}
                  </div>
                </div>
              )}

              {selectedTask && (
                <div className={styles.messageList}>
                  {chatMessages.map((message, idx) => {
                    const isUser = !message.isAI;
                    const cliMember = message.sender?.id?.startsWith?.('cli-')
                      ? aiMembers[message.sender.id]
                      : undefined;
                    const cliAgentInfo = cliMember?.kind === 'cli'
                      ? mapAIMemberToLegacy(cliMember) as CLIAgent
                      : undefined;
                    const avatarName = cliAgentInfo?.name || message.sender.name;
                    const a = getAvatarData(avatarName);
                    const url = resolveAvatarByName(avatarName, cliAgentInfo?.avatar, 40);
                    const isLatest = idx === chatMessages.length - 1;
                    const isStreaming = message.isAI && (
                      message.status === 'running'
                      || (executingTaskIds.has(selectedTask!.id) && isLatest)
                    );
                    const bubbleClass = isUser
                      ? styles.bubbleUser
                      : message.isError
                        ? styles.bubbleError
                        : styles.bubbleAI;

                    return (
                      <div
                        key={message.id}
                        className={styles.messageRow}
                        style={{ justifyContent: isUser ? 'flex-end' : 'flex-start' }}
                      >
                        {!isUser && (
                          <LobeAvatar
                            avatar={url || a.text}
                            background={a.backgroundColor}
                            shape="circle"
                            size={40}
                            title={message.sender.name}
                          />
                        )}
                        <div style={{ maxWidth: '75%' }}>
                          <div className={styles.metaRow}>
                            {message.sender.name}
                            {isStreaming && (
                              <span className={styles.streaming}>
                                <span className={styles.streamingDot} />
                                {message.content === '' ? '思考中' : '执行中'}
                              </span>
                            )}
                          </div>
                          <div className={cx(bubbleClass, 'chat-message')}>
                            <ChatMarkdown content={message.content} isUser={isUser} />
                            {message.taskId && (
                              <div className={styles.cliTaskFooter}>
                                <span>
                                  {message.status === 'running' && (
                                    <>
                                      <span className={styles.spinnerIcon} />
                                      <span> 执行中</span>
                                    </>
                                  )}
                                  {message.status === 'completed' && <span style={{ color: '#52c41a' }}>✅ 已完成</span>}
                                  {message.status === 'failed' && <span style={{ color: '#ff4d4f' }}>❌ 失败</span>}
                                  {message.status === 'cancelled' && <span style={{ color: '#faad14' }}>⏹ 已取消</span>}
                                  {message.status === 'timeout' && <span style={{ color: '#ff4d4f' }}>⏰ 超时</span>}
                                </span>
                                <div className={styles.cliTaskActions}>
                                  <button
                                    type="button"
                                    className={styles.cliActionBtnLog}
                                    onClick={() => openTaskLog(message)}
                                  >
                                    日志
                                  </button>
                                  {message.status === 'running' && message.taskId && (
                                    <button
                                      type="button"
                                      className={styles.cliActionBtnCancel}
                                      onClick={() => handleCancelTask(message.taskId!)}
                                    >
                                      停止
                                    </button>
                                  )}
                                  {['failed', 'cancelled', 'timeout'].includes(message.status || '') && (
                                    <button
                                      type="button"
                                      className={styles.cliActionBtnRetry}
                                      onClick={() => handleRetryTask(message)}
                                    >
                                      重试
                                    </button>
                                  )}
                                </div>
                              </div>
                            )}
                            {message.cliCwd && message.cliCwd !== workspacePath && (
                              <div className={styles.cliWorktreeInfo}>
                                <div style={{ fontWeight: 500 }}>隔离 worktree</div>
                                <div className={styles.cliWorktreePath}>{message.cliCwd}</div>
                                {message.cliBranch && (
                                  <div>
                                    <span style={{ fontWeight: 500 }}>分支：</span>
                                    <span className={styles.cliWorktreePath}>{message.cliBranch}</span>
                                  </div>
                                )}
                                {message.baseSha && (
                                  <div>
                                    <span style={{ fontWeight: 500 }}>基准：</span>
                                    <span className={styles.cliWorktreePath}>{message.baseSha.slice(0, 8)}</span>
                                  </div>
                                )}
                                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                                  <button
                                    type="button"
                                    className={styles.cliWorktreeActionBtn}
                                    onClick={() => openPath(message.cliCwd!).catch(() => {})}
                                  >
                                    打开路径
                                  </button>
                                  {message.status === 'completed' && !message.adopted && (
                                    <button
                                      type="button"
                                      className={styles.cliWorktreeActionBtn}
                                      style={{ color: '#52c41a', borderColor: '#b7eb8f' }}
                                      onClick={() => handleAdoptRaceResult(message.id)}
                                    >
                                      标记采纳
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    className={styles.cliWorktreeActionBtn}
                                    style={{ color: '#ff4d4f', borderColor: '#ffccc7' }}
                                    onClick={() => handleCleanupWorktree(message.cliCwd!, message.sender.name)}
                                  >
                                    清理
                                  </button>
                                  {message.adopted && (
                                    <span style={{ fontSize: 11, color: '#52c41a', fontWeight: 600 }}>
                                      ✓ 已采纳
                                    </span>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>

            <div className={styles.inputArea}>
              <div className={styles.composeBox}>
                <AntdInput.TextArea
                  ref={inputRef}
                  className={styles.composeTextarea}
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage();
                    }
                  }}
                  placeholder={
                    selectedTask
                      ? '继续这个任务… 输入 @开发群友名 可指定执行者'
                      : '描述代码任务，开发群友会在 workspace 中协作执行...'
                  }
                  autoSize={{ minRows: 4, maxRows: 12 }}
                  disabled={isComposeBusy || (!selectedTask && !draftTemplate)}
                  variant="borderless"
                />
                <div className={styles.composeFooter}>
                  {!selectedTask ? (
                    <>
                      {templates.length > 0 && (
                        <Select
                          size="small"
                          value={selectedTemplateId || undefined}
                          onChange={setSelectedTemplateId}
                          style={{ minWidth: 140 }}
                          placeholder="选择团队模板"
                          options={templates.map(t => ({ value: t.id, label: t.name }))}
                        />
                      )}
                      <span className={styles.composeHint}>
                        {templates.length === 0
                          ? '还没有团队模板'
                          : '新任务将使用所选模板'}
                      </span>
                      <AntdButton
                        type="link"
                        size="small"
                        onClick={openCreateTemplate}
                        style={{ padding: 0, height: 'auto' }}
                      >
                        新建模板
                      </AntdButton>
                      {templates.length > 0 && (
                        <AntdButton
                          type="link"
                          size="small"
                          onClick={openTemplateList}
                          style={{ padding: 0, height: 'auto' }}
                        >
                          管理
                        </AntdButton>
                      )}
                    </>
                  ) : (
                    <>
                      <Tag color="orange">{selectedTask.templateSnapshot.name}</Tag>
                      <span className={styles.composeHint}>
                        继续此任务 · 配置以创建时快照为准
                      </span>
                    </>
                  )}
                  <div className={styles.composeFooterSpacer} />
                  <AntdButton
                    type="primary"
                    icon={<Send size={16} />}
                    onClick={handleSendMessage}
                    loading={isComposeBusy}
                    disabled={isComposeBusy || !inputMessage.trim() || (!selectedTask && !draftTemplate)}
                    style={{ background: '#ff6600', borderColor: '#ff6600' }}
                  >
                    发送
                  </AntdButton>
                </div>
              </div>
              {selectedTask && (
                <div style={{ fontSize: 10, opacity: 0.5, marginTop: 6 }}>
                  继续任务会复用此任务的 CLI 会话；输入 @开发群友名 可只让该成员执行。
                </div>
              )}
              {selectedTask && continueTaskAgents.length > 0 && (
                <div className={styles.agentChipRow}>
                  {continueTaskAgents.map(member => (
                    <button
                      key={member.id}
                      type="button"
                      className={styles.agentChip}
                      onClick={() => insertAgentMention(member.name)}
                    >
                      @{member.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {isMobile && sidebarOpen && (
          <div className={styles.mobileOverlay} onClick={() => setSidebarOpen(false)} />
        )}
      </div>
    </>
  );
};

export default CLITaskUI;
