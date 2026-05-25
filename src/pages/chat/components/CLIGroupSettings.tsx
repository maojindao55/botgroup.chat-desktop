/**
 * 开发群配置面板
 * 管理开发群友、workspacePath、审批模式、超时等
 */
import { useState, useEffect } from 'react';
import { Drawer, Switch, Button, Input, InputNumber, Tooltip, Tabs, Tag, Modal, Spin } from 'antd';
import { Avatar as LobeAvatar, ActionIcon } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { FolderOpen, Terminal, Mic, MicOff, CheckCircle2, XCircle, Play, FileText, RefreshCw, Clock, X, ChevronLeft } from 'lucide-react';
import { MemberPicker } from './MemberPicker';
import { cliWorkflowTemplates } from '@/config/groupProduct';
import { request } from '@/utils/request';
import type { CLIAgent } from '@/config/aiCharacters';
import type { CLIExecutionPlan, CLIGroup, CLIStrategy, CLISessionPolicy } from '@/config/groups';
import { cliSessionPolicyOptions } from '@/config/cliTasks';
import { getAvatarData, resolveAvatarByName } from '@/utils/avatar';
import { invoke } from '@tauri-apps/api/core';
import { openPath } from '@tauri-apps/plugin-opener';

type CliStatus = { installed: boolean; version?: string; path?: string };

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

