/**
 * CLI 开发任务 UI — 以任务为主对象的聊天界面
 * Phase 1: 团队模板来自 CLIGroup，任务消息本地持久化，执行走 executeCLIStrategy
 */
import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  Send,
  ChevronLeft,
  Terminal,
  Share2,
  Info,
} from 'lucide-react';
import { Input as AntdInput, Button as AntdButton, Tag, Modal, Select } from 'antd';
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
import { SharePoster } from '@/pages/chat/components/SharePoster';
import CLIGroupSettings from './CLIGroupSettings';
import CLITaskInfoPanel from './CLITaskInfoPanel';
import CLITemplateListPanel from './CLITemplateListPanel';
import CLITaskSidebar from './CLITaskSidebar';
import Sidebar from './Sidebar';
import { AdBanner, AdBannerMobile } from './AdSection';
import { useUserStore } from '@/store/userStore';
import { useIsMobile } from '@/hooks/use-mobile';
import { AIMemberLibrary, AI_MEMBER_LIBRARY_INLINE_WIDTH } from './AIMemberLibrary';
import { useAIMemberStore } from '@/store/aiMemberStore';
import { getAvatarData, resolveAvatarByName } from '@/utils/avatar';
import type { Group, CLIGroup } from '@/config/groups';
import {
  templateSnapshotToCLIGroup,
  type CLIDevelopmentTask,
} from '@/config/cliTasks';
import {
  useCLITaskStore,
  getTeamTemplatesFromGroups,
  taskMessageToChatRow,
} from '@/store/cliTaskStore';
import { openPath } from '@tauri-apps/plugin-opener';

