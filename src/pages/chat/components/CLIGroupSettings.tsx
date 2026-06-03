/**
 * 开发群配置面板
 * 管理开发成员、workspacePath、审批模式、超时等
 */
import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Drawer, Switch, Button, Input, InputNumber, Tooltip, Tabs, Tag, Spin, Select } from 'antd';
import { Avatar as LobeAvatar, ActionIcon } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { FolderOpen, Terminal, Mic, MicOff, CheckCircle2, XCircle, Play, FileText, RefreshCw, Clock, X, ChevronLeft, Info } from 'lucide-react';
import { MemberPicker } from './MemberPicker';
import { cliWorkflowTemplateGroups, cliWorkflowTemplates, getCLIWorkflowTemplatesByGroup } from '@/config/groupProduct';
import { request } from '@/utils/request';
import { mapAIMemberToLegacy, type CLIAgent } from '@/config/aiCharacters';
import type {
  CLICustomWorkflow,
  CLIExecutionPlan,
  CLIGroup,
  CLIStrategy,
  CLISessionPolicy,
  CLIReviewLoopRoles,
} from '@/config/groups';
import { getAvatarData, resolveAvatarByName } from '@/utils/avatar';
import { resolveEffectiveMember } from '@/utils/aiMemberDisplay';
import { invoke } from '@tauri-apps/api/core';
import { openPath } from '@tauri-apps/plugin-opener';
import CLITaskLogModal from './CLITaskLogModal';
import { useAIMemberStore } from '@/store/aiMemberStore';
import { formatLocaleDateTime } from '@/i18n/formatLocale';
import { BRAND_ON_PRIMARY, brandPrimaryButtonProps } from '@/lib/theme';

type CliStatus = { installed: boolean; version?: string; path?: string };

const cloneCustomWorkflow = (workflow: CLICustomWorkflow | undefined): CLICustomWorkflow | undefined => {
  if (!workflow) return undefined;
  return {
    ...workflow,
    stages: workflow.stages.map(stage => ({
      ...stage,
      reviewDecision: stage.reviewDecision ? { ...stage.reviewDecision } : undefined,
    })),
  };
};

interface CliTask {
  id: string;
  groupId: string;
  agentId: string;
  agentName: string;
  adapter: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'timeout';
  cwd?: string;
  prompt: string;
  promptSummary?: string;
  sessionId?: string;
  pid?: number;
  exitCode?: number;
  errorMessage?: string;
  logPath?: string;
  startedAt?: string;
  endedAt?: string;
  createdAt: string;
  updatedAt: string;
}

interface CLIGroupSettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group: CLIGroup;
  members: CLIAgent[];
  mutedUsers: string[];
  onToggleMute: (userId: string) => void;
  workspacePath: string;
  onWorkspacePathChange: (path: string) => void;
  approvalMode: 'auto' | 'ask';
  onApprovalModeChange: (mode: 'auto' | 'ask') => void;
  timeout: number;
  onTimeoutChange: (timeout: number) => void;
  showStderr: boolean;
  onShowStderrChange: (show: boolean) => void;
  strategy: CLIStrategy;
  onStrategyChange: (strategy: CLIStrategy) => void;
  onWorkflowTemplateChange?: (workflowTemplateId: string) => void;
  onExecutionPlanChange?: (patch: Partial<CLIExecutionPlan>, options?: { replace?: boolean }) => void;
  onRetryTask?: (agentId: string, prompt: string) => void;
  onMembersChange?: (memberIds: string[]) => void;
  onNameChange?: (name: string) => void;
  onDescriptionChange?: (description: string) => void;
  onReviewLoopRolesChange?: (roles: CLIReviewLoopRoles | undefined) => void;
  onSaveTemplate?: (group: CLIGroup) => void;
  sessionPolicy: CLISessionPolicy;
  onSessionPolicyChange: (policy: CLISessionPolicy) => void;
  inline?: boolean;
  mode?: 'group' | 'template';
  /** 从上级抽屉进入时显示返回按钮 */
  onBack?: () => void;
  backLabel?: string;
  onDeleteTemplate?: (templateId: string) => void;
  linkedTaskCount?: number;
}

