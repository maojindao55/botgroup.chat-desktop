import { useState } from 'react';
import {
  Plus,
  Search,
  Terminal,
  X,
  PanelLeftClose,
  Menu as MenuIcon,
  SlidersHorizontal,
  Users,
} from 'lucide-react';
import { Input, Tag, Tooltip, Select, Checkbox, Button } from 'antd';
import { ActionIcon } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import type { CLIDevelopmentTask, CLITaskStatus, CLITeamTemplate } from '@/config/cliTasks';
import { filterDevelopmentTasks } from '@/config/cliTasks';

const statusLabels: Record<CLITaskStatus, { label: string; color: string }> = {
  queued: { label: '排队', color: 'default' },
  running: { label: '运行中', color: 'processing' },
  completed: { label: '已完成', color: 'success' },
  failed: { label: '失败', color: 'error' },
  cancelled: { label: '已取消', color: 'warning' },
  timeout: { label: '超时', color: 'error' },
  archived: { label: '已归档', color: 'default' },
};

const useStyles = createStyles(({ token, css }) => ({
  container: css`
    height: 100%;
    border-right: 1px solid ${token.colorBorderSecondary};
    background: ${token.colorBgLayout};
    overflow: hidden;
    display: flex;
    flex-direction: column;
    transition: width 0.3s ease;
  `,
  headerRow: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 12px 8px;
    flex: none;
  `,
  title: css`
    font-size: 13px;
    font-weight: 600;
    color: ${token.colorText};
  `,
  topActions: css`
    padding: 0 12px 8px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    flex: none;
  `,
  searchWrapper: css`
    padding: 0 12px 8px;
    flex: none;
  `,
  toolbar: css`
    padding: 0 12px 8px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex: none;
  `,
  filterRow: css`
    padding: 0 12px 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex: none;
  `,
  navList: css`
    flex: 1;
    overflow: auto;
    padding: 4px 8px 8px;
  `,
  navItem: css`
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 10px 12px;
    border-radius: 10px;
    cursor: pointer;
    color: ${token.colorTextSecondary};
    transition: all 0.15s ease;
    margin-bottom: 4px;
    &:hover {
      background: ${token.colorFillTertiary};
      color: ${token.colorText};
    }
  `,
  navItemActive: css`
    background: rgba(255, 102, 0, 0.1) !important;
    color: #ff6600 !important;
  `,
  taskTitle: css`
    font-size: 13px;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  taskMeta: css`
    font-size: 10px;
    opacity: 0.6;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  empty: css`
    text-align: center;
    padding: 32px 16px;
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
  const [searchQuery, setSearchQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [statusFilter, setStatusFilter] = useState<CLITaskStatus | 'all'>('all');
  const [templateFilter, setTemplateFilter] = useState<string>('');
  const [showArchived, setShowArchived] = useState(false);

  const templateOptions = Array.from(
    new Map(tasks.map(t => [t.templateId, t.templateSnapshot.name])).entries(),
  );

  const filteredTasks = filterDevelopmentTasks(tasks, {
    search: searchQuery,
    status: statusFilter,
    templateId: templateFilter || undefined,
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

  return (
    <div
      style={{ width: isOpen ? 240 : 0, minWidth: isOpen ? 240 : 0 }}
      className={styles.container}
    >
      {isOpen && (
        <>
          <div className={styles.headerRow}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Terminal size={16} color="#ff6600" />
              <span className={styles.title}>开发任务</span>
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
              className={styles.linkBtn}
              onClick={() => setShowFilters(v => !v)}
            >
              <SlidersHorizontal size={12} />
              筛选{showFilters ? '' : (statusFilter !== 'all' || templateFilter ? ' ·' : '')}
            </button>
            <button type="button" className={styles.linkBtn} onClick={onOpenTemplateList}>
              <Users size={12} />
              团队模板
            </button>
          </div>

          {showFilters && (
            <div className={styles.filterRow}>
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
              <Select
                size="small"
                value={templateFilter || undefined}
                placeholder="全部模板"
                allowClear
                onChange={(v) => setTemplateFilter(v || '')}
                style={{ width: '100%' }}
                options={templateOptions.map(([id, name]) => ({ value: id, label: name }))}
              />
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
                {searchQuery || statusFilter !== 'all' || templateFilter
                  ? '未找到匹配任务'
                  : '还没有历史任务\n直接在右侧输入框开始第一个任务'}
              </div>
            )}
            {filteredTasks.map(task => {
              const statusInfo = statusLabels[task.status] || statusLabels.queued;
              const isSelected = selectedTaskId === task.id;
              return (
                <div
                  key={task.id}
                  className={cx(styles.navItem, isSelected && styles.navItemActive)}
                  onClick={() => onSelectTask(task.id)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                    <span className={styles.taskTitle}>{task.title}</span>
                    <Tag color={statusInfo.color} style={{ margin: 0, fontSize: 10, lineHeight: '16px' }}>
                      {statusInfo.label}
                    </Tag>
                  </div>
                  <span className={styles.taskMeta}>
                    {task.templateSnapshot.name} · {formatTime(task.updatedAt)}
                  </span>
                </div>
              );
            })}
          </nav>
        </>
      )}

      {!isOpen && (
        <div style={{ padding: 8, display: 'flex', justifyContent: 'center' }}>
          <Tooltip title="展开任务列表" placement="right">
            <ActionIcon icon={MenuIcon} size="small" onClick={toggleSidebar} title="" />
          </Tooltip>
        </div>
      )}
    </div>
  );
};

export default CLITaskSidebar;
