/**
 * 开发任务信息面板 — 只读展示任务元数据与创建时的 templateSnapshot
 */
import { Drawer, Tag, Button } from 'antd';
import { X } from 'lucide-react';
import { createStyles } from 'antd-style';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { formatLocaleDateTime } from '@/i18n/formatLocale';
import { cliWorkflowTemplates } from '@/config/groupProduct';
import type { CLIDevelopmentTask, CLITaskStatus } from '@/config/cliTasks';
import { canMutateTask, getTaskDisplayStatus } from '@/config/cliTasks';
import type { AIMember } from '@/config/aiMembers';

const useStyles = createStyles(({ token, css }) => ({
  inlinePanel: css`
    height: 100%;
    display: flex;
    flex-direction: column;
    background: ${token.colorBgContainer};
    border-left: 1px solid ${token.colorBorderSecondary};
  `,
  inlineHeader: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: nowrap;
    gap: 8px;
    padding: 14px 16px;
    border-bottom: 1px solid ${token.colorBorderSecondary};
    flex: none;
  `,
  inlineTitle: css`
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 14px;
    font-weight: 600;
  `,
  inlineCloseBtn: css`
    flex-shrink: 0;
    border: none;
    background: transparent;
    cursor: pointer;
    opacity: 0.6;
    display: flex;
    padding: 4px;
    &:hover { opacity: 1; }
  `,
  content: css`
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  `,
  section: css`
    background: ${token.colorFillTertiary};
    border-radius: 12px;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  `,
  sectionTitle: css`
    font-size: 13px;
    font-weight: 600;
    color: ${token.colorText};
  `,
  row: css`
    display: flex;
    flex-direction: column;
    gap: 2px;
  `,
  label: css`
    font-size: 11px;
    color: ${token.colorTextTertiary};
  `,
  value: css`
    font-size: 13px;
    color: ${token.colorText};
    word-break: break-all;
  `,
  memberList: css`
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  `,
  memberChip: css`
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 999px;
    background: ${token.colorFillSecondary};
    color: ${token.colorTextSecondary};
  `,
  hint: css`
    font-size: 11px;
    color: ${token.colorTextTertiary};
    line-height: 1.5;
  `,
  actionBtn: css`
    margin-top: 4px;
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px solid ${token.colorBorderSecondary};
    background: transparent;
    font-size: 12px;
    cursor: pointer;
    text-align: left;
    &:hover {
      border-color: #ff6600;
      color: #ff6600;
    }
  `,
  actionRow: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
  `,
  dangerBtn: css`
    border-color: ${token.colorErrorBorder};
    color: ${token.colorError};
    &:hover {
      border-color: ${token.colorError};
      color: ${token.colorError};
    }
  `,
}));

interface CLITaskInfoPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: CLIDevelopmentTask | null;
  members: Record<string, AIMember>;
  inline?: boolean;
  onCreateTaskFromThis?: () => void;
  onArchiveTask?: () => void;
  onRestoreTask?: () => void;
  onDeleteTask?: () => void;
}

