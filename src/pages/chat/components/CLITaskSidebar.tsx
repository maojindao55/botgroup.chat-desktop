import { useState, useMemo } from 'react';
import {
  Plus,
  Search,
  Terminal,
  X,
  PanelLeftClose,
  Users,
  Archive,
  Clock3,
  Trash2,
} from 'lucide-react';
import { Input, Tooltip, Button } from 'antd';
import { ActionIcon } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import type { CLIDevelopmentTask, CLITaskStatus } from '@/config/cliTasks';
import { canMutateTask, filterDevelopmentTasks } from '@/config/cliTasks';
import { useAIMemberStore } from '@/store/aiMemberStore';
import { resolveEffectiveMember } from '@/utils/aiMemberDisplay';

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
    grid-template-columns: 1fr 1fr;
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
    background: ${token.colorBgContainer};
    border: 1px solid ${token.colorBorderSecondary};
    cursor: pointer;
    color: ${token.colorTextSecondary};
    transition: all 0.15s ease;
    margin-bottom: 6px;
    &:hover {
      border-color: rgba(255, 102, 0, 0.35);
      color: ${token.colorText};
      .taskDeleteBtn {
        opacity: 1;
      }
    }
  `,
  navItemActive: css`
    background: ${token.colorBgContainer} !important;
    border-color: rgba(255, 102, 0, 0.45) !important;
    box-shadow: inset 3px 0 0 #ff6600;
    color: ${token.colorText} !important;
  `,
  taskTitleRow: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    min-width: 0;
  `,
  taskTitleWrap: css`
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    flex: 1;
  `,
  taskDeleteBtn: css`
    flex: none;
    width: 24px;
    height: 24px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: ${token.colorTextTertiary};
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: opacity 0.15s ease, color 0.15s ease, background 0.15s ease;
    &:hover:not(:disabled) {
      color: #ff4d4f;
      background: ${token.colorErrorBg};
    }
    &:disabled {
      cursor: not-allowed;
      opacity: 0.35;
    }
  `,
  taskDeleteBtnVisible: css`
    opacity: 1;
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
    gap: 8px;
    min-width: 0;
  `,
  taskTemplateTag: css`
    flex: none;
    max-width: calc(100% - 88px);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 10px;
    font-weight: 500;
    line-height: 16px;
    padding: 0 6px;
    border-radius: 4px;
    background: rgba(255, 102, 0, 0.06);
    color: ${token.colorTextSecondary};
    border: 1px solid rgba(255, 102, 0, 0.14);
    letter-spacing: 0.01em;
  `,
  taskTimeMeta: css`
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex: none;
    font-size: 10px;
    color: ${token.colorTextTertiary};
    white-space: nowrap;
    margin-left: auto;
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
  onDeleteTask?: (taskId: string) => void;
}

export const CLITaskSidebar = ({
  isOpen,
  toggleSidebar,
  tasks,
  selectedTaskId,
  onSelectTask,
  onNewTask,
  onOpenTemplateList,
  onDeleteTask,
}: CLITaskSidebarProps) => {
  const { styles, cx } = useStyles();
  const aiMembers = useAIMemberStore(s => s.members);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredTasks = useMemo(() => {
    return filterDevelopmentTasks(tasks, {
      search: searchQuery,
      showArchived: false,
    });
  }, [tasks, searchQuery]);

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
              icon={<Plus size={14} />}
              onClick={onNewTask}
              style={{ background: '#ff6600', borderColor: '#ff6600', height: 36, borderRadius: 10 }}
            >
              新建任务
            </Button>
            <Button
              icon={<Users size={14} />}
              onClick={onOpenTemplateList}
              style={{ height: 36, borderRadius: 10 }}
            >
              团队模板
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

          <nav className={styles.navList}>
            {filteredTasks.length === 0 && (
              <div className={styles.empty}>
                {searchQuery
                  ? '未找到匹配任务'
                  : '还没有历史任务\n直接在右侧开始新建任务'}
              </div>
            )}
            {filteredTasks.map(task => {
              const statusInfo = statusLabels[task.status] || statusLabels.queued;
              const isSelected = selectedTaskId === task.id;
              const canDelete = canMutateTask(task);
              return (
                <div
                  key={task.id}
                  className={cx(styles.navItem, isSelected && styles.navItemActive)}
                  onClick={() => onSelectTask(task.id)}
                >
                  <div className={styles.taskTitleRow}>
                    <div className={styles.taskTitleWrap}>
                      <span className={styles.taskTitle}>{task.title}</span>
                      <span className={styles.taskStatus}>
                        <span className={cx(styles.statusDot, statusDotClass(task.status))} />
                        {statusInfo.label}
                      </span>
                    </div>
                    {onDeleteTask && (
                      <Tooltip title={canDelete ? '删除任务' : '任务运行中，无法删除'}>
                        <button
                          type="button"
                          className={cx(
                            styles.taskDeleteBtn,
                            'taskDeleteBtn',
                            (isSelected || !canDelete) && styles.taskDeleteBtnVisible,
                          )}
                          disabled={!canDelete}
                          aria-label="删除任务"
                          onClick={(event) => {
                            event.stopPropagation();
                            if (canDelete) onDeleteTask(task.id);
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </Tooltip>
                    )}
                  </div>
                  <div className={styles.taskMetaRow}>
                    <span className={styles.taskTemplateTag} title={task.templateSnapshot.name}>
                      {task.templateSnapshot.name}
                    </span>
                    <span className={styles.taskTimeMeta}>
                      <Clock3 size={10} style={{ opacity: 0.65 }} />
                      {formatTime(task.updatedAt)}
                    </span>
                    {task.status === 'archived' && (
                      <Archive size={10} style={{ flex: 'none', opacity: 0.55, color: 'inherit' }} />
                    )}
                  </div>
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
