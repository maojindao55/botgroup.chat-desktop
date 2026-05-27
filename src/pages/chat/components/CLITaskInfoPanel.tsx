/**
 * 开发任务信息面板 — 只读展示任务元数据与创建时的 templateSnapshot
 */
import { Drawer, Tag, Button } from 'antd';
import { X } from 'lucide-react';
import { createStyles } from 'antd-style';
import { cliWorkflowTemplates } from '@/config/groupProduct';
import type { CLIDevelopmentTask, CLITaskStatus } from '@/config/cliTasks';
import { canMutateTask, getTaskDisplayStatus, sessionPolicyLabel } from '@/config/cliTasks';
import type { AIMember } from '@/config/aiMembers';

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
    padding: 14px 16px;
    border-bottom: 1px solid ${token.colorBorderSecondary};
    flex: none;
  `,
  inlineTitle: css`
    font-size: 14px;
    font-weight: 600;
  `,
  inlineCloseBtn: css`
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
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function strategyLabel(strategy: string) {
  const tpl = cliWorkflowTemplates.find(t => t.strategy === strategy);
  return tpl?.label || strategy;
}

function approvalLabel(mode: 'auto' | 'ask') {
  return mode === 'auto' ? '自动审批' : '执行前需确认';
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

  if (!open || !task) {
    if (inline) return null;
    return (
      <Drawer
        title="任务信息"
        placement="right"
        open={open}
        onClose={() => onOpenChange(false)}
        width={420}
      >
        <div className={styles.hint}>请先选择或创建一个开发任务。</div>
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
        以下为本任务创建时保存的配置快照。修改团队模板不会影响此任务；如需新策略处理同一需求，请从此任务创建新任务。
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>任务信息</div>
        <div className={styles.row}>
          <span className={styles.label}>任务名</span>
          <span className={styles.value}>{task.title}</span>
        </div>
        <div className={styles.row}>
          <span className={styles.label}>状态</span>
          <Tag color={statusInfo.color} style={{ width: 'fit-content' }}>{statusInfo.label}</Tag>
        </div>
        <div className={styles.row}>
          <span className={styles.label}>Workspace</span>
          <span className={styles.value}>{task.workspacePath || '（未指定）'}</span>
        </div>
        <div className={styles.row}>
          <span className={styles.label}>创建时间</span>
          <span className={styles.value}>{formatDateTime(task.createdAt)}</span>
        </div>
        <div className={styles.row}>
          <span className={styles.label}>更新时间</span>
          <span className={styles.value}>{formatDateTime(task.updatedAt)}</span>
        </div>
        <div className={styles.row}>
          <span className={styles.label}>使用模板</span>
          <span className={styles.value}>{snapshot.name}</span>
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>本任务模板快照（只读）</div>
        <div className={styles.row}>
          <span className={styles.label}>成员</span>
          <div className={styles.memberList}>
            {snapshotMembers.length > 0 ? snapshotMembers.map(m => (
              <span key={m.id} className={styles.memberChip}>{m.name}</span>
            )) : (
              <span className={styles.value}>（无成员）</span>
            )}
          </div>
        </div>
        <div className={styles.row}>
          <span className={styles.label}>协作方式</span>
          <span className={styles.value}>{strategyLabel(snapshot.strategy)}</span>
        </div>
        <div className={styles.row}>
          <span className={styles.label}>审批方式</span>
          <span className={styles.value}>{approvalLabel(snapshot.approvalMode)}</span>
        </div>
        <div className={styles.row}>
          <span className={styles.label}>执行超时</span>
          <span className={styles.value}>{Math.round(snapshot.timeout / 1000)} 秒</span>
        </div>
        <div className={styles.row}>
          <span className={styles.label}>CLI 会话复用</span>
          <span className={styles.value}>{sessionPolicyLabel(snapshot.sessionPolicy)}</span>
        </div>
        <div className={styles.row}>
          <span className={styles.label}>stderr 展示</span>
          <span className={styles.value}>{snapshot.showStderr ? '开启' : '关闭'}</span>
        </div>
      </div>

      <div className={styles.actionRow}>
        {onCreateTaskFromThis && (
          <button type="button" className={styles.actionBtn} onClick={onCreateTaskFromThis}>
            从此任务创建新任务
          </button>
        )}
        {task.status === 'archived' && onRestoreTask && (
          <Button block onClick={onRestoreTask}>
            恢复任务
          </Button>
        )}
        {task.status !== 'archived' && onArchiveTask && (
          <Button block disabled={!mutable} onClick={onArchiveTask}>
            归档任务
          </Button>
        )}
        {onDeleteTask && (
          <Button block danger disabled={!mutable} onClick={onDeleteTask}>
            删除任务
          </Button>
        )}
        {!mutable && (
          <div className={styles.hint}>任务运行中，暂不可归档或删除。</div>
        )}
      </div>
    </div>
  );

  if (inline) {
    return (
      <div className={styles.inlinePanel} style={{ width: 360, flexShrink: 0 }}>
        <div className={styles.inlineHeader}>
          <span className={styles.inlineTitle}>任务信息</span>
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
      title="任务信息"
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
