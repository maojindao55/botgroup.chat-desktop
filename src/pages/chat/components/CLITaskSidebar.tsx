import { useState, useMemo } from 'react';
import {
  Plus,
  Search,
  Terminal,
  X,
  PanelLeftClose,
  SlidersHorizontal,
  Users,
  Archive,
  Clock3,
} from 'lucide-react';
import { Input, Tooltip, Select, Checkbox, Button } from 'antd';
import { ActionIcon } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import type { CLIDevelopmentTask, CLITaskStatus } from '@/config/cliTasks';
import { filterDevelopmentTasks } from '@/config/cliTasks';
import { useAIMemberStore } from '@/store/aiMemberStore';

const statusLabels: Record<CLITaskStatus, { label: string; color: string }> = {
  queued: { label: '排队', color: 'default' },
  running: { label: '运行中', color: 'processing' },
  completed: { label: '已完成', color: 'success' },
  failed: { label: '失败', color: 'error' },
  cancelled: { label: '已取消', color: 'warning' },
  timeout: { label: '超时', color: 'error' },
  archived: { label: '已归档', color: 'default' },
};

const SIDEBAR_WIDTH = 296;

const useStyles = createStyles(({ token, css }) => ({
  container: css`
    height: 100%;
    border-right: 1px solid ${token.colorBorderSecondary};
    background: ${token.colorBgLayout};
    overflow: hidden;
    display: flex;
    flex-direction: column;
    transition: width 0.3s ease, min-width 0.3s ease;
    width: ${SIDEBAR_WIDTH}px;
    min-width: ${SIDEBAR_WIDTH}px;
  `,
  containerCollapsed: css`
    width: 0;
    min-width: 0;
    border-right: none;
  `,
  headerRow: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 14px 8px;
    flex: none;
  `,
  title: css`
    font-size: 14px;
    font-weight: 600;
    color: ${token.colorText};
  `,
  subtitle: css`
    margin-top: 2px;
    font-size: 11px;
    color: ${token.colorTextTertiary};
  `,
  topActions: css`
    padding: 0 14px 8px;
    display: grid;
    grid-template-columns: 1fr 34px;
    gap: 8px;
    flex: none;
  `,
  searchWrapper: css`
    padding: 0 14px 8px;
    flex: none;
  `,
  toolbar: css`
    padding: 0 14px 8px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex: none;
  `,
  filterToggle: css`
    height: 28px;
    border-radius: 8px;
    border: 1px solid ${token.colorBorderSecondary};
    background: ${token.colorBgContainer};
    color: ${token.colorTextSecondary};
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 0 9px;
    font-size: 11px;
    &:hover {
      border-color: #ff6600;
      color: #ff6600;
    }
  `,
  filterToggleActive: css`
    border-color: rgba(255, 102, 0, 0.45);
    background: rgba(255, 102, 0, 0.08);
    color: #c2410c;
  `,
  filterBadge: css`
    min-width: 16px;
    height: 16px;
    padding: 0 5px;
    border-radius: 999px;
    background: #ff6600;
    color: #fff;
    font-size: 10px;
    line-height: 16px;
    text-align: center;
  `,
  filterRow: css`
    margin: 0 14px 10px;
    padding: 10px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 8px;
    background: ${token.colorBgContainer};
    display: flex;
    flex-direction: column;
    gap: 8px;
    flex: none;
  `,
  filterHeader: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    font-size: 12px;
    font-weight: 600;
    color: ${token.colorText};
  `,
  filterField: css`
    display: flex;
    flex-direction: column;
    gap: 4px;
  `,
  filterFieldLabel: css`
    font-size: 10px;
    color: ${token.colorTextTertiary};
  `,
  navList: css`
    flex: 1;
    overflow: auto;
    padding: 4px 10px 10px;
  `,
  navItem: css`
    display: flex;
    flex-direction: column;
    gap: 7px;
    padding: 11px 12px;
    border-radius: 8px;
    border: 1px solid transparent;
    cursor: pointer;
    color: ${token.colorTextSecondary};
    transition: all 0.15s ease;
    margin-bottom: 6px;
    &:hover {
      background: ${token.colorBgContainer};
      border-color: ${token.colorBorderSecondary};
      color: ${token.colorText};
    }
  `,
  navItemActive: css`
    background: ${token.colorBgContainer} !important;
    border-color: rgba(255, 102, 0, 0.45) !important;
    box-shadow: inset 3px 0 0 #ff6600;
    color: ${token.colorText} !important;
  `,
  taskTitle: css`
    font-size: 13px;
    font-weight: 600;
    color: ${token.colorText};
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  taskStatus: css`
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 10px;
    color: ${token.colorTextTertiary};
  `,
  statusDot: css`
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: ${token.colorTextQuaternary};
  `,
  statusDotRunning: css`
    background: ${token.colorInfo};
    box-shadow: 0 0 0 3px ${token.colorInfoBg};
  `,
  statusDotCompleted: css`
    background: ${token.colorSuccess};
  `,
  statusDotFailed: css`
    background: ${token.colorError};
  `,
  statusDotWarning: css`
    background: ${token.colorWarning};
  `,
  taskMeta: css`
    font-size: 11px;
    color: ${token.colorTextTertiary};
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  taskMetaRow: css`
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  `,
  taskTemplate: css`
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  taskWorkspace: css`
    font-family: ${token.fontFamilyCode};
    font-size: 10px;
    color: ${token.colorTextQuaternary};
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  empty: css`
    text-align: center;
    padding: 36px 16px;
    font-size: 12px;
    color: ${token.colorTextTertiary};
    line-height: 1.6;
    white-space: pre-line;
  `,
  linkBtn: css`
    border: none;
    background: transparent;
    font-size: 11px;
    color: ${token.colorTextTertiary};
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 0;
    &:hover {
      color: #ff6600;
    }
  `,
  iconBtn: css`
    width: 34px;
    height: 34px;
    border-radius: 8px;
    border: 1px solid ${token.colorBorderSecondary};
    background: ${token.colorBgContainer};
    color: ${token.colorTextSecondary};
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    &:hover {
      border-color: #ff6600;
      color: #ff6600;
    }
  `,
}));