interface CliTaskLogEntry {
  ts: string;
  type: 'stdout' | 'stderr' | 'system';
  content: string;
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
  onExecutionPlanChange?: (patch: Partial<CLIExecutionPlan>, options?: { replace?: boolean }) => void;
  onRetryTask?: (agentId: string, prompt: string) => void;
  onMembersChange?: (memberIds: string[]) => void;
  sessionPolicy: CLISessionPolicy;
  onSessionPolicyChange: (policy: CLISessionPolicy) => void;
  inline?: boolean;
  mode?: 'group' | 'template';
  /** 从上级抽屉进入时显示返回按钮 */
  onBack?: () => void;
  backLabel?: string;
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
  logConsole: css`
    background: #141414;
    border-radius: 8px;
    padding: 14px;
    font-family: 'Fira Code', 'Courier New', Courier, monospace;
    font-size: 12px;
    line-height: 1.6;
    max-height: 480px;
    overflow-y: auto;
    color: #e3e3e3;
    border: 1px solid #303030;
  `,
  logRow: css`
    display: flex;
    gap: 10px;
    margin-bottom: 4px;
    &:last-child {
      margin-bottom: 0;
    }
  `,
  logTimestamp: css`
    color: #858585;
    user-select: none;
    flex-shrink: 0;
  `,
  logText: css`
    word-break: break-all;
    white-space: pre-wrap;
  `,
  logTypeStdout: css`
    color: #4af626;
  `,
  logTypeStderr: css`
    color: #ff5252;
  `,
  logTypeSystem: css`
    color: #00e5ff;
    font-weight: 500;
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
  onExecutionPlanChange,
  onRetryTask,
  onMembersChange,
  sessionPolicy,
  onSessionPolicyChange,
  inline,
  mode = 'group',
  onBack,
  backLabel,
}: CLIGroupSettingsProps) => {
  const { styles, cx } = useStyles();
  const isTemplateMode = mode === 'template';
  const panelTitle = isTemplateMode ? '团队模板设置' : '开发群配置';
  const sessionPolicyTitle = isTemplateMode ? 'CLI 会话复用' : 'CLI 会话复用';
  const sessionPolicyDesc = isTemplateMode
    ? '新任务将按此策略决定 CLI tool session 是否跨任务共享；已有任务仍使用创建时的快照。'
    : '决定开发群友 CLI tool session 的复用范围。';
  const drawerTitle = onBack ? (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <Button
        type="text"
        size="small"
        icon={<ChevronLeft size={16} />}
        onClick={onBack}
        style={{ marginLeft: -8, padding: '0 6px', height: 28 }}
      >
        {backLabel || '返回'}
      </Button>
      <span>{panelTitle}</span>
    </div>
  ) : panelTitle;
  const handleDrawerClose = () => {
    if (onBack) {
      onBack();
      return;
    }
    onOpenChange(false);
  };
  const workspaceTitle = isTemplateMode ? '默认 Workspace' : '本地 Workspace';
  const workspaceDesc = isTemplateMode
    ? '新任务将默认使用此目录；已有任务不受影响'
    : '开发群友将在此目录下读写代码，支持选择或输入绝对路径';
  const membersManageLabel = isTemplateMode ? '模板成员' : '添加/管理开发群友';
  const membersListLabel = isTemplateMode ? '模板成员' : '开发群友';
  const memberPickerPlaceholder = isTemplateMode
    ? '选择模板成员...'
    : '选择开发群友加入群聊...';
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
  const [logEntries, setLogEntries] = useState<CliTaskLogEntry[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  // Reset tab when opening
  useEffect(() => {
    if (open) {
      setActiveTab('config');
    }
  }, [open]);

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

  // Fetch tasks on history/worktree tab active
  useEffect(() => {
    if (open && (activeTab === 'history' || activeTab === 'worktree')) {
      fetchTasks(false);
    }
  }, [open, activeTab, group.id]);

  // Fetch logs helper
  const fetchLogs = async (taskId: string) => {
    setLoadingLogs(true);
    try {
      const res = await request(`/api/cli/tasks/log?taskId=${taskId}`);
      const json = await res.json();
      if (json.success && json.data) {
        setLogEntries(json.data.lines || []);
      }
    } catch (e) {
      console.error('Failed to fetch logs:', e);
    } finally {
      setLoadingLogs(false);
    }
  };

  // Real-time logs polling for active running tasks
  useEffect(() => {
    if (!logModalOpen || !activeLogTask) return;

    fetchLogs(activeLogTask.id);

    if (activeLogTask.status === 'running') {
      const timer = setInterval(() => {
        fetchLogs(activeLogTask.id);
        request(`/api/cli/tasks/get?taskId=${activeLogTask.id}`)
          .then(res => res.json())
          .then(json => {
            if (json.success && json.data) {
              setActiveLogTask(json.data);
            }
          })
          .catch(console.error);
      }, 2000);
      return () => clearInterval(timer);
    }
  }, [logModalOpen, activeLogTask?.id, activeLogTask?.status]);

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
    return d.toLocaleString(undefined, {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const getStatusTag = (status: string) => {
    switch (status) {
      case 'completed':
        return <Tag color="success">已完成</Tag>;
      case 'running':
        return <Tag color="processing">运行中</Tag>;
      case 'failed':
        return <Tag color="error">失败</Tag>;
      case 'cancelled':
        return <Tag color="warning">已取消</Tag>;
      case 'timeout':
        return <Tag color="error">超时</Tag>;
      case 'queued':
        return <Tag color="default">排队中</Tag>;
      default:
        return <Tag>{status}</Tag>;
    }
  };

  const strategyDescriptions: Record<CLIStrategy, string> = {
    router: '自动选择最合适的开发群友处理当前任务，适合大多数一次性请求。',
    sequential: '多个开发群友独立处理同一任务，结果并列展示，适合比较不同方案。',
    pipeline: '按成员顺序接力开发，后续开发群友会看到上一阶段输出。',
    race: '为每位开发群友创建独立 worktree 并行完成同一任务，适合隔离对比代码结果。',
    review: '实现、审核、修正形成闭环，适合 Codex 写代码、Claude Code 审核这类开发协作。',
    discussion: '多位开发群友分轮讨论方案和风险，在临时只读副本中执行。',
    debate: '多位开发群友独立提案、互评，再形成最终建议。',
    mapreduce: '并行执行同一任务，汇总所有结果对比查看',
  };
  const selectedCliTemplate = cliWorkflowTemplates.find((item) => (
    item.id === selectedCliTemplateId && item.strategy === strategy
  ));
  const activeCliTemplate = selectedCliTemplate || cliWorkflowTemplates.find((item) => item.strategy === strategy);

  const worktreeTasks = tasks.filter(task => task.cwd && task.cwd.includes('cli-worktrees'));
  const worktreePaths = [...new Set(worktreeTasks.map(task => task.cwd).filter((p): p is string => !!p))];

  const tabItems = [
    {
      key: 'config',
      label: '基本设置',
      children: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {isTemplateMode && (
            <div className={styles.panelDesc} style={{ padding: '0 4px', lineHeight: 1.6 }}>
              修改后只影响之后创建的新任务，不会改变已有任务。
            </div>
          )}

          {/* workspace */}
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
                placeholder="/Users/you/projects/your-repo"
                value={workspacePath}
                onChange={(e) => onWorkspacePathChange(e.target.value)}
                style={{ flex: 1, fontFamily: 'var(--ant-font-family-code)' }}
              />
              <Button
                type="default"
                icon={<FolderOpen size={14} />}
                onClick={async () => {
                  try {
                    const selected = await invoke<string | null>('select_directory');
                    if (selected) onWorkspacePathChange(selected);
                  } catch (e) {
                    console.error('Failed to select directory:', e);
                  }
                }}
              >
                选择
              </Button>
            </div>
          </div>

          {/* approval */}
          <div className={styles.panel}>
            <div className={styles.rowBetween}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 500 }}>自动审批</div>
                <div className={styles.panelDesc} style={{ marginTop: 4 }}>开启后开发群友自动执行，无需确认</div>
              </div>
              <Switch
                checked={approvalMode === 'auto'}
                onChange={(v) => onApprovalModeChange(v ? 'auto' : 'ask')}
              />
            </div>
          </div>

          {/* session policy */}
          <div className={styles.panel}>
            <div style={{ fontSize: 14, fontWeight: 500 }}>{sessionPolicyTitle}</div>
            <div className={styles.panelDesc} style={{ marginTop: 4, marginBottom: 8 }}>
              {sessionPolicyDesc}
            </div>
            {cliSessionPolicyOptions.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => onSessionPolicyChange(item.value)}
                className={cx(
                  styles.strategyBtn,
                  sessionPolicy === item.value && styles.strategyBtnActive,
                )}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{item.label}</div>
                  <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginTop: 2 }}>
                    {item.description}
                  </div>
                </div>
              </button>
            ))}
          </div>

          {/* stderr */}
          <div className={styles.panel}>
            <div className={styles.rowBetween}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 500 }}>显示 stderr 输出</div>
                <div className={styles.panelDesc} style={{ marginTop: 4 }}>关闭后隐藏 CLI 诊断信息，仅保留标准输出和错误状态</div>
              </div>
              <Switch checked={showStderr} onChange={onShowStderrChange} />
            </div>
          </div>

          {/* timeout */}
          <div className={styles.panel}>
            <div style={{ fontSize: 14, fontWeight: 500 }}>执行超时</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <InputNumber
                value={timeout / 1000}
                onChange={(v) => onTimeoutChange(Number(v) * 1000)}
                min={30}
                max={600}
                style={{ width: 100 }}
              />
              <span className={styles.panelDesc}>秒</span>
            </div>
          </div>

          {/* strategy */}
          <div className={styles.panel}>
            <div style={{ fontSize: 14, fontWeight: 500 }}>协作方式</div>
            <div className={styles.strategyGrid}>
              {cliWorkflowTemplates.map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    setSelectedCliTemplateId(item.id);
                    onStrategyChange(item.strategy);
                    onExecutionPlanChange?.(item.executionPlan || {}, { replace: true });
                  }}
                  className={cx(
                    styles.strategyBtn,
                    activeCliTemplate?.id === item.id && styles.strategyBtnActive,
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <p className={styles.panelDesc} style={{ marginTop: 4 }}>
              {strategyDescriptions[strategy]}
            </p>
            {strategy === 'race' && (
              <p className={styles.panelDesc} style={{ marginTop: 4, color: '#ff9500' }}>
                需要 git 仓库，且当前工作区不能有未提交改动；每位开发群友在独立 worktree 中执行。
              </p>
            )}
            {strategy === 'pipeline' && (
              <p className={styles.panelDesc} style={{ marginTop: 4 }}>
                默认失败继续（让后续开发群友诊断）；用户取消会停止后续阶段。
              </p>
            )}
            {strategy === 'review' && (
              <p className={styles.panelDesc} style={{ marginTop: 4 }}>
                三阶段固定语义：规划阶段只产出方案；实现阶段按方案修改；评审阶段只做代码审查。
              </p>
            )}
            {strategy === 'review' && members.length < 3 && (
              <p className={styles.panelDesc} style={{ marginTop: 4, color: '#ff9500' }}>
                建议至少选择 3 个开发群友。当前成员不足时会自动降级：2 个成员为“规划 / 实现+自检”，1 个成员为“规划实现自评”。
              </p>
            )}
          </div>

          {/* Advanced Execution Plan Config (V3) */}
          <details style={{ marginTop: 0 }}>
            <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 500, color: 'rgba(0,0,0,0.65)', padding: '8px 0' }}>
              执行细节
            </summary>
            <div className={styles.panel} style={{ marginTop: 8 }}>
              <div className={styles.rowBetween}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>失败处理</div>
                  <div className={styles.panelDesc} style={{ marginTop: 2 }}>开发群友失败后是否继续执行后续阶段</div>
                </div>
                <select
                  value={group.executionPlan?.failurePolicy || 'continue'}
                  onChange={(e) => {
                    onExecutionPlanChange?.({
                      failurePolicy: e.target.value as CLIExecutionPlan['failurePolicy'],
                    });
                  }}
                  style={{ fontSize: 12, padding: '4px 8px', borderRadius: 4, border: '1px solid #d9d9d9' }}
                >
                  <option value="continue">继续执行</option>
                  <option value="stopOnFailure">失败停止</option>
                  <option value="stopOnCancelled">取消停止</option>
                </select>
              </div>
              {strategy === 'discussion' && (
                <div className={styles.rowBetween} style={{ marginTop: 8 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>协作轮数</div>
                    <div className={styles.panelDesc} style={{ marginTop: 2 }}>staged 调度的最大轮次数</div>
                  </div>
                  <InputNumber
                    value={group.executionPlan?.maxRounds ?? 2}
                    min={1}
                    max={5}
                    size="small"
                    style={{ width: 60 }}
                    onChange={(value) => {
                      onExecutionPlanChange?.({
                        maxRounds: typeof value === 'number' ? value : undefined,
                      });
                    }}
                  />
                </div>
              )}
              {strategy === 'race' && (
                <div className={styles.rowBetween} style={{ marginTop: 8 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>结果处理</div>
                    <div className={styles.panelDesc} style={{ marginTop: 2 }}>多结果时如何取舍（当前仅展示全部）</div>
                  </div>
                  <select
                    value={group.executionPlan?.resultPolicy || 'all'}
                    onChange={(e) => {
                      onExecutionPlanChange?.({
                        resultPolicy: e.target.value as CLIExecutionPlan['resultPolicy'],
                      });
                    }}
                    style={{ fontSize: 12, padding: '4px 8px', borderRadius: 4, border: '1px solid #d9d9d9' }}
                  >
                    <option value="all">全部展示</option>
                    <option value="firstSuccess">首个成功（规划中）</option>
                    <option value="fastest">最快结果（规划中）</option>
                    <option value="manualPick">手动选择（规划中）</option>
                  </select>
                </div>
              )}
              <p className={styles.panelDesc} style={{ marginTop: 8 }}>
                执行细节会覆盖协作方式的默认值。老数据不需要配置即可正常运行。
              </p>
            </div>
          </details>

          {/* members */}
          <div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
              <span style={{ fontSize: 14, fontWeight: 500 }}>{membersManageLabel}</span>
              <MemberPicker
                kind="cli"
                value={group.memberIds || group.members || []}
                onChange={(newIds) => onMembersChange?.(newIds)}
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
              <span style={{ fontSize: 14, fontWeight: 500 }}>{membersListLabel}（{members.length}）</span>
            </div>
            <div className={styles.scrollList}>
              {members.map((agent) => {
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
                          <span style={{ fontSize: 10, opacity: 0.6, marginTop: 4 }}>检测中...</span>
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
                            {status.version || '已安装'}
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
                            未安装
                          </span>
                        )}
                        {muted && (
                          <span style={{ fontSize: 10, color: '#ef4444', marginTop: 4 }}>已禁言</span>
                        )}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <Tooltip title={muted ? '取消禁言' : '禁言'}>
                        <ActionIcon
                          icon={muted ? MicOff : Mic}
                          size="small"
                          onClick={() => onToggleMute(agent.id)}
                          style={{ color: muted ? '#ef4444' : '#22c55e' }}
                          title=""
                        />
                      </Tooltip>
                      <Tooltip title="移除成员">
                        <ActionIcon
                          icon={X}
                          size="small"
                          onClick={() => {
                            const newIds = (group.memberIds || group.members || []).filter((id) => id !== agent.id);
                            onMembersChange?.(newIds);
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
        </div>
      )
    },
    {
      key: 'history',
      label: '任务历史',
      children: (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ fontSize: 13, opacity: 0.8 }}>历史执行记录</span>
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
              暂无执行记录
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
                        日志
                      </Button>
                      {['failed', 'cancelled', 'timeout', 'completed'].includes(task.status) && (
                        <Button
                          type="primary"
                          size="small"
                          icon={<Play size={12} />}
                          className={styles.actionBtn}
                          style={{ background: '#ff6600', borderColor: '#ff6600' }}
                          onClick={() => {
                            if (onRetryTask) {
                              onRetryTask(task.agentId, task.prompt);
                            }
                          }}
                        >
                          重试
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}

              {hasMore && (
                <div className={styles.loadMoreBtn} onClick={() => fetchTasks(true)}>
                  {loadingTasks ? <Spin size="small" /> : '加载更多...'}
                </div>
              )}
            </div>
          )}
        </div>
      )
    },
    {
      key: 'worktree',
      label: 'Worktree',
      children: (() => {
        const uniqueWorktrees = [...new Map(worktreeTasks
          .filter((task): task is CliTask & { cwd: string } => !!task.cwd)
          .map((task) => [task.cwd, task]))
          .values()];

        return (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontSize: 13, opacity: 0.8 }}>竞争模式 Worktree 管理</span>
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
                隔离竞赛会为每位开发群友创建独立的 git worktree。
                执行完成后 worktree 默认保留，你可以在此处查看和清理。
              </p>
            </div>

            {loadingTasks && tasks.length === 0 ? (
              <div style={{ padding: '32px 0', textAlign: 'center' }}>
                <Spin />
              </div>
            ) : uniqueWorktrees.length === 0 ? (
              <div style={{ padding: 12, background: 'rgba(0,0,0,0.04)', borderRadius: 8, marginBottom: 12, fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>
                暂无可管理的 worktree 记录。
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
                        打开路径
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
                        复制路径
                      </Button>
                      <Button
                        danger
                        size="small"
                        className={styles.actionBtn}
                        onClick={async () => {
                          const confirmed = window.confirm(`确认清理 ${task.agentName} 的 worktree？此操作不可恢复。`);
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
                        清理
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
                    const confirmed = window.confirm(`确认清理所有 ${uniqueWorktrees.length} 个 worktree？此操作不可恢复。`);
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
                  清理所有 Worktree ({uniqueWorktrees.length})
                </Button>
              </div>
            )}
          </div>
        );
      })()
    }
  ];

  if (inline) {
    if (!open) return null;
    return (
      <>
        <div className={styles.inlinePanel}>
          <div className={styles.inlineHeader}>
            <span className={styles.inlineTitle}>{panelTitle}</span>
            <button className={styles.inlineCloseBtn} onClick={() => onOpenChange(false)}>
              <X size={16} />
            </button>
          </div>
          <div className={styles.inlineContent}>
            <div className={styles.tabsContainer}>
              <Tabs
                activeKey={activeTab}
                onChange={setActiveTab}
                items={tabItems}
              />
            </div>
          </div>
        </div>

        <Modal
          title={
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingRight: 24 }}>
              <span>任务执行日志</span>
              {activeLogTask && (
                <span style={{ fontSize: 12, fontWeight: 'normal', color: 'var(--ant-color-text-secondary)' }}>
                  {activeLogTask.agentName} ({activeLogTask.adapter}) | 状态: {activeLogTask.status}
                </span>
              )}
            </div>
          }
          open={logModalOpen}
          onCancel={() => {
            setLogModalOpen(false);
            setActiveLogTask(null);
            setLogEntries([]);
          }}
          footer={[
            activeLogTask?.status === 'running' && (
              <Button
                key="cancel-task"
                danger
                onClick={async () => {
                  try {
                    await request('/api/cli/tasks/cancel', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ taskId: activeLogTask.id }),
                    });
                    const res = await request(`/api/cli/tasks/get?taskId=${activeLogTask.id}`);
                    const json = await res.json();
                    if (json.success && json.data) {
                      setActiveLogTask(json.data);
                    }
                  } catch (e) {
                    console.error('Failed to cancel task from log modal:', e);
                  }
                }}
              >
                停止运行
              </Button>
            ),
            <Button 
              key="refresh" 
              onClick={() => activeLogTask && fetchLogs(activeLogTask.id)}
              loading={loadingLogs}
            >
              刷新
            </Button>,
            <Button key="close" type="primary" onClick={() => setLogModalOpen(false)}>
              关闭
            </Button>
          ]}
          width={700}
          destroyOnClose
        >
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: 'var(--ant-color-text-secondary)', marginBottom: 4 }}>
              <strong>执行命令/提示词:</strong>
            </div>
            <div style={{ 
              fontSize: 12, 
              padding: '8px 12px', 
              background: 'var(--ant-color-fill-alter)', 
              borderRadius: 6, 
              fontFamily: 'monospace',
              maxHeight: 80,
              overflowY: 'auto',
              whiteSpace: 'pre-wrap'
            }}>
              {activeLogTask?.prompt}
            </div>
          </div>

          {loadingLogs && logEntries.length === 0 ? (
            <div style={{ padding: '60px 0', textAlign: 'center' }}>
              <Spin tip="加载日志中..." />
            </div>
          ) : logEntries.length === 0 ? (
            <div className={styles.logConsole}>
              <div className={cx(styles.logRow, styles.logTypeSystem)}>
                <span>暂无日志输出</span>
              </div>
            </div>
          ) : (
            <div className={styles.logConsole}>
              {logEntries.map((entry, idx) => {
                let typeClass = styles.logTypeStdout;
                if (entry.type === 'stderr') typeClass = styles.logTypeStderr;
                else if (entry.type === 'system') typeClass = styles.logTypeSystem;
                
                const timeStr = entry.ts ? entry.ts.split('T')[1]?.slice(0, 8) || entry.ts : '';

                return (
                  <div key={idx} className={styles.logRow}>
                    {timeStr && <span className={styles.logTimestamp}>[{timeStr}]</span>}
                    <span className={cx(styles.logText, typeClass)}>{entry.content}</span>
                  </div>
                );
              })}
            </div>
          )}
        </Modal>
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
      >
        <div className={styles.tabsContainer}>
          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            items={tabItems}
          />
        </div>
      </Drawer>

      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingRight: 24 }}>
            <span>任务执行日志</span>
            {activeLogTask && (
              <span style={{ fontSize: 12, fontWeight: 'normal', color: 'var(--ant-color-text-secondary)' }}>
                {activeLogTask.agentName} ({activeLogTask.adapter}) | 状态: {activeLogTask.status}
              </span>
            )}
          </div>
        }
        open={logModalOpen}
        onCancel={() => {
          setLogModalOpen(false);
          setActiveLogTask(null);
          setLogEntries([]);
        }}
        footer={[
          activeLogTask?.status === 'running' && (
            <Button
              key="cancel-task"
              danger
              onClick={async () => {
                try {
                  await request('/api/cli/tasks/cancel', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ taskId: activeLogTask.id }),
                  });
                  const res = await request(`/api/cli/tasks/get?taskId=${activeLogTask.id}`);
                  const json = await res.json();
                  if (json.success && json.data) {
                    setActiveLogTask(json.data);
                  }
                } catch (e) {
                  console.error('Failed to cancel task from log modal:', e);
                }
              }}
            >
              停止运行
            </Button>
          ),
          <Button 
            key="refresh" 
            onClick={() => activeLogTask && fetchLogs(activeLogTask.id)}
            loading={loadingLogs}
          >
            刷新
          </Button>,
          <Button key="close" type="primary" onClick={() => setLogModalOpen(false)}>
            关闭
          </Button>
        ]}
        width={700}
        destroyOnClose
      >
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: 'var(--ant-color-text-secondary)', marginBottom: 4 }}>
            <strong>执行命令/提示词:</strong>
          </div>
          <div style={{ 
            fontSize: 12, 
            padding: '8px 12px', 
            background: 'var(--ant-color-fill-alter)', 
            borderRadius: 6, 
            fontFamily: 'monospace',
            maxHeight: 80,
            overflowY: 'auto',
            whiteSpace: 'pre-wrap'
          }}>
            {activeLogTask?.prompt}
          </div>
        </div>

        {loadingLogs && logEntries.length === 0 ? (
          <div style={{ padding: '60px 0', textAlign: 'center' }}>
            <Spin tip="加载日志中..." />
          </div>
        ) : logEntries.length === 0 ? (
          <div className={styles.logConsole}>
            <div className={cx(styles.logRow, styles.logTypeSystem)}>
              <span>暂无日志输出</span>
            </div>
          </div>
        ) : (
          <div className={styles.logConsole}>
            {logEntries.map((entry, idx) => {
              let typeClass = styles.logTypeStdout;
              if (entry.type === 'stderr') typeClass = styles.logTypeStderr;
              else if (entry.type === 'system') typeClass = styles.logTypeSystem;
              
              const timeStr = entry.ts ? entry.ts.split('T')[1]?.slice(0, 8) || entry.ts : '';

              return (
                <div key={idx} className={styles.logRow}>
                  {timeStr && <span className={styles.logTimestamp}>[{timeStr}]</span>}
                  <span className={cx(styles.logText, typeClass)}>{entry.content}</span>
                </div>
              );
            })}
          </div>
        )}
      </Modal>
    </>
  );
};

export default CLIGroupSettings;