function formatDateTime(iso: string) {
  return formatLocaleDateTime(iso, {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const CLITaskInfoPanel = ({
  open,
  onOpenChange,
  task,
  members,
  inline,
  onCreateTaskFromThis,
  onArchiveTask,
  onRestoreTask,
  onDeleteTask,
}: CLITaskInfoPanelProps) => {
  const { styles } = useStyles();
  const { t, i18n } = useTranslation(['cli', 'product']);

  const statusLabels: Record<CLITaskStatus, { label: string; color: string }> = useMemo(() => ({
    queued: { label: t('cli:status.queued'), color: 'default' },
    running: { label: t('cli:status.running'), color: 'processing' },
    completed: { label: t('cli:status.completed'), color: 'success' },
    failed: { label: t('cli:status.failed'), color: 'error' },
    cancelled: { label: t('cli:status.cancelled'), color: 'warning' },
    timeout: { label: t('cli:status.timeout'), color: 'error' },
    archived: { label: t('cli:status.archived'), color: 'default' },
  }), [i18n.language]);

  const strategyLabel = (strategy: string, workflowTemplateId?: string) => {
    const tpl = workflowTemplateId
      ? cliWorkflowTemplates.find(item => item.id === workflowTemplateId)
      : cliWorkflowTemplates.find(item => item.strategy === strategy);
    const fallback = tpl?.label || strategy;
    if (tpl?.id) {
      return t(`product:cliWorkflowTemplates.${tpl.id}.label`, { defaultValue: fallback });
    }
    return fallback;
  };

  const approvalLabel = (mode: 'auto' | 'ask') =>
    mode === 'auto' ? t('cli:taskInfo.approval.auto') : t('cli:taskInfo.approval.ask');

  if (!open || !task) {
    if (inline) return null;
    return (
      <Drawer
        title={t('cli:taskInfo.title')}
        placement="right"
        open={open}
        onClose={() => onOpenChange(false)}
        width={420}
      >
        <div className={styles.hint}>{t('cli:taskInfo.emptyHint')}</div>
      </Drawer>
    );
  }

  const snapshot = task.templateSnapshot;
  const statusInfo = statusLabels[getTaskDisplayStatus(task)] || statusLabels.queued;
  const snapshotMembers = snapshot.memberIds
    .map(id => members[id])
    .filter(Boolean);
  const mutable = canMutateTask(task);

  const body = (
    <div className={styles.content}>
      <div className={styles.hint}>
        {t('cli:taskInfo.snapshotHint')}
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>{t('cli:taskInfo.sectionTask')}</div>
        <div className={styles.row}>
          <span className={styles.label}>{t('cli:taskInfo.fields.title')}</span>
          <span className={styles.value}>{task.title}</span>
        </div>
        <div className={styles.row}>
          <span className={styles.label}>{t('cli:taskInfo.fields.status')}</span>
          <Tag color={statusInfo.color} style={{ width: 'fit-content' }}>{statusInfo.label}</Tag>
        </div>
        <div className={styles.row}>
          <span className={styles.label}>{t('cli:taskInfo.fields.workspace')}</span>
          <span className={styles.value}>{task.workspacePath || t('cli:taskInfo.fields.workspaceUnset')}</span>
        </div>
        <div className={styles.row}>
          <span className={styles.label}>{t('cli:taskInfo.fields.createdAt')}</span>
          <span className={styles.value}>{formatDateTime(task.createdAt)}</span>
        </div>
        <div className={styles.row}>
          <span className={styles.label}>{t('cli:taskInfo.fields.updatedAt')}</span>
          <span className={styles.value}>{formatDateTime(task.updatedAt)}</span>
        </div>
        <div className={styles.row}>
          <span className={styles.label}>{t('cli:taskInfo.fields.template')}</span>
          <span className={styles.value}>{snapshot.name}</span>
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>{t('cli:taskInfo.sectionSnapshot')}</div>
        <div className={styles.row}>
          <span className={styles.label}>{t('cli:taskInfo.fields.members')}</span>
          <div className={styles.memberList}>
            {snapshotMembers.length > 0 ? snapshotMembers.map(m => (
              <span key={m.id} className={styles.memberChip}>{m.name}</span>
            )) : (
              <span className={styles.value}>{t('cli:taskInfo.fields.noMembers')}</span>
            )}
          </div>
        </div>
        <div className={styles.row}>
          <span className={styles.label}>{t('cli:taskInfo.fields.strategy')}</span>
          <span className={styles.value}>{strategyLabel(snapshot.strategy, snapshot.workflowTemplateId)}</span>
        </div>
        <div className={styles.row}>
          <span className={styles.label}>{t('cli:taskInfo.fields.approval')}</span>
          <span className={styles.value}>{approvalLabel(snapshot.approvalMode)}</span>
        </div>
        <div className={styles.row}>
          <span className={styles.label}>{t('cli:taskInfo.fields.timeout')}</span>
          <span className={styles.value}>{t('cli:taskInfo.fields.timeoutValue', { seconds: Math.round(snapshot.timeout / 1000) })}</span>
        </div>
        <div className={styles.row}>
          <span className={styles.label}>{t('cli:taskInfo.fields.stderr')}</span>
          <span className={styles.value}>{snapshot.showStderr ? t('cli:taskInfo.fields.stderrOn') : t('cli:taskInfo.fields.stderrOff')}</span>
        </div>
      </div>

      <div className={styles.actionRow}>
        {onCreateTaskFromThis && (
          <button type="button" className={styles.actionBtn} onClick={onCreateTaskFromThis}>
            {t('cli:taskInfo.actions.fork')}
          </button>
        )}
        {task.status === 'archived' && onRestoreTask && (
          <Button block onClick={onRestoreTask}>
            {t('cli:taskInfo.actions.restore')}
          </Button>
        )}
        {task.status !== 'archived' && onArchiveTask && (
          <Button block disabled={!mutable} onClick={onArchiveTask}>
            {t('cli:taskInfo.actions.archive')}
          </Button>
        )}
        {onDeleteTask && (
          <Button block danger disabled={!mutable} onClick={onDeleteTask}>
            {t('cli:taskInfo.actions.delete')}
          </Button>
        )}
        {!mutable && (
          <div className={styles.hint}>{t('cli:taskInfo.actions.runningHint')}</div>
        )}
      </div>
    </div>
  );

  if (inline) {
    return (
      <div className={styles.inlinePanel} style={{ width: 360, flexShrink: 0 }}>
        <div className={styles.inlineHeader}>
          <span className={styles.inlineTitle}>{t('cli:taskInfo.title')}</span>
          <button type="button" className={styles.inlineCloseBtn} onClick={() => onOpenChange(false)}>
            <X size={16} />
          </button>
        </div>
        {body}
      </div>
    );
  }

  return (
    <Drawer
      title={t('cli:taskInfo.title')}
      placement="right"
      open={open}
      onClose={() => onOpenChange(false)}
      width={420}
    >
      {body}
    </Drawer>
  );
};

export default CLITaskInfoPanel;