const useStyles = createStyles(({ token, css }) => ({
  panel: css`
    background: ${token.colorFillTertiary};
    border-radius: 12px;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  `,
  panelHeader: css`
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    font-weight: 500;
  `,
  panelDesc: css`
    font-size: 12px;
    color: ${token.colorTextTertiary};
  `,
  snapshotNotice: css`
    border: 1px solid rgba(255, 102, 0, 0.22);
    background: rgba(255, 102, 0, 0.06);
    border-radius: 8px;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  `,
  snapshotMeta: css`
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    font-size: 11px;
    color: ${token.colorTextSecondary};

    span {
      border: 1px solid rgba(255, 102, 0, 0.2);
      background: ${token.colorBgContainer};
      border-radius: 999px;
      padding: 2px 8px;
    }
  `,
  rowBetween: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
  `,
  strategyGrid: css`
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
  `,
  strategyBtn: css`
    padding: 8px;
    height: 34px;
    min-width: 0;
    border-radius: 8px;
    border: 1px solid ${token.colorBorderSecondary};
    background: transparent;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 500;
    line-height: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    transition: all 0.15s;
    &:hover {
      background: ${token.colorFillTertiary};
    }
  `,
  strategyBtnActive: css`
    border-color: #ff6600;
    background: rgba(255, 102, 0, 0.08);
    color: #ff6600;
  `,
  memberRow: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 8px;
    transition: background 0.15s;
    margin-bottom: 8px;
    &:hover {
      background: ${token.colorFillTertiary};
    }
  `,
  adapterTag: css`
    display: inline-flex;
    align-items: center;
    gap: 2px;
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 4px;
    background: rgba(168, 85, 247, 0.12);
    color: #a855f7;
  `,
  scrollList: css`
    max-height: calc(100vh - 520px);
    overflow: auto;
  `,
  tabsContainer: css`
    .ant-tabs-nav {
      margin-bottom: 16px;
    }
  `,
  taskItem: css`
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 8px;
    padding: 12px;
    margin-bottom: 10px;
    background: ${token.colorBgContainer};
    display: flex;
    flex-direction: column;
    gap: 8px;
    transition: all 0.2s;
    &:hover {
      border-color: ${token.colorPrimaryHover};
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
    }
  `,
  taskHeader: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
  `,
  taskAgent: css`
    font-weight: 600;
    font-size: 13px;
    color: ${token.colorText};
  `,
  taskMeta: css`
    font-size: 11px;
    color: ${token.colorTextTertiary};
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  `,
  taskPrompt: css`
    font-size: 11px;
    color: ${token.colorTextDescription};
    background: ${token.colorFillAlter};
    padding: 6px 10px;
    border-radius: 6px;
    font-family: var(--ant-font-family-code);
    max-height: 50px;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  `,
  taskFooter: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 4px;
  `,
  taskActions: css`
    display: flex;
    gap: 8px;
  `,
  actionBtn: css`
    font-size: 11px;
    padding: 2px 8px;
    height: 24px;
    border-radius: 4px;
  `,
  pathText: css`
    font-family: var(--ant-font-family-code);
    font-size: 11px;
    color: ${token.colorTextSecondary};
    word-break: break-all;
  `,
  loadMoreBtn: css`
    width: 100%;
    text-align: center;
    margin: 10px 0;
    font-size: 12px;
    color: ${token.colorTextTertiary};
    cursor: pointer;
    &:hover {
      color: ${token.colorPrimary};
    }
  `,
  emptyMembers: css`
    border: 1px dashed ${token.colorBorderSecondary};
    border-radius: 8px;
    padding: 18px 12px;
    text-align: center;
    font-size: 12px;
    color: ${token.colorTextTertiary};
    background: ${token.colorFillTertiary};
  `,
  inlinePanel: css`
    width: 400px;
    height: 100%;
    display: flex;
    flex-direction: column;
    background: ${token.colorBgContainer};
    border-left: 1px solid ${token.colorBorderSecondary};
    flex-shrink: 0;
    z-index: 5;
  `,
  inlineHeader: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px;
    border-bottom: 1px solid ${token.colorBorderSecondary};
    height: 52px;
    flex-shrink: 0;
  `,
  inlineTitle: css`
    font-size: 14px;
    font-weight: 600;
    color: ${token.colorText};
  `,
  inlineCloseBtn: css`
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: ${token.colorTextSecondary};
    border-radius: 4px;
    transition: background 0.2s;
    &:hover {
      background: ${token.colorFillTertiary};
    }
  `,
  inlineContent: css`
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  `,
  inlineFooter: css`
    flex: none;
    border-top: 1px solid ${token.colorBorderSecondary};
    padding: 10px 16px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  `,
  autosaveHint: css`
    font-size: 11px;
    color: ${token.colorTextTertiary};
  `,
}));

export const CLIGroupSettings = ({
  open,
  onOpenChange,
  group,
  members,
  mutedUsers,
  onToggleMute,
  workspacePath,
  onWorkspacePathChange,
  approvalMode,
  onApprovalModeChange,
  timeout,
  onTimeoutChange,
  showStderr,
  onShowStderrChange,
  strategy,
  onStrategyChange,
  onWorkflowTemplateChange,
  onExecutionPlanChange,
  onRetryTask,
  onMembersChange,
  onNameChange,
  onDescriptionChange,
  onReviewLoopRolesChange,
  onSaveTemplate,
  sessionPolicy,
  inline,
  mode = 'group',
  onBack,
  backLabel,
  onDeleteTemplate,
  linkedTaskCount = 0,
}: CLIGroupSettingsProps) => {
  const { styles, cx } = useStyles();
  const { t, i18n } = useTranslation(['cli', 'common', 'product']);
  const aiMembers = useAIMemberStore(s => s.members);
  const isTemplateMode = mode === 'template';
  const buildTemplateDraft = (): CLIGroup => ({
    ...group,
    memberIds: group.memberIds || group.members || [],
    members: group.memberIds || group.members || [],
    workspacePath: isTemplateMode ? '' : workspacePath,
    approvalMode,
    timeout,
    showStderr,
    strategy,
    sessionPolicy,
  });
  const [draftGroup, setDraftGroup] = useState<CLIGroup>(() => buildTemplateDraft());
  const [originalDraftGroup, setOriginalDraftGroup] = useState<CLIGroup>(() => buildTemplateDraft());
  const effectiveGroup = isTemplateMode ? draftGroup : group;
  const effectiveWorkspacePath = isTemplateMode ? (draftGroup.workspacePath || '') : workspacePath;
  const effectiveApprovalMode = isTemplateMode ? (draftGroup.approvalMode || 'auto') : approvalMode;
  const effectiveTimeout = isTemplateMode ? (draftGroup.timeout ?? 300000) : timeout;
  const effectiveShowStderr = isTemplateMode ? draftGroup.showStderr !== false : showStderr;
  const effectiveStrategy = isTemplateMode ? (draftGroup.strategy || 'sequential') : strategy;
  const isDraftDirty = isTemplateMode && JSON.stringify(draftGroup) !== JSON.stringify(originalDraftGroup);
  const panelTitle = isTemplateMode ? t('cli:groupSettings.templateTitle') : t('cli:groupSettings.title');
  const handleDrawerClose = () => {
    if (onBack) {
      onBack();
      return;
    }
    onOpenChange(false);
  };
  const drawerTitle = onBack ? (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <Button
        type="text"
        size="small"
        icon={<ChevronLeft size={16} />}
        onClick={handleDrawerClose}
        style={{ marginLeft: -8, padding: '0 6px', height: 28 }}
      >
        {backLabel || t('cli:groupSettings.back')}
      </Button>
      <span>{panelTitle}</span>
    </div>
  ) : panelTitle;
  const workspaceTitle = isTemplateMode ? t('cli:groupSettings.workspace.templateTitle') : t('cli:groupSettings.workspace.title');
  const workspaceDesc = isTemplateMode
    ? t('cli:groupSettings.workspace.templateDesc')
    : t('cli:groupSettings.workspace.desc');
  const membersManageLabel = isTemplateMode ? t('cli:groupSettings.members.templateManage') : t('cli:groupSettings.members.manage');
  const membersListLabel = isTemplateMode ? t('cli:groupSettings.members.templateList') : t('cli:groupSettings.members.list');
  const memberPickerPlaceholder = isTemplateMode
    ? t('cli:groupSettings.members.templatePickerPlaceholder')
    : t('cli:groupSettings.members.pickerPlaceholder');
  const [cliStatus, setCliStatus] = useState<Record<string, CliStatus | 'loading'>>({});

  // History tab states
  const [activeTab, setActiveTab] = useState<string>('config');
  const [tasks, setTasks] = useState<CliTask[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [selectedCliTemplateId, setSelectedCliTemplateId] = useState<string | null>(null);

  // Log viewer states
  const [logModalOpen, setLogModalOpen] = useState(false);
  const [activeLogTask, setActiveLogTask] = useState<CliTask | null>(null);

  // Reset tab when opening
  useEffect(() => {
    if (open) {
      setActiveTab('config');
      setSelectedCliTemplateId(null);
      const nextDraft = buildTemplateDraft();
      setDraftGroup(nextDraft);
      setOriginalDraftGroup(nextDraft);
    }
  }, [open, group.id]);

  const updateDraftGroup = (patch: Partial<CLIGroup>) => {
    setDraftGroup(prev => ({
      ...prev,
      ...patch,
      type: 'cli',
    }));
  };

  const handleSaveDraft = () => {
    const next = {
      ...draftGroup,
      memberIds: draftGroup.memberIds || draftGroup.members || [],
      members: draftGroup.memberIds || draftGroup.members || [],
      workspacePath: '',
      approvalMode: draftGroup.approvalMode || 'auto',
      timeout: draftGroup.timeout ?? 300000,
      showStderr: draftGroup.showStderr !== false,
      strategy: draftGroup.strategy || 'sequential',
      sessionPolicy: draftGroup.sessionPolicy || 'task',
    };
    onSaveTemplate?.(next);
    setDraftGroup(next);
    setOriginalDraftGroup(next);
  };

  const handleRevertDraft = () => {
    setDraftGroup(originalDraftGroup);
  };

  // Load check status
  useEffect(() => {
    if (!open || members.length === 0) return;
    let cancelled = false;

    (async () => {
      for (const m of members) {
        if (cancelled) break;
        const adapter = m.cli?.adapter;
        if (!adapter) continue;
        setCliStatus(prev => ({ ...prev, [m.id]: 'loading' }));
        try {
          const res = await request('/api/cli/check', {
            method: 'POST',
            body: JSON.stringify({ adapter }),
          });
          const json = await res.json();
          if (!cancelled) {
            setCliStatus(prev => ({ ...prev, [m.id]: json.data || { installed: false } }));
          }
        } catch {
          if (!cancelled) {
            setCliStatus(prev => ({ ...prev, [m.id]: { installed: false } }));
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, members]);

  // Fetch tasks helper
  const fetchTasks = async (loadMore = false) => {
    if (loadingTasks) return;
    setLoadingTasks(true);
    try {
      let url = `/api/cli/tasks/list?groupId=${group.id}&limit=10`;
      if (loadMore && tasks.length > 0) {
        const lastTask = tasks[tasks.length - 1];
        url += `&before=${encodeURIComponent(lastTask.createdAt)}`;
      }
      const res = await request(url);
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        if (loadMore) {
          setTasks(prev => [...prev, ...json.data]);
        } else {
          setTasks(json.data);
        }
        setHasMore(json.data.length === 10);
      }
    } catch (e) {
      console.error('Failed to fetch task history:', e);
    } finally {
      setLoadingTasks(false);
    }
  };

  // Fetch tasks on history/worktree tab active (legacy CLI group only)
  useEffect(() => {
    if (isTemplateMode) return;
    if (open && (activeTab === 'history' || activeTab === 'worktree')) {
      fetchTasks(false);
    }
  }, [open, activeTab, group.id, isTemplateMode]);

  // SQLite CURRENT_TIMESTAMP formatting helpers
  const parseSqliteDatetime = (str?: string) => {
    if (!str) return null;
    const isoStr = str.replace(' ', 'T') + 'Z';
    return new Date(isoStr);
  };

  const formatDuration = (startedAt?: string, endedAt?: string) => {
    if (!startedAt) return '';
    const start = parseSqliteDatetime(startedAt);
    if (!start) return '';
    const end = endedAt ? parseSqliteDatetime(endedAt) : new Date();
    if (!end) return '';

    const diffMs = end.getTime() - start.getTime();
    if (diffMs < 0) return '0s';
    const diffSec = diffMs / 1000;
    if (diffSec < 60) {
      return `${diffSec.toFixed(1)}s`;
    }
    const diffMin = Math.floor(diffSec / 60);
    const remSec = Math.round(diffSec % 60);
    return `${diffMin}m ${remSec}s`;
  };

  const formatDateTime = (str?: string) => {
    const d = parseSqliteDatetime(str);
    if (!d) return '';
    return formatLocaleDateTime(d, {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const getStatusTag = (status: string) => {
    switch (status) {
      case 'completed':
        return <Tag color="success">{t('cli:status.completed')}</Tag>;
      case 'running':
        return <Tag color="processing">{t('cli:status.running')}</Tag>;
      case 'failed':
        return <Tag color="error">{t('cli:status.failed')}</Tag>;
      case 'cancelled':
        return <Tag color="warning">{t('cli:status.cancelled')}</Tag>;
      case 'timeout':
        return <Tag color="error">{t('cli:status.timeout')}</Tag>;
      case 'queued':
        return <Tag color="default">{t('cli:status.queued')}</Tag>;
      default:
        return <Tag>{status}</Tag>;
    }
  };

  const strategyDescriptions: Record<CLIStrategy, string> = useMemo(() => ({
    router: t('cli:groupSettings.strategies.router'),
    sequential: t('cli:groupSettings.strategies.sequential'),
    pipeline: t('cli:groupSettings.strategies.pipeline'),
    race: t('cli:groupSettings.strategies.race'),
    review: t('cli:groupSettings.strategies.review'),
    discussion: t('cli:groupSettings.strategies.discussion'),
    debate: t('cli:groupSettings.strategies.debate'),
    mapreduce: t('cli:groupSettings.strategies.mapreduce'),
  }), [i18n.language]);
  const selectedCliTemplate = cliWorkflowTemplates.find((item) => item.id === selectedCliTemplateId);
  const persistedCliTemplate = cliWorkflowTemplates.find((item) => item.id === effectiveGroup.workflowTemplateId);
  const activeCliTemplate = selectedCliTemplate || cliWorkflowTemplates.find((item) => item.strategy === effectiveStrategy);
  const activeWorkflowTemplate = selectedCliTemplate || persistedCliTemplate || activeCliTemplate;
  const effectiveCustomWorkflow = activeWorkflowTemplate?.customWorkflow || effectiveGroup.customWorkflow;
  const isReviewLoopWorkflow = activeWorkflowTemplate?.id === 'implement_review'
    || !!effectiveCustomWorkflow;
  const memberIds = effectiveGroup.memberIds || effectiveGroup.members || [];
  const visibleMembers = isTemplateMode
    ? memberIds
      .map(id => resolveEffectiveMember(aiMembers, id))
      .filter(m => m && m.kind === 'cli')
      .map(m => mapAIMemberToLegacy(m) as CLIAgent)
    : members;
  const reviewLoopRoles = {
    plannerId: effectiveGroup.reviewLoopRoles?.plannerId || memberIds[0],
    implementerId: effectiveGroup.reviewLoopRoles?.implementerId || memberIds[1] || memberIds[0],
    reviewerId: effectiveGroup.reviewLoopRoles?.reviewerId || effectiveGroup.reviewLoopRoles?.plannerId || memberIds[0],
    maxReviewRounds: effectiveGroup.reviewLoopRoles?.maxReviewRounds ?? 2,
  };
  const reviewLoopRoleOptions = visibleMembers.map(member => ({
    value: member.id,
    label: member.name,
  }));
  const handleReviewLoopRolesPatch = (patch: Partial<CLIReviewLoopRoles>) => {
    const next = { ...reviewLoopRoles, ...patch };
    if (isTemplateMode) {
      updateDraftGroup({ reviewLoopRoles: next });
    } else {
      onReviewLoopRolesChange?.(next);
    }
  };

  const worktreeTasks = tasks.filter(task => task.cwd && task.cwd.includes('cli-worktrees'));
  const worktreePaths = [...new Set(worktreeTasks.map(task => task.cwd).filter((p): p is string => !!p))];

  const tabItems = [
    {
      key: 'config',
      label: t('cli:groupSettings.tabs.config'),
      children: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {isTemplateMode && (
            <div className={styles.snapshotNotice}>
              <div className={styles.panelHeader}>
                <Info size={16} />
                <span>{t('cli:groupSettings.templateSnapshot.title')}</span>
              </div>
              <div className={styles.panelDesc}>
                {t('cli:groupSettings.templateSnapshot.desc')}
              </div>
              <div className={styles.snapshotMeta}>
                <span>{t('cli:groupSettings.templateSnapshot.linkedTasks', { count: linkedTaskCount })}</span>
                <span>{t('cli:groupSettings.templateSnapshot.members', { count: visibleMembers.length })}</span>
              </div>
            </div>
          )}

          {isTemplateMode && (
            <div className={styles.panel}>
              <div className={styles.panelHeader}>
                <FileText size={16} />
                <span>{t('cli:groupSettings.basicInfo.title')}</span>
              </div>
              <Input
                value={effectiveGroup.name}
                onChange={(e) => {
                  if (isTemplateMode) updateDraftGroup({ name: e.target.value });
                  else onNameChange?.(e.target.value);
                }}
                placeholder={t('cli:groupSettings.basicInfo.namePlaceholder')}
                maxLength={32}
                showCount
              />
              <Input.TextArea
                value={effectiveGroup.description}
                onChange={(e) => {
                  if (isTemplateMode) updateDraftGroup({ description: e.target.value });
                  else onDescriptionChange?.(e.target.value);
                }}
                placeholder={t('cli:groupSettings.basicInfo.descriptionPlaceholder')}
                rows={3}
                maxLength={120}
                showCount
              />
            </div>
          )}

          {!isTemplateMode && (
          <div className={styles.panel}>
            <div className={styles.panelHeader}>
              <FolderOpen size={16} />
              <span>{workspaceTitle}</span>
            </div>
            <div className={styles.panelDesc}>
              {workspaceDesc}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Input
                placeholder={t('cli:groupSettings.workspace.placeholder')}
                value={effectiveWorkspacePath}
                onChange={(e) => {
                  onWorkspacePathChange(e.target.value);
                }}
                style={{ flex: 1, fontFamily: 'var(--ant-font-family-code)' }}
              />
              <Button
                type="default"
                icon={<FolderOpen size={14} />}
                onClick={async () => {
                  try {
                    const selected = await invoke<string | null>('select_directory');
                    if (selected) {
                      onWorkspacePathChange(selected);
                    }
                  } catch (e) {
                    console.error('Failed to select directory:', e);
                  }
                }}
              >
                {t('common:actions.select')}
              </Button>
            </div>
          </div>
          )}

          {/* approval */}
          <div className={styles.panel}>
            <div className={styles.rowBetween}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{t('cli:groupSettings.approval.title')}</div>
                <div className={styles.panelDesc} style={{ marginTop: 4 }}>{t('cli:groupSettings.approval.desc')}</div>
              </div>
              <Switch
                checked={effectiveApprovalMode === 'auto'}
                onChange={(v) => {
                  const next = v ? 'auto' : 'ask';
                  if (isTemplateMode) updateDraftGroup({ approvalMode: next });
                  else onApprovalModeChange(next);
                }}
              />
            </div>
          </div>

          {/* stderr */}
          <div className={styles.panel}>
            <div className={styles.rowBetween}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{t('cli:groupSettings.stderr.title')}</div>
                <div className={styles.panelDesc} style={{ marginTop: 4 }}>{t('cli:groupSettings.stderr.desc')}</div>
              </div>
              <Switch
                checked={effectiveShowStderr}
                onChange={(value) => {
                  if (isTemplateMode) updateDraftGroup({ showStderr: value });
                  else onShowStderrChange(value);
                }}
              />
            </div>
          </div>

          {/* timeout */}
          <div className={styles.panel}>
            <div style={{ fontSize: 14, fontWeight: 500 }}>{t('cli:groupSettings.timeout.title')}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <InputNumber
                value={effectiveTimeout / 1000}
                onChange={(v) => {
                  const next = Number(v) * 1000;
                  if (isTemplateMode) updateDraftGroup({ timeout: next });
                  else onTimeoutChange(next);
                }}
                min={120}
                max={600}
                style={{ width: 100 }}
              />
              <span className={styles.panelDesc}>{t('cli:groupSettings.timeout.unit')}</span>
            </div>
          </div>

          {/* strategy */}
          <div className={styles.panel}>
            <div style={{ fontSize: 14, fontWeight: 500 }}>{t('cli:groupSettings.collaboration.title')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {cliWorkflowTemplateGroups.map(group => (
                <div key={group.id}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
                    <span className={styles.panelDesc} style={{ fontWeight: 600, color: 'rgba(0,0,0,0.65)' }}>
                      {t(`product:cliWorkflowTemplateGroups.${group.id}.label`, { defaultValue: group.label })}
                    </span>
                    <span className={styles.panelDesc}>
                      {t(`product:cliWorkflowTemplateGroups.${group.id}.description`, { defaultValue: group.description })}
                    </span>
                  </div>
                  <div className={styles.strategyGrid}>
                    {getCLIWorkflowTemplatesByGroup(group).map((item) => (
                      <button
                        key={item.id}
                        onClick={() => {
                          setSelectedCliTemplateId(item.id);
                          if (isTemplateMode) {
                            updateDraftGroup({
                              workflowTemplateId: item.id,
                              strategy: item.strategy,
                              executionPlan: item.executionPlan || {},
                              customWorkflow: cloneCustomWorkflow(item.customWorkflow),
                              reviewLoopRoles: (item.id === 'implement_review' || item.customWorkflow) ? reviewLoopRoles : undefined,
                            });
                          } else {
                            onWorkflowTemplateChange?.(item.id);
                            onStrategyChange(item.strategy);
                            onExecutionPlanChange?.(item.executionPlan || {}, { replace: true });
                            if (item.id === 'implement_review' || item.customWorkflow) {
                              onReviewLoopRolesChange?.(reviewLoopRoles);
                            } else {
                              onReviewLoopRolesChange?.(undefined);
                            }
                          }
                        }}
                        className={cx(
                          styles.strategyBtn,
                          activeWorkflowTemplate?.id === item.id && styles.strategyBtnActive,
                        )}
                      >
                        {t(`product:cliWorkflowTemplates.${item.id}.label`, { defaultValue: item.label })}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <p className={styles.panelDesc} style={{ marginTop: 4 }}>
              {activeWorkflowTemplate
                ? t(`product:cliWorkflowTemplates.${activeWorkflowTemplate.id}.description`, {
                  defaultValue: activeWorkflowTemplate.description || strategyDescriptions[effectiveStrategy],
                })
                : strategyDescriptions[effectiveStrategy]}
            </p>
            {effectiveStrategy === 'race' && (
              <p className={styles.panelDesc} style={{ marginTop: 4, color: '#ff9500' }}>
                {t('cli:groupSettings.collaboration.raceWarning')}
              </p>
            )}
            {effectiveStrategy === 'pipeline' && (
              <p className={styles.panelDesc} style={{ marginTop: 4 }}>
                {t('cli:groupSettings.collaboration.pipelineHint')}
              </p>
            )}
            {isReviewLoopWorkflow && !effectiveCustomWorkflow && (
              <p className={styles.panelDesc} style={{ marginTop: 4 }}>
                {t('cli:groupSettings.collaboration.reviewLoopHint')}
              </p>
            )}
            {effectiveCustomWorkflow && (
              <p className={styles.panelDesc} style={{ marginTop: 4 }}>
                {t('cli:groupSettings.collaboration.customWorkflowHint', {
                  stages: effectiveCustomWorkflow.stages
                    .map(stage => stage.label)
                    .join(' → '),
                })}
              </p>
            )}
            {isReviewLoopWorkflow && visibleMembers.length < 2 && (
              <p className={styles.panelDesc} style={{ marginTop: 4, color: '#ff9500' }}>
                {effectiveCustomWorkflow
                  ? t('cli:groupSettings.collaboration.customWorkflowMemberWarning')
                  : t('cli:groupSettings.collaboration.reviewLoopMemberWarning')}
              </p>
            )}
          </div>

          {isTemplateMode && isReviewLoopWorkflow && (
            <div className={styles.panel}>
              <div style={{ fontSize: 14, fontWeight: 500 }}>
                {effectiveCustomWorkflow
                  ? t('cli:groupSettings.roles.customTitle')
                  : t('cli:groupSettings.roles.title')}
              </div>
              <div className={styles.panelDesc}>
                {effectiveCustomWorkflow
                  ? t('cli:groupSettings.roles.customDesc', {
                    stages: effectiveCustomWorkflow.stages.map(stage => stage.label).join(' → '),
                  })
                  : t('cli:groupSettings.roles.desc')}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10 }}>
                {!effectiveCustomWorkflow && (
                  <div>
                    <div className={styles.panelDesc} style={{ marginBottom: 4 }}>{t('cli:groupSettings.roles.planner')}</div>
                    <Select
                      size="small"
                      value={reviewLoopRoles.plannerId}
                      onChange={(plannerId) => handleReviewLoopRolesPatch({ plannerId })}
                      options={reviewLoopRoleOptions}
                      placeholder={t('cli:groupSettings.roles.plannerPlaceholder')}
                      style={{ width: '100%' }}
                    />
                  </div>
                )}
                <div>
                  <div className={styles.panelDesc} style={{ marginBottom: 4 }}>
                    {effectiveCustomWorkflow
                      ? t('cli:groupSettings.roles.diagnoseFixer')
                      : t('cli:groupSettings.roles.implementer')}
                  </div>
                  <Select
                    size="small"
                    value={reviewLoopRoles.implementerId}
                    onChange={(implementerId) => handleReviewLoopRolesPatch({ implementerId })}
                    options={reviewLoopRoleOptions}
                    placeholder={effectiveCustomWorkflow
                      ? t('cli:groupSettings.roles.diagnoseFixerPlaceholder')
                      : t('cli:groupSettings.roles.implementerPlaceholder')}
                    style={{ width: '100%' }}
                  />
                </div>
                <div>
                  <div className={styles.panelDesc} style={{ marginBottom: 4 }}>
                    {effectiveCustomWorkflow
                      ? t('cli:groupSettings.roles.fixReviewer')
                      : t('cli:groupSettings.roles.reviewer')}
                  </div>
                  <Select
                    size="small"
                    value={reviewLoopRoles.reviewerId}
                    onChange={(reviewerId) => handleReviewLoopRolesPatch({ reviewerId })}
                    options={reviewLoopRoleOptions}
                    placeholder={effectiveCustomWorkflow
                      ? t('cli:groupSettings.roles.fixReviewerPlaceholder')
                      : t('cli:groupSettings.roles.reviewerPlaceholder')}
                    style={{ width: '100%' }}
                  />
                </div>
                <div>
                  <div className={styles.panelDesc} style={{ marginBottom: 4 }}>{t('cli:groupSettings.roles.maxReviewRounds')}</div>
                  <InputNumber
                    size="small"
                    value={reviewLoopRoles.maxReviewRounds}
                    min={1}
                    max={5}
                    onChange={(value) => {
                      handleReviewLoopRolesPatch({
                        maxReviewRounds: typeof value === 'number' ? value : 2,
                      });
                    }}
                    style={{ width: 100 }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Advanced Execution Plan Config (V3) */}
          <details style={{ marginTop: 0 }}>
            <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 500, color: 'rgba(0,0,0,0.65)', padding: '8px 0' }}>
              {t('cli:groupSettings.executionDetails.title')}
            </summary>
            <div className={styles.panel} style={{ marginTop: 8 }}>
              <div className={styles.rowBetween}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{t('cli:groupSettings.executionDetails.failurePolicy.title')}</div>
                  <div className={styles.panelDesc} style={{ marginTop: 2 }}>{t('cli:groupSettings.executionDetails.failurePolicy.desc')}</div>
                </div>
                <select
                  value={effectiveGroup.executionPlan?.failurePolicy || 'continue'}
                  onChange={(e) => {
                    const patch = {
                      failurePolicy: e.target.value as CLIExecutionPlan['failurePolicy'],
                    };
                    if (isTemplateMode) {
                      updateDraftGroup({ executionPlan: { ...(effectiveGroup.executionPlan || {}), ...patch } });
                    } else {
                      onExecutionPlanChange?.(patch);
                    }
                  }}
                  style={{ fontSize: 12, padding: '4px 8px', borderRadius: 4, border: '1px solid #d9d9d9' }}
                >
                  <option value="continue">{t('cli:groupSettings.executionDetails.failurePolicy.continue')}</option>
                  <option value="stopOnFailure">{t('cli:groupSettings.executionDetails.failurePolicy.stopOnFailure')}</option>
                  <option value="stopOnCancelled">{t('cli:groupSettings.executionDetails.failurePolicy.stopOnCancelled')}</option>
                </select>
              </div>
              {effectiveStrategy === 'discussion' && (
                <div className={styles.rowBetween} style={{ marginTop: 8 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{t('cli:groupSettings.executionDetails.maxRounds.title')}</div>
                    <div className={styles.panelDesc} style={{ marginTop: 2 }}>{t('cli:groupSettings.executionDetails.maxRounds.desc')}</div>
                  </div>
                  <InputNumber
                    value={effectiveGroup.executionPlan?.maxRounds ?? 2}
                    min={1}
                    max={5}
                    size="small"
                    style={{ width: 60 }}
                    onChange={(value) => {
                      const patch = {
                        maxRounds: typeof value === 'number' ? value : undefined,
                      };
                      if (isTemplateMode) {
                        updateDraftGroup({ executionPlan: { ...(effectiveGroup.executionPlan || {}), ...patch } });
                      } else {
                        onExecutionPlanChange?.(patch);
                      }
                    }}
                  />
                </div>
              )}
              {effectiveStrategy === 'race' && (
                <div className={styles.rowBetween} style={{ marginTop: 8 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{t('cli:groupSettings.executionDetails.resultPolicy.title')}</div>
                    <div className={styles.panelDesc} style={{ marginTop: 2 }}>{t('cli:groupSettings.executionDetails.resultPolicy.desc')}</div>
                  </div>
                  <select
                    value={effectiveGroup.executionPlan?.resultPolicy || 'all'}
                    onChange={(e) => {
                      const patch = {
                        resultPolicy: e.target.value as CLIExecutionPlan['resultPolicy'],
                      };
                      if (isTemplateMode) {
                        updateDraftGroup({ executionPlan: { ...(effectiveGroup.executionPlan || {}), ...patch } });
                      } else {
                        onExecutionPlanChange?.(patch);
                      }
                    }}
                    style={{ fontSize: 12, padding: '4px 8px', borderRadius: 4, border: '1px solid #d9d9d9' }}
                  >
                    <option value="all">{t('cli:groupSettings.executionDetails.resultPolicy.all')}</option>
                    <option value="firstSuccess">{t('cli:groupSettings.executionDetails.resultPolicy.firstSuccess')}</option>
                    <option value="fastest">{t('cli:groupSettings.executionDetails.resultPolicy.fastest')}</option>
                    <option value="manualPick">{t('cli:groupSettings.executionDetails.resultPolicy.manualPick')}</option>
                  </select>
                </div>
              )}
              <p className={styles.panelDesc} style={{ marginTop: 8 }}>
                {t('cli:groupSettings.executionDetails.hint')}
              </p>
            </div>
          </details>

          {/* members */}
          <div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
              <span style={{ fontSize: 14, fontWeight: 500 }}>{membersManageLabel}</span>
              <MemberPicker
                kind="cli"
                value={memberIds}
                onChange={(newIds) => {
                  if (isTemplateMode) {
                    updateDraftGroup({ memberIds: newIds, members: newIds });
                  } else {
                    onMembersChange?.(newIds);
                  }
                }}
                placeholder={memberPickerPlaceholder}
              />
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 12,
              }}
            >
              <span style={{ fontSize: 14, fontWeight: 500 }}>
                {t('cli:groupSettings.members.count', { label: membersListLabel, count: visibleMembers.length })}
              </span>
            </div>
            <div className={styles.scrollList}>
              {visibleMembers.length === 0 && (
                <div className={styles.emptyMembers}>
                  {t('cli:groupSettings.members.empty')}
                </div>
              )}
              {visibleMembers.map((agent) => {
                const status = cliStatus[agent.id];
                const a = getAvatarData(agent.name);
                const url = resolveAvatarByName(agent.name, agent.avatar, 36);
                const muted = mutedUsers.includes(agent.id);
                return (
                  <div key={agent.id} className={styles.memberRow}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <LobeAvatar
                        shape="circle"
                        avatar={url || a.text}
                        background={a.backgroundColor}
                        size={36}
                      />
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 14, fontWeight: 500 }}>{agent.name}</span>
                          <span className={styles.adapterTag}>
                            <Terminal size={10} /> {agent.cli.adapter}
                          </span>
                        </div>
                        {status === 'loading' && (
                          <span style={{ fontSize: 10, opacity: 0.6, marginTop: 4 }}>{t('cli:groupSettings.members.checking')}</span>
                        )}
                        {status && status !== 'loading' && status.installed && (
                          <span
                            style={{
                              fontSize: 10,
                              color: '#22c55e',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 2,
                              marginTop: 4,
                            }}
                          >
                            <CheckCircle2 size={10} />
                            {status.version || t('cli:groupSettings.members.installed')}
                          </span>
                        )}
                        {status && status !== 'loading' && !status.installed && (
                          <span
                            style={{
                              fontSize: 10,
                              color: '#ef4444',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 2,
                              marginTop: 4,
                            }}
                          >
                            <XCircle size={10} />
                            {t('cli:groupSettings.members.notInstalled')}
                          </span>
                        )}
                        {muted && (
                          <span style={{ fontSize: 10, color: '#ef4444', marginTop: 4 }}>{t('cli:groupSettings.members.muted')}</span>
                        )}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <Tooltip title={muted ? t('cli:groupSettings.members.unmute') : t('cli:groupSettings.members.mute')}>
                        <ActionIcon
                          icon={muted ? MicOff : Mic}
                          size="small"
                          onClick={() => onToggleMute(agent.id)}
                          style={{ color: muted ? '#ef4444' : '#22c55e' }}
                          title=""
                        />
                      </Tooltip>
                      <Tooltip title={t('cli:groupSettings.members.remove')}>
                        <ActionIcon
                          icon={X}
                          size="small"
                          onClick={() => {
                            const newIds = memberIds.filter((id) => id !== agent.id);
                            if (isTemplateMode) {
                              updateDraftGroup({ memberIds: newIds, members: newIds });
                            } else {
                              onMembersChange?.(newIds);
                            }
                          }}
                          title=""
                        />
                      </Tooltip>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {isTemplateMode && onDeleteTemplate && (
            <div className={styles.panel}>
              <div style={{ fontSize: 14, fontWeight: 500, color: '#ff4d4f' }}>{t('cli:groupSettings.deleteTemplate.title')}</div>
              <div className={styles.panelDesc} style={{ marginTop: 4, marginBottom: 12 }}>
                {linkedTaskCount > 0
                  ? t('cli:groupSettings.deleteTemplate.descWithTasks', { count: linkedTaskCount })
                  : t('cli:groupSettings.deleteTemplate.descNoTasks')}
              </div>
              <Button
                danger
                block
                onClick={() => onDeleteTemplate(group.id)}
              >
                {t('cli:groupSettings.deleteTemplate.button')}
              </Button>
            </div>
          )}
        </div>
      )
    },
    {
      key: 'history',
      label: t('cli:groupSettings.tabs.history'),
      children: (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ fontSize: 13, opacity: 0.8 }}>{t('cli:groupSettings.history.title')}</span>
            <Button
              type="text"
              size="small"
              icon={<RefreshCw size={14} />}
              onClick={() => fetchTasks(false)}
              loading={loadingTasks}
            />
          </div>

          {loadingTasks && tasks.length === 0 ? (
            <div style={{ padding: '40px 0', textAlign: 'center' }}>
              <Spin />
            </div>
          ) : tasks.length === 0 ? (
            <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--ant-color-text-tertiary)' }}>
              {t('cli:groupSettings.history.empty')}
            </div>
          ) : (
            <div style={{ maxHeight: 'calc(100vh - 220px)', overflowY: 'auto', paddingRight: 4 }}>
              {tasks.map(task => (
                <div key={task.id} className={styles.taskItem}>
                  <div className={styles.taskHeader}>
                    <span className={styles.taskAgent}>{task.agentName}</span>
                    {getStatusTag(task.status)}
                  </div>

                  <div className={styles.taskMeta}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <Terminal size={12} />
                      {task.adapter}
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <Clock size={12} />
                      {formatDuration(task.startedAt, task.endedAt)}
                    </span>
                    <span>{formatDateTime(task.createdAt)}</span>
                  </div>

                  <div className={styles.taskPrompt} title={task.prompt}>
                    {task.prompt}
                  </div>

                  <div className={styles.taskFooter}>
                    <span style={{ fontSize: 10, color: 'var(--ant-color-text-tertiary)', fontFamily: 'monospace' }}>
                      ID: {task.id.slice(0, 8)}
                    </span>
                    <div className={styles.taskActions}>
                      <Button
                        type="default"
                        size="small"
                        icon={<FileText size={12} />}
                        className={styles.actionBtn}
                        onClick={() => {
                          setActiveLogTask(task);
                          setLogModalOpen(true);
                        }}
                      >
                        {t('cli:groupSettings.history.log')}
                      </Button>
                      {['failed', 'cancelled', 'timeout', 'completed'].includes(task.status) && (
                        <Button
                          size="small"
                          icon={<Play size={12} color={BRAND_ON_PRIMARY} />}
                          className={styles.actionBtn}
                          {...brandPrimaryButtonProps}
                          onClick={() => {
                            if (onRetryTask) {
                              onRetryTask(task.agentId, task.prompt);
                            }
                          }}
                        >
                          {t('cli:groupSettings.history.retry')}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}

              {hasMore && (
                <div className={styles.loadMoreBtn} onClick={() => fetchTasks(true)}>
                  {loadingTasks ? <Spin size="small" /> : t('cli:groupSettings.history.loadMore')}
                </div>
              )}
            </div>
          )}
        </div>
      )
    },
    {
      key: 'worktree',
      label: t('cli:groupSettings.tabs.worktree'),
      children: (() => {
        const uniqueWorktrees = [...new Map(worktreeTasks
          .filter((task): task is CliTask & { cwd: string } => !!task.cwd)
          .map((task) => [task.cwd, task]))
          .values()];

        return (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontSize: 13, opacity: 0.8 }}>{t('cli:groupSettings.worktree.title')}</span>
              <Button
                type="text"
                size="small"
                icon={<RefreshCw size={14} />}
                onClick={() => fetchTasks(false)}
                loading={loadingTasks}
              />
            </div>
            <div style={{ padding: 12, background: 'rgba(0,0,0,0.04)', borderRadius: 8, marginBottom: 12 }}>
              <p style={{ fontSize: 12, color: 'rgba(0,0,0,0.65)', margin: 0 }}>
                {t('cli:groupSettings.worktree.hint')}
              </p>
            </div>

            {loadingTasks && tasks.length === 0 ? (
              <div style={{ padding: '32px 0', textAlign: 'center' }}>
                <Spin />
              </div>
            ) : uniqueWorktrees.length === 0 ? (
              <div style={{ padding: 12, background: 'rgba(0,0,0,0.04)', borderRadius: 8, marginBottom: 12, fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>
                {t('cli:groupSettings.worktree.empty')}
              </div>
            ) : (
              <div style={{ maxHeight: 'calc(100vh - 330px)', overflowY: 'auto', paddingRight: 4, marginBottom: 12 }}>
                {uniqueWorktrees.map((task) => (
                  <div key={task.cwd} className={styles.taskItem}>
                    <div className={styles.taskHeader}>
                      <span className={styles.taskAgent}>{task.agentName}</span>
                      {getStatusTag(task.status)}
                    </div>
                    <div className={styles.taskMeta}>
                      <span>{formatDateTime(task.createdAt)}</span>
                      {task.exitCode !== undefined && <span>exit {task.exitCode}</span>}
                    </div>
                    <div className={styles.pathText}>{task.cwd}</div>
                    <div className={styles.taskActions}>
                      <Button
                        size="small"
                        className={styles.actionBtn}
                        onClick={() => openPath(task.cwd)}
                      >
                        {t('cli:groupSettings.worktree.openPath')}
                      </Button>
                      <Button
                        size="small"
                        className={styles.actionBtn}
                        onClick={() => {
                          if (navigator.clipboard) {
                            navigator.clipboard.writeText(task.cwd).catch(() => {});
                          }
                        }}
                      >
                        {t('cli:groupSettings.worktree.copyPath')}
                      </Button>
                      <Button
                        danger
                        size="small"
                        className={styles.actionBtn}
                        onClick={async () => {
                          const confirmed = window.confirm(
                            t('cli:groupSettings.worktree.cleanupConfirm', { agentName: task.agentName }),
                          );
                          if (!confirmed) return;
                          try {
                            await request('/api/cli/worktree/cleanup', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ paths: [task.cwd] }),
                            });
                            await fetchTasks(false);
                          } catch (e) {
                            console.error('Failed to cleanup worktree:', e);
                          }
                        }}
                      >
                        {t('cli:groupSettings.worktree.cleanup')}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {uniqueWorktrees.length > 0 && (
              <div style={{ marginTop: 12, padding: 12, background: 'rgba(0,0,0,0.04)', borderRadius: 8 }}>
                <Button
                  danger
                  size="small"
                  onClick={async () => {
                    const confirmed = window.confirm(
                      t('cli:groupSettings.worktree.cleanupAllConfirm', { count: uniqueWorktrees.length }),
                    );
                    if (!confirmed) return;
                    try {
                      await request('/api/cli/worktree/cleanup', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ paths: worktreePaths }),
                      });
                      await fetchTasks(false);
                    } catch (e) {
                      console.error('Failed to cleanup worktrees:', e);
                    }
                  }}
                >
                  {t('cli:groupSettings.worktree.cleanupAll', { count: uniqueWorktrees.length })}
                </Button>
              </div>
            )}
          </div>
        );
      })()
    }
  ];

  const visibleTabItems = isTemplateMode
    ? tabItems.filter((item) => item.key === 'config')
    : tabItems;

  const taskLogModal = !isTemplateMode ? (
    <CLITaskLogModal
      open={logModalOpen}
      onOpenChange={(open) => {
        setLogModalOpen(open);
        if (!open) setActiveLogTask(null);
      }}
      agentTaskId={activeLogTask?.id ?? null}
      agentName={activeLogTask?.agentName}
      adapter={activeLogTask?.adapter}
      prompt={activeLogTask?.prompt}
      status={activeLogTask?.status}
      onStatusChange={(status) => {
        if (activeLogTask) {
          setActiveLogTask({ ...activeLogTask, status: status as CliTask['status'] });
        }
      }}
    />
  ) : null;

  const templateFooter = isTemplateMode ? (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <span className={styles.autosaveHint}>{isDraftDirty ? t('cli:groupSettings.footer.dirty') : t('cli:groupSettings.footer.clean')}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Button onClick={handleRevertDraft} disabled={!isDraftDirty}>
          {t('cli:groupSettings.footer.revert')}
        </Button>
        <Button onClick={handleSaveDraft} disabled={!isDraftDirty} {...brandPrimaryButtonProps}>
          {t('common:actions.save')}
        </Button>
      </div>
    </div>
  ) : undefined;

  if (inline) {
    if (!open) return null;
    return (
      <>
        <div className={styles.inlinePanel}>
          <div className={styles.inlineHeader}>
            <span className={styles.inlineTitle}>{panelTitle}</span>
            <button className={styles.inlineCloseBtn} onClick={handleDrawerClose}>
              <X size={16} />
            </button>
          </div>
          <div className={styles.inlineContent}>
            <div className={styles.tabsContainer}>
              <Tabs
                activeKey={activeTab}
                onChange={setActiveTab}
                items={visibleTabItems}
              />
            </div>
          </div>
          {isTemplateMode && (
            <div className={styles.inlineFooter}>
              <span className={styles.autosaveHint}>{isDraftDirty ? t('cli:groupSettings.footer.dirty') : t('cli:groupSettings.footer.clean')}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Button size="small" onClick={handleRevertDraft} disabled={!isDraftDirty}>
                  {t('cli:groupSettings.footer.revert')}
                </Button>
                <Button size="small" onClick={handleSaveDraft} disabled={!isDraftDirty} {...brandPrimaryButtonProps}>
                  {t('common:actions.save')}
                </Button>
              </div>
            </div>
          )}
        </div>

        {taskLogModal}
      </>
    );
  }

  return (
    <>
      <Drawer
        title={drawerTitle}
        placement="right"
        open={open}
        onClose={handleDrawerClose}
        width={480}
        footer={templateFooter}
      >
        <div className={styles.tabsContainer}>
          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            items={visibleTabItems}
          />
        </div>
      </Drawer>

      {taskLogModal}
    </>
  );
};

export default CLIGroupSettings;
