import { useState } from 'react';
import {
  PlusCircle,
  Search,
  Terminal,
  X,
  PanelLeftClose,
  Menu as MenuIcon,
  Settings2,
  Users,
} from 'lucide-react';
import { Input, Tag, Tooltip } from 'antd';
import { ActionIcon } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import type { CLIDevelopmentTask, CLITaskStatus, CLITeamTemplate } from '@/config/cliTasks';

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
    padding: 14px 12px;
    border-bottom: 1px solid ${token.colorBorderSecondary};
    flex: none;
  `,
  title: css`
    font-size: 13px;
    font-weight: 600;
    color: ${token.colorText};
  `,
  searchWrapper: css`
    padding: 12px 12px 4px;
    flex: none;
  `,
  navList: css`
    flex: 1;
    overflow: auto;
    padding: 8px;
  `,
  navItem: css`
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 10px 12px;
    border-radius: 12px;
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
  createBtn: css`
    margin: 8px 12px 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 8px 12px;
    border-radius: 10px;
    border: 1px dashed ${token.colorBorderSecondary};
    background: transparent;
    color: ${token.colorTextSecondary};
    font-size: 12px;
    cursor: pointer;
    &:hover {
      border-color: #ff6600;
      color: #ff6600;
      background: rgba(255, 102, 0, 0.05);
    }
  `,
  empty: css`
    text-align: center;
    padding: 24px 16px;
    font-size: 12px;
    color: ${token.colorTextTertiary};
  `,
  newTaskPanel: css`
    padding: 12px;
    border-top: 1px solid ${token.colorBorderSecondary};
    display: flex;
    flex-direction: column;
    gap: 8px;
  `,
  templateBtn: css`
    text-align: left;
    padding: 8px 10px;
    border-radius: 8px;
    border: 1px solid ${token.colorBorderSecondary};
    background: ${token.colorBgContainer};
    cursor: pointer;
    font-size: 11px;
    &:hover {
      border-color: #ff6600;
    }
  `,
  templateBtnActive: css`
    border-color: #ff6600;
    background: rgba(255, 102, 0, 0.06);
  `,
  templateRow: css`
    display: flex;
    align-items: stretch;
    gap: 6px;
  `,
  templateSettingsBtn: css`
    flex: none;
    width: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    border: 1px solid ${token.colorBorderSecondary};
    background: ${token.colorBgContainer};
    cursor: pointer;
    color: ${token.colorTextTertiary};
    &:hover {
      border-color: #ff6600;
      color: #ff6600;
    }
  `,
  footerActions: css`
    padding: 0 12px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    flex: none;
  `,
}));

interface CLITaskSidebarProps {
  isOpen: boolean;
  toggleSidebar: () => void;
  tasks: CLIDevelopmentTask[];
  selectedTaskId: string | null;
  onSelectTask: (taskId: string) => void;
  templates: CLITeamTemplate[];
  selectedTemplateId: string;
  onSelectTemplate: (templateId: string) => void;
  onStartNewTask: () => void;
  showNewTaskPanel: boolean;
  onToggleNewTaskPanel: (open: boolean) => void;
  onManageTemplate: (templateId?: string) => void;
}

export const CLITaskSidebar = ({
  isOpen,
  toggleSidebar,
  tasks,
  selectedTaskId,
  onSelectTask,
  templates,
  selectedTemplateId,
  onSelectTemplate,
  onStartNewTask,
  showNewTaskPanel,
  onToggleNewTaskPanel,
  onManageTemplate,
}: CLITaskSidebarProps) => {
  const { styles, cx } = useStyles();
  const [searchQuery, setSearchQuery] = useState('');

  const filteredTasks = tasks.filter(t =>
    t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.prompt.toLowerCase().includes(searchQuery.toLowerCase()),
  );

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
      style={{ width: isOpen ? 220 : 0, minWidth: isOpen ? 220 : 0 }}
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

          {isOpen && (
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
                style={{ borderRadius: 12, height: 32 }}
              />
            </div>
          )}

          <nav className={styles.navList}>
            {filteredTasks.length === 0 && (
              <div className={styles.empty}>
                {searchQuery ? '未找到匹配任务' : '还没有开发任务\n点击下方创建第一个'}
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

          <div className={styles.footerActions}>
            <button
              className={styles.createBtn}
              onClick={() => onToggleNewTaskPanel(!showNewTaskPanel)}
              style={{ margin: 0 }}
            >
              <PlusCircle size={14} />
              新建任务
            </button>

            <button
              className={styles.createBtn}
              onClick={() => onManageTemplate()}
              style={{ margin: 0 }}
            >
              <Users size={14} />
              团队模板
            </button>
          </div>

          {showNewTaskPanel && templates.length > 0 && (
            <div className={styles.newTaskPanel}>
              <div style={{ fontSize: 11, fontWeight: 500, opacity: 0.7 }}>选择团队模板</div>
              {templates.map(t => (
                <div key={t.id} className={styles.templateRow}>
                  <button
                    className={cx(
                      styles.templateBtn,
                      selectedTemplateId === t.id && styles.templateBtnActive,
                    )}
                    style={{ flex: 1 }}
                    onClick={() => onSelectTemplate(t.id)}
                  >
                    <div style={{ fontWeight: 500 }}>{t.name}</div>
                    <div style={{ opacity: 0.6, marginTop: 2 }}>{t.description.slice(0, 60)}</div>
                  </button>
                  <button
                    type="button"
                    className={styles.templateSettingsBtn}
                    title="模板设置"
                    onClick={(e) => {
                      e.stopPropagation();
                      onManageTemplate(t.id);
                    }}
                  >
                    <Settings2 size={14} />
                  </button>
                </div>
              ))}
              <button className={styles.createBtn} onClick={onStartNewTask} style={{ margin: 0 }}>
                开始输入任务
              </button>
            </div>
          )}
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
