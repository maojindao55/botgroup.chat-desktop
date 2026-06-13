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
import { BRAND_ON_PRIMARY, brandPrimaryButtonStyle } from '@/lib/theme';
import { ActionIcon } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { useTranslation } from 'react-i18next';
import { formatLocaleDateTime } from '@/i18n/formatLocale';
import type { CLIDevelopmentTask, CLITaskStatus } from '@/config/cliTasks';
import { canMutateTask, filterDevelopmentTasks, getTaskDisplayStatus } from '@/config/cliTasks';

const SIDEBAR_WIDTH = 296;

const useStyles = createStyles(({ token, css }) => ({
  container: css`
    height: 100%;
    border-right: 1px solid ${token.colorBorder};
    background: ${token.colorBgContainer};
    box-shadow: 1px 0 0 rgba(0, 0, 0, 0.02);
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
    gap: 8px;
    height: 46px;
    box-sizing: border-box;
    padding: 0 10px 0 12px;
    border-bottom: 1px solid ${token.colorBorder};
    background: ${token.colorBgContainer};
    flex: none;
  `,
  title: css`
    font-size: 14px;
    font-weight: 600;
    line-height: 20px;
    color: ${token.colorText};
  `,
  topActions: css`
    padding: 8px 8px 6px;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
    flex: none;

    .ant-btn {
      min-width: 0;
    }

    .ant-btn > span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `,
  searchWrapper: css`
    padding: 0 8px 7px;
    flex: none;
  `,
  toolbar: css`
    padding: 0 8px 7px;
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
    padding: 4px 7px 10px;
  `,
  navItem: css`
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 9px;
    border-radius: 7px;
    background: transparent;
    border: 1px solid transparent;
    cursor: pointer;
    color: ${token.colorTextSecondary};
    transition: all 0.15s ease;
    margin-bottom: 4px;
    overflow: hidden;
    &:hover {
      background: ${token.colorFillQuaternary};
      color: ${token.colorText};
      .taskDeleteBtn {
        opacity: 1;
      }
    }
  `,
  navItemActive: css`
    background: ${token.colorFillQuaternary} !important;
    border-color: ${token.colorBorderSecondary} !important;
    color: ${token.colorText} !important;
    &::before {
      content: '';
      position: absolute;
      left: 0;
      top: 7px;
      bottom: 7px;
      width: 3px;
      border-radius: 999px;
      background: #ff6600;
    }
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
    width: 22px;
    height: 22px;
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
    line-height: 18px;
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
    border-radius: 5px;
    background: ${token.colorFillQuaternary};
    color: ${token.colorTextSecondary};
    border: 1px solid ${token.colorBorderSecondary};
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
  const { t, i18n } = useTranslation(['cli']);
  const [searchQuery, setSearchQuery] = useState('');

  const statusLabels: Record<CLITaskStatus, { label: string; color: string }> = useMemo(() => ({
    queued: { label: t('cli:status.queued'), color: 'default' },
    running: { label: t('cli:status.running'), color: 'processing' },
    completed: { label: t('cli:status.completed'), color: 'success' },
    failed: { label: t('cli:status.failed'), color: 'error' },
    cancelled: { label: t('cli:status.cancelled'), color: 'warning' },
    timeout: { label: t('cli:status.timeout'), color: 'error' },
    archived: { label: t('cli:status.archived'), color: 'default' },
  }), [i18n.language]);

  const filteredTasks = useMemo(() => {
    return filterDevelopmentTasks(tasks, {
      search: searchQuery,
      showArchived: false,
    });
  }, [tasks, searchQuery]);

  const formatTime = (iso: string) =>
    formatLocaleDateTime(iso, {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

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
              <span className={styles.title}>{t('cli:taskSidebar.title')}</span>
            </div>
            <ActionIcon icon={PanelLeftClose} size="small" onClick={toggleSidebar} title="" />
          </div>

          <div className={styles.topActions}>
            <Button
              icon={<Plus size={14} color={BRAND_ON_PRIMARY} />}
              onClick={onNewTask}
              style={{ ...brandPrimaryButtonStyle, height: 32, borderRadius: 7 }}
              styles={{
                content: { color: BRAND_ON_PRIMARY },
                icon: { color: BRAND_ON_PRIMARY },
              }}
            >
              {t('cli:taskSidebar.newTask')}
            </Button>
            <Button
              icon={<Users size={14} />}
              onClick={onOpenTemplateList}
              style={{ height: 32, borderRadius: 7 }}
            >
              {t('cli:taskSidebar.teamTemplates')}
            </Button>
          </div>

          <div className={styles.searchWrapper}>
            <Input
              size="small"
              placeholder={t('cli:taskSidebar.searchPlaceholder')}
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
              style={{ borderRadius: 7, height: 30 }}
            />
          </div>

          <nav className={styles.navList}>
            {filteredTasks.length === 0 && (
              <div className={styles.empty}>
                {searchQuery
                  ? t('cli:taskSidebar.emptySearch')
                  : t('cli:taskSidebar.empty')}
              </div>
            )}
            {filteredTasks.map(task => {
              const displayStatus = getTaskDisplayStatus(task);
              const statusInfo = statusLabels[displayStatus] || statusLabels.queued;
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
                        <span className={cx(styles.statusDot, statusDotClass(displayStatus))} />
                        {statusInfo.label}
                      </span>
                    </div>
                    {onDeleteTask && (
                      <Tooltip title={canDelete ? t('cli:taskSidebar.deleteTask') : t('cli:taskSidebar.deleteTaskRunning')}>
                        <button
                          type="button"
                          className={cx(
                            styles.taskDeleteBtn,
                            'taskDeleteBtn',
                            (isSelected || !canDelete) && styles.taskDeleteBtnVisible,
                          )}
                          disabled={!canDelete}
                          aria-label={t('cli:taskSidebar.deleteTaskAria')}
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