interface CLITaskUIProps {
  groups: Group[];
  cliGroups: CLIGroup[];
  selectedGroupIndex: number;
  onSelectGroup: (index: number) => void;
  onCreateGroup?: (group: Group) => void;
  onUpdateCLIGroup?: (group: CLIGroup) => void;
  initialTaskId?: string | null;
}

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
  chatArea: css`
    flex: 1;
    overflow: auto;
    background: ${token.colorBgLayout};
    padding: 12px 16px;
  `,
  inputArea: css`
    background: ${token.colorBgContainer};
    border-top: 1px solid ${token.colorBorderSecondary};
    padding: 12px 20px;
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
  spinnerIcon: css`
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 2px solid ${token.colorInfo};
    border-top-color: transparent;
    animation: spin 1s linear infinite;
    @keyframes spin { to { transform: rotate(360deg); } }
  `,
  mobileBackBtn: css`
    display: inline-flex;
    margin-right: 8px;
    cursor: pointer;
    @media (min-width: 768px) { display: none; }
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
  const [showNewTaskPanel, setShowNewTaskPanel] = useState(false);
  const [isDraftMode, setIsDraftMode] = useState(!initialTaskId);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(!isMobile);
  const [taskSidebarOpen, setTaskSidebarOpen] = useState(!isMobile);
  const [taskInfoOpen, setTaskInfoOpen] = useState(false);
  const [templateSettingsOpen, setTemplateSettingsOpen] = useState(false);
  const [templateListOpen, setTemplateListOpen] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [forkModalOpen, setForkModalOpen] = useState(false);
  const [forkTemplateId, setForkTemplateId] = useState('');
  const [showLibrary, setShowLibrary] = useState(false);
  const [showPoster, setShowPoster] = useState(false);
  const [showAd, setShowAd] = useState(false);
  const [mutedUsers, setMutedUsers] = useState<string[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const selectedTask = tasks.find(t => t.id === selectedTaskId) || null;
  const selectedTemplate = templates.find(t => t.id === selectedTemplateId) || templates[0];
  const draftTemplate = selectedTemplate;

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

  useEffect(() => { loadAIMembers(); }, [loadAIMembers]);
  useEffect(() => { if (isMobile !== undefined) { setSidebarOpen(!isMobile); setTaskSidebarOpen(!isMobile); } }, [isMobile]);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages]);

  useEffect(() => {
    if (initialTaskId && tasks.some(t => t.id === initialTaskId)) {
      setSelectedTaskId(initialTaskId);
      setIsDraftMode(false);
    }
  }, [initialTaskId, tasks]);

  useEffect(() => {
    if (templates.length > 0 && !selectedTemplateId) {
      setSelectedTemplateId(templates[0].id);
    }
  }, [templates, selectedTemplateId]);

  const navigateToTask = (taskId: string) => {
    setSelectedTaskId(taskId);
    setIsDraftMode(false);
    setShowNewTaskPanel(false);
    window.history.replaceState({}, '', `?view=cli-task&taskId=${encodeURIComponent(taskId)}`);
  };

  const navigateToList = () => {
    setSelectedTaskId(null);
    setIsDraftMode(true);
    window.history.replaceState({}, '', '?view=cli-tasks');
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
    };

    const messageIdByAgentTask = new Map<string, string>();

    try {
      await executeCLIStrategy(
        customGroup,
        activeAgents,
        taskPrompt,
        ws,
        {
          onAgentStart: (agentTaskId, agentId, agentName, meta) => {
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
          onToolSession: (_agentTaskId, agentId, adapter, sessionId) => {
            if (adapter === 'opencode' || adapter === 'codex' || adapter === 'claude') {
              localStorage.setItem(getSessionKey(developmentTask, agentId), sessionId);
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
      useCLITaskStore.getState().syncTaskStatus(developmentTask.id);
    }
  };

  const handleSendMessage = async () => {
    if (isLoading || !inputMessage.trim()) return;
    const liveTemplate = draftTemplate;
    if (!liveTemplate && !selectedTask) return;

    const prompt = inputMessage.trim();
    setInputMessage('');
    setIsLoading(true);

    try {
      let task = selectedTask;

      if (!task || isDraftMode) {
        if (!liveTemplate) return;
        task = createTask({
          prompt,
          template: liveTemplate,
          workspacePath: liveTemplate.workspacePath,
        });
        navigateToTask(task.id);
        setIsDraftMode(false);
      } else {
        appendMessage(task.id, {
          id: `msg-${Date.now()}-user`,
          taskId: task.id,
          role: 'user',
          content: prompt,
        });
        updateTask(task.id, { prompt });
      }

      await runExecution(task, prompt);
    } finally {
      setIsLoading(false);
    }
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
    if (isLoading || !selectedTask || !msg.prompt || !msg.sender?.id) return;
    setIsLoading(true);
    try {
      await runExecution(selectedTask, msg.prompt, msg.sender.id);
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdateEditingTemplate = (updates: Partial<CLIGroup>) => {
    if (!editingCLIGroup || !onUpdateCLIGroup) return;
    onUpdateCLIGroup({ ...editingCLIGroup, ...updates });
  };

  const openTemplateSettings = (templateId: string) => {
    setEditingTemplateId(templateId);
    if (templateListOpen) {
      handleToggleTemplateList(false);
    }
    if (!templateSettingsOpen) {
      handleToggleTemplateSettings(true);
    }
  };

  const openTemplateList = () => {
    if (taskInfoOpen) handleToggleTaskInfo(false);
    if (templateSettingsOpen) handleToggleTemplateSettings(false);
    if (!templateListOpen) {
      handleToggleTemplateList(true);
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
    setIsDraftMode(true);
    setSelectedTaskId(null);
    setTaskInfoOpen(false);
    setShowNewTaskPanel(true);
    setForkModalOpen(false);
    navigateToList();
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
    setIsDraftMode(true);
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

  const settingsPanelWidth = 400;

  const closeSidePanels = () => {
    if (taskInfoOpen) handleToggleTaskInfo(false);
    if (templateSettingsOpen) handleToggleTemplateSettings(false);
    if (templateListOpen) handleToggleTemplateList(false);
    if (showLibrary) handleToggleLibrary(false);
  };

  const adjustWindowWidthForPanel = (deltaPx: number) => {
    if (isMobile) return;
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return;
    (async () => {
      try {
        const { getCurrentWindow, LogicalSize } = await import('@tauri-apps/api/window');
        const appWindow = getCurrentWindow();
        const isMax = await appWindow.isMaximized();
        const isFull = await appWindow.isFullscreen();
        if (isMax || isFull) return;
        const scaleFactor = await appWindow.scaleFactor();
        const physicalSize = await appWindow.innerSize();
        const logicalSize = physicalSize.toLogical(scaleFactor);
        await appWindow.setSize(new LogicalSize(logicalSize.width + deltaPx, logicalSize.height));
      } catch { /* ignore */ }
    })();
  };

  const handleToggleTaskInfo = (nextOpen: boolean) => {
    if (nextOpen === taskInfoOpen) return;
    if (nextOpen) {
      if (templateSettingsOpen) handleToggleTemplateSettings(false);
      if (templateListOpen) handleToggleTemplateList(false);
      if (showLibrary) handleToggleLibrary(false);
    }
    setTaskInfoOpen(nextOpen);
    adjustWindowWidthForPanel(nextOpen ? settingsPanelWidth : -settingsPanelWidth);
  };

  const handleToggleTemplateList = (nextOpen: boolean) => {
    if (nextOpen === templateListOpen) return;
    if (nextOpen) {
      if (taskInfoOpen) handleToggleTaskInfo(false);
      if (templateSettingsOpen) handleToggleTemplateSettings(false);
      if (showLibrary) handleToggleLibrary(false);
    }
    setTemplateListOpen(nextOpen);
    adjustWindowWidthForPanel(nextOpen ? settingsPanelWidth : -settingsPanelWidth);
  };

  const handleToggleTemplateSettings = (nextOpen: boolean) => {
    if (nextOpen === templateSettingsOpen) return;
    if (nextOpen) {
      if (taskInfoOpen) handleToggleTaskInfo(false);
      if (templateListOpen) handleToggleTemplateList(false);
      if (showLibrary) handleToggleLibrary(false);
    }
    setTemplateSettingsOpen(nextOpen);
    if (!nextOpen) setEditingTemplateId(null);
    adjustWindowWidthForPanel(nextOpen ? settingsPanelWidth : -settingsPanelWidth);
  };

  const handleToggleLibrary = (nextOpen: boolean) => {
    if (nextOpen === showLibrary) return;
    if (nextOpen) closeSidePanels();
    setShowLibrary(nextOpen);
    adjustWindowWidthForPanel(nextOpen ? AI_MEMBER_LIBRARY_INLINE_WIDTH : -AI_MEMBER_LIBRARY_INLINE_WIDTH);
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

      {showPoster && selectedTask && (
        <SharePoster
          messages={chatMessages}
          onClose={() => setShowPoster(false)}
        />
      )}

      {isMobile && (
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
      )}

      {isMobile && (
        <CLITemplateListPanel
          open={templateListOpen}
          onOpenChange={handleToggleTemplateList}
          templates={templates}
          taskCountByTemplate={taskCountByTemplate}
          onOpenTemplateSettings={openTemplateSettings}
        />
      )}

      {isMobile && editingCLIGroup && (
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
          onExecutionPlanChange={(p) => handleUpdateEditingTemplate({ executionPlan: p })}
          onMembersChange={(ids) => handleUpdateEditingTemplate({ memberIds: ids })}
        />
      )}

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
            templates={templates}
            selectedTemplateId={selectedTemplateId}
            onSelectTemplate={setSelectedTemplateId}
            onStartNewTask={() => {
              setIsDraftMode(true);
              setSelectedTaskId(null);
              navigateToList();
            }}
            showNewTaskPanel={showNewTaskPanel}
            onToggleNewTaskPanel={setShowNewTaskPanel}
            onManageTemplate={openTemplateSettings}
            onOpenTemplateList={openTemplateList}
          />

          <div className={styles.rightCol}>
            <header className={styles.headerBar}>
              <div className={styles.headerInner}>
                <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
                  <div className={styles.mobileBackBtn} onClick={() => setTaskSidebarOpen(true)}>
                    <ChevronLeft size={20} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Terminal size={16} color="#ff6600" />
                      <h1 style={{ margin: 0, fontWeight: 600, fontSize: 14 }}>
                        {selectedTask ? selectedTask.title : '新建开发任务'}
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
                  <ActionIcon
                    icon={Share2}
                    size="small"
                    onClick={() => setShowPoster(true)}
                    title="分享"
                  />
                  {selectedTask && (
                    <ActionIcon
                      icon={Info}
                      size="small"
                      onClick={() => handleToggleTaskInfo(!taskInfoOpen)}
                      title="任务信息"
                    />
                  )}
                </div>
              </div>
            </header>

            <div className={styles.chatArea}>
              {!selectedTask && !isDraftMode && tasks.length === 0 && (
                <div className={styles.emptyState}>
                  <Terminal size={48} style={{ opacity: 0.3 }} />
                  <div style={{ fontSize: 16, fontWeight: 500 }}>开发任务</div>
                  <div style={{ fontSize: 13, maxWidth: 320 }}>
                    每个代码需求都会创建一个独立的任务聊天。选择团队模板，输入任务即可开始。
                  </div>
                </div>
              )}

              {(selectedTask || isDraftMode) && (
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
                    const isStreaming = message.isAI && (message.status === 'running' || (isLoading && isLatest));
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
                                <div>
                                  {message.status === 'running' && message.taskId && (
                                    <button
                                      className={styles.cliActionBtnCancel}
                                      onClick={() => handleCancelTask(message.taskId!)}
                                    >
                                      停止
                                    </button>
                                  )}
                                  {['failed', 'cancelled', 'timeout'].includes(message.status || '') && (
                                    <button
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
                              <div style={{ fontSize: 10, marginTop: 6, opacity: 0.7 }}>
                                <button
                                  className={styles.cliActionBtnRetry}
                                  onClick={() => openPath(message.cliCwd!).catch(() => {})}
                                >
                                  打开 {message.cliCwd}
                                </button>
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
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                <AntdInput.TextArea
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
                      ? '继续这个任务，或指定新的代码需求...'
                      : '描述代码任务，开发群友会在 workspace 中协作执行...'
                  }
                  autoSize={{ minRows: 1, maxRows: 6 }}
                  disabled={isLoading || (!selectedTask && !draftTemplate)}
                  style={{ borderRadius: 12 }}
                />
                <AntdButton
                  type="primary"
                  icon={<Send size={16} />}
                  onClick={handleSendMessage}
                  loading={isLoading}
                  disabled={!inputMessage.trim() || (!selectedTask && !draftTemplate)}
                  style={{ background: '#ff6600', borderColor: '#ff6600' }}
                />
              </div>
              {selectedTask && (
                <div style={{ fontSize: 10, opacity: 0.5, marginTop: 6 }}>
                  继续任务会复用此任务的 CLI 会话；如需隔离上下文，请新建任务。
                </div>
              )}
            </div>
          </div>

          {!isMobile && taskInfoOpen && (
            <CLITaskInfoPanel
              open
              onOpenChange={handleToggleTaskInfo}
              task={selectedTask}
              members={aiMembers}
              inline
              onCreateTaskFromThis={selectedTask ? handleCreateTaskFromThis : undefined}
              onArchiveTask={handleArchiveTask}
              onRestoreTask={handleRestoreTask}
              onDeleteTask={handleDeleteTask}
            />
          )}

          {!isMobile && templateListOpen && (
            <CLITemplateListPanel
              open
              onOpenChange={handleToggleTemplateList}
              templates={templates}
              taskCountByTemplate={taskCountByTemplate}
              onOpenTemplateSettings={openTemplateSettings}
              inline
            />
          )}

          {!isMobile && templateSettingsOpen && editingCLIGroup && (
            <div style={{ width: settingsPanelWidth, flexShrink: 0 }}>
              <CLIGroupSettings
                open
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
                onExecutionPlanChange={(p) => handleUpdateEditingTemplate({ executionPlan: p })}
                onMembersChange={(ids) => handleUpdateEditingTemplate({ memberIds: ids })}
                inline
              />
            </div>
          )}

          {!isMobile && showLibrary && (
            <AIMemberLibrary
              open
              onOpenChange={handleToggleLibrary}
              inline
            />
          )}
        </div>

        {isMobile && sidebarOpen && (
          <div className={styles.mobileOverlay} onClick={() => setSidebarOpen(false)} />
        )}
      </div>
    </>
  );
};

export default CLITaskUI;
