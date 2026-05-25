import { useMemo, useState } from 'react';
import { Modal, Select, Tag } from 'antd';
import { createStyles } from 'antd-style';
import type { CLIDevelopmentTask } from '@/config/cliTasks';
import { sessionPolicyLabel } from '@/config/cliTasks';
import { cliWorkflowTemplates } from '@/config/groupProduct';

const useStyles = createStyles(({ token, css }) => ({
  grid: css`
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  `,
  panel: css`
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 12px;
    padding: 12px;
    background: ${token.colorFillTertiary};
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  `,
  label: css`
    font-size: 11px;
    color: ${token.colorTextTertiary};
  `,
  value: css`
    font-size: 13px;
    color: ${token.colorText};
    word-break: break-word;
  `,
  row: css`
    display: flex;
    flex-direction: column;
    gap: 2px;
  `,
}));

interface CLITaskCompareModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tasks: CLIDevelopmentTask[];
  initialTaskId?: string | null;
}

function strategyLabel(strategy: string) {
  return cliWorkflowTemplates.find(item => item.strategy === strategy)?.label || strategy;
}

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function TaskSummary({ task }: { task: CLIDevelopmentTask | null }) {
  const { styles } = useStyles();
  if (!task) {
    return <div className={styles.panel}>请选择任务</div>;
  }

  const agentMessages = task.messages.filter(message => message.role === 'agent');
  const adoptedCount = agentMessages.filter(message => message.adopted).length;

  return (
    <div className={styles.panel}>
      <div className={styles.row}>
        <span className={styles.label}>任务</span>
        <span className={styles.value}>{task.title}</span>
      </div>
      <div className={styles.row}>
        <span className={styles.label}>状态</span>
        <Tag style={{ width: 'fit-content' }}>{task.status}</Tag>
      </div>
      <div className={styles.row}>
        <span className={styles.label}>模板</span>
        <span className={styles.value}>{task.templateSnapshot.name}</span>
      </div>
      <div className={styles.row}>
        <span className={styles.label}>Workspace</span>
        <span className={styles.value}>{task.workspacePath || '（未指定）'}</span>
      </div>
      <div className={styles.row}>
        <span className={styles.label}>协作方式</span>
        <span className={styles.value}>{strategyLabel(task.templateSnapshot.strategy)}</span>
      </div>
      <div className={styles.row}>
        <span className={styles.label}>Session 策略</span>
        <span className={styles.value}>{sessionPolicyLabel(task.templateSnapshot.sessionPolicy)}</span>
      </div>
      <div className={styles.row}>
        <span className={styles.label}>消息</span>
        <span className={styles.value}>
          共 {task.messages.length} 条 · Agent 输出 {agentMessages.length} 条
          {adoptedCount > 0 ? ` · 已采纳 ${adoptedCount}` : ''}
        </span>
      </div>
      <div className={styles.row}>
        <span className={styles.label}>需求摘要</span>
        <span className={styles.value}>{task.prompt.slice(0, 240)}{task.prompt.length > 240 ? '…' : ''}</span>
      </div>
      <div className={styles.row}>
        <span className={styles.label}>时间</span>
        <span className={styles.value}>{formatTime(task.createdAt)} → {formatTime(task.updatedAt)}</span>
      </div>
    </div>
  );
}

export const CLITaskCompareModal = ({
  open,
  onOpenChange,
  tasks,
  initialTaskId,
}: CLITaskCompareModalProps) => {
  const { styles } = useStyles();
  const sortedTasks = useMemo(
    () => [...tasks].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [tasks],
  );
  const [leftId, setLeftId] = useState<string | null>(initialTaskId || sortedTasks[0]?.id || null);
  const [rightId, setRightId] = useState<string | null>(sortedTasks[1]?.id || sortedTasks[0]?.id || null);

  const options = sortedTasks.map(task => ({ value: task.id, label: task.title }));

  const leftTask = sortedTasks.find(task => task.id === leftId) || null;
  const rightTask = sortedTasks.find(task => task.id === rightId) || null;

  return (
    <Modal
      title="对比开发任务"
      open={open}
      onCancel={() => onOpenChange(false)}
      footer={null}
      width={760}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className={styles.grid}>
          <Select
            value={leftId || undefined}
            onChange={setLeftId}
            options={options}
            placeholder="选择任务 A"
            style={{ width: '100%' }}
          />
          <Select
            value={rightId || undefined}
            onChange={setRightId}
            options={options}
            placeholder="选择任务 B"
            style={{ width: '100%' }}
          />
        </div>
        <div className={styles.grid}>
          <TaskSummary task={leftTask} />
          <TaskSummary task={rightTask} />
        </div>
      </div>
    </Modal>
  );
};

export default CLITaskCompareModal;