interface CLITaskSidebarProps {
  isOpen: boolean;
  toggleSidebar: () => void;
  tasks: CLIDevelopmentTask[];
  selectedTaskId: string | null;
  onSelectTask: (taskId: string) => void;
  onNewTask: () => void;
  onOpenTemplateList: () => void;
}

export const CLITaskSidebar = ({
  isOpen,
  toggleSidebar,
  tasks,
  selectedTaskId,
  onSelectTask,
  onNewTask,
  onOpenTemplateList,
}: CLITaskSidebarProps) => {
  const { styles, cx } = useStyles();
  const aiMembers = useAIMemberStore(s => s.members);
  const [searchQuery, setSearchQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [statusFilter, setStatusFilter] = useState<CLITaskStatus | 'all'>('all');
  const [templateFilter, setTemplateFilter] = useState<string>('');
  const [workspaceFilter, setWorkspaceFilter] = useState<string>('');
  const [agentFilter, setAgentFilter] = useState<string>('');
  const [showArchived, setShowArchived] = useState(false);

  const templateOptions = Array.from(
    new Map(tasks.map(t => [t.templateId, t.templateSnapshot.name])).entries(),
  );

  const workspaceOptions = useMemo(() => {
    const paths = new Set<string>();
    for (const task of tasks) {
      if (task.workspacePath) paths.add(task.workspacePath);
    }
    return Array.from(paths).sort().map(path => ({ value: path, label: path }));
  }, [tasks]);

  const agentOptions = useMemo(() => {
    const ids = new Set<string>();
    for (const task of tasks) {
      for (const id of task.templateSnapshot.memberIds) ids.add(id);
      for (const message of task.messages) {
        if (message.agentId) ids.add(message.agentId);
      }
    }
    return Array.from(ids)
      .map(id => ({
        value: id,
        label: aiMembers[id]?.name || id.replace(/^cli-/, ''),
      }))
      .sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'));
  }, [tasks, aiMembers]);

  const hasActiveFilters = statusFilter !== 'all'
    || !!templateFilter
    || !!workspaceFilter
    || !!agentFilter;

  const activeFilterCount = [
    statusFilter !== 'all',
    !!templateFilter,
    !!workspaceFilter,
    !!agentFilter,
  ].filter(Boolean).length;

  const filteredTasks = filterDevelopmentTasks(tasks, {
    search: searchQuery,
    status: statusFilter,
    templateId: templateFilter || undefined,
    workspacePath: workspaceFilter || undefined,
    agentId: agentFilter || undefined,
    showArchived,
  });

  const formatTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleString(undefined, {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '';
    }
  };

  const shortPath = (path: string) => {
    if (!path) return '';
    const parts = path.split('/').filter(Boolean);
    if (parts.length <= 2) return path;
    return `.../${parts.slice(-2).join('/')}`;
  };

  const resetFilters = () => {
    setStatusFilter('all');
    setTemplateFilter('');
    setWorkspaceFilter('');
    setAgentFilter('');
  };

  const statusDotClass = (status: CLITaskStatus) => {
    if (status === 'running' || status === 'queued') return styles.statusDotRunning;
    if (status === 'completed') return styles.statusDotCompleted;
    if (status === 'failed' || status === 'timeout') return styles.statusDotFailed;
    if (status === 'cancelled') return styles.statusDotWarning;
    return '';
  };

  return (
    <div className={cx(styles.container, !isOpen && styles.containerCollapsed)}>
      {isOpen && (
        <>
          <div className={styles.headerRow}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Terminal size={16} color="#ff6600" />
              <div>
                <span className={styles.title}>开发任务</span>
                <div className={styles.subtitle}>任务队列与历史记录</div>
              </div>
            </div>
            <ActionIcon icon={PanelLeftClose} size="small" onClick={toggleSidebar} title="" />
          </div>

          <div className={styles.topActions}>
            <Button
              type="primary"
              block
              icon={<Plus size={14} />}
              onClick={onNewTask}
              style={{ background: '#ff6600', borderColor: '#ff6600', height: 36, borderRadius: 10 }}
            >
              新建任务
            </Button>
            <Tooltip title="团队模板">
              <button type="button" className={styles.iconBtn} onClick={onOpenTemplateList}>
                <Users size={15} />
              </button>
            </Tooltip>
          </div>

          <div className={styles.searchWrapper}>
            <Input
              size="small"
              placeholder="搜索任务..."
              prefix={<Search size={14} style={{ opacity: 0.6 }} />}
              suffix={
                searchQuery ? (
                  <X size={12} onClick={() => setSearchQuery('')} style={{ cursor: 'pointer' }} />
                ) : (
                  <span />
                )
              }
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ borderRadius: 10, height: 34 }}
            />
          </div>

          <div className={styles.toolbar}>
            <button
              type="button"
              className={cx(styles.filterToggle, (showFilters || hasActiveFilters) && styles.filterToggleActive)}
              onClick={() => setShowFilters(v => !v)}
            >
              <SlidersHorizontal size={12} />
              筛选
              {activeFilterCount > 0 && <span className={styles.filterBadge}>{activeFilterCount}</span>}
            </button>
            <span className={styles.taskMeta}>{filteredTasks.length} / {tasks.length}</span>
          </div>

          {showFilters && (
            <div className={styles.filterRow}>
              <div className={styles.filterHeader}>
                <span>筛选任务</span>
                {hasActiveFilters && (
                  <button type="button" className={styles.linkBtn} onClick={resetFilters}>
                    清除
                  </button>
                )}
              </div>
              <div className={styles.filterField}>
                <span className={styles.filterFieldLabel}>状态</span>
                <Select
                  size="small"
                  value={statusFilter}
                  onChange={setStatusFilter}
                  style={{ width: '100%' }}
                  options={[
                    { value: 'all', label: '全部状态' },
                    { value: 'running', label: '运行中' },
                    { value: 'queued', label: '排队' },
                    { value: 'completed', label: '已完成' },
                    { value: 'failed', label: '失败' },
                    { value: 'cancelled', label: '已取消' },
                    { value: 'timeout', label: '超时' },
                    { value: 'archived', label: '已归档' },
                  ]}
                />
              </div>
              <div className={styles.filterField}>
                <span className={styles.filterFieldLabel}>模板</span>
                <Select
                  size="small"
                  value={templateFilter || undefined}
                  placeholder="全部模板"
                  allowClear
                  onChange={(v) => setTemplateFilter(v || '')}
                  style={{ width: '100%' }}
                  options={templateOptions.map(([id, name]) => ({ value: id, label: name }))}
                />
              </div>
              <div className={styles.filterField}>
                <span className={styles.filterFieldLabel}>Workspace</span>
                <Select
                  size="small"
                  value={workspaceFilter || undefined}
                  placeholder="全部 Workspace"
                  allowClear
                  onChange={(v) => setWorkspaceFilter(v || '')}
                  style={{ width: '100%' }}
                  options={workspaceOptions}
                />
              </div>
              <div className={styles.filterField}>
                <span className={styles.filterFieldLabel}>开发群友</span>
                <Select
                  size="small"
                  value={agentFilter || undefined}
                  placeholder="全部开发群友"
                  allowClear
                  onChange={(v) => setAgentFilter(v || '')}
                  style={{ width: '100%' }}
                  options={agentOptions}
                />
              </div>
              <Checkbox
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
                style={{ fontSize: 11 }}
              >
                显示已归档
              </Checkbox>
            </div>
          )}

          <nav className={styles.navList}>
            {filteredTasks.length === 0 && (
              <div className={styles.empty}>
                {searchQuery || hasActiveFilters
                  ? '未找到匹配任务'
                  : '还没有历史任务\n直接在右侧输入框开始第一个任务'}
              </div>
            )}
            {filteredTasks.map(task => {
              const statusInfo = statusLabels[task.status] || statusLabels.queued;
              const isSelected = selectedTaskId === task.id;
              const workspace = shortPath(task.workspacePath);
              return (
                <div
                  key={task.id}
                  className={cx(styles.navItem, isSelected && styles.navItemActive)}
                  onClick={() => onSelectTask(task.id)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                    <span className={styles.taskTitle}>{task.title}</span>
                    <span className={styles.taskStatus}>
                      <span className={cx(styles.statusDot, statusDotClass(task.status))} />
                      {statusInfo.label}
                    </span>
                  </div>
                  <div className={styles.taskMetaRow}>
                    <span className={styles.taskTemplate}>{task.templateSnapshot.name}</span>
                    <span className={styles.taskMeta}>·</span>
                    <Clock3 size={11} style={{ flex: 'none', opacity: 0.55 }} />
                    <span className={styles.taskMeta}>{formatTime(task.updatedAt)}</span>
                    {task.status === 'archived' && <Archive size={11} style={{ flex: 'none', opacity: 0.55 }} />}
                  </div>
                  {workspace && (
                    <div className={styles.taskWorkspace} title={task.workspacePath}>
                      {workspace}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>
        </>
      )}
    </div>
  );
};

export default CLITaskSidebar;
