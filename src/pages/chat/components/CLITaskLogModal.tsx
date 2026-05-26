import { useState, useEffect } from 'react';
import { Modal, Button, Spin } from 'antd';
import { createStyles } from 'antd-style';
import { request } from '@/utils/request';

export interface CLITaskLogEntry {
  ts: string;
  type: 'stdout' | 'stderr' | 'system';
  content: string;
}

export interface CLITaskLogModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentTaskId: string | null;
  agentName?: string;
  adapter?: string;
  prompt?: string;
  status?: string;
  onStatusChange?: (status: string) => void;
  onCancel?: () => void | Promise<void>;
}

const useStyles = createStyles(({ css }) => ({
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
    color: #858585;
    font-style: italic;
  `,
}));

export const CLITaskLogModal = ({
  open,
  onOpenChange,
  agentTaskId,
  agentName,
  adapter,
  prompt,
  status,
  onStatusChange,
  onCancel,
}: CLITaskLogModalProps) => {
  const { styles, cx } = useStyles();
  const [logEntries, setLogEntries] = useState<CLITaskLogEntry[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [currentStatus, setCurrentStatus] = useState(status || '');
  const [currentPrompt, setCurrentPrompt] = useState(prompt || '');

  useEffect(() => {
    if (open) {
      setCurrentStatus(status || '');
      setCurrentPrompt(prompt || '');
    } else {
      setLogEntries([]);
    }
  }, [open, status, prompt]);

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

  useEffect(() => {
    if (!open || !agentTaskId) return;

    fetchLogs(agentTaskId);

    if (currentStatus !== 'running') return;

    const timer = setInterval(() => {
      fetchLogs(agentTaskId);
      request(`/api/cli/tasks/get?taskId=${agentTaskId}`)
        .then(res => res.json())
        .then(json => {
          if (json.success && json.data) {
            const nextStatus = json.data.status as string;
            setCurrentStatus(nextStatus);
            if (json.data.prompt) setCurrentPrompt(json.data.prompt);
            onStatusChange?.(nextStatus);
          }
        })
        .catch(console.error);
    }, 2000);

    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- poll only by task id / running state
  }, [open, agentTaskId, currentStatus]);

  const handleClose = () => {
    onOpenChange(false);
  };

  const handleCancel = async () => {
    if (onCancel) {
      await onCancel();
    } else if (agentTaskId) {
      try {
        await request('/api/cli/tasks/cancel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId: agentTaskId }),
        });
        const res = await request(`/api/cli/tasks/get?taskId=${agentTaskId}`);
        const json = await res.json();
        if (json.success && json.data) {
          const nextStatus = json.data.status as string;
          setCurrentStatus(nextStatus);
          onStatusChange?.(nextStatus);
        }
      } catch (e) {
        console.error('Failed to cancel task from log modal:', e);
      }
    }
  };

  const subtitle = [agentName, adapter ? `(${adapter})` : '', currentStatus ? `状态: ${currentStatus}` : '']
    .filter(Boolean)
    .join(' ');

  return (
    <Modal
      title={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingRight: 24 }}>
          <span>任务执行日志</span>
          {subtitle && (
            <span style={{ fontSize: 12, fontWeight: 'normal', color: 'var(--ant-color-text-secondary)' }}>
              {subtitle}
            </span>
          )}
        </div>
      }
      open={open}
      onCancel={handleClose}
      footer={[
        currentStatus === 'running' && (
          <Button key="cancel-task" danger onClick={handleCancel}>
            停止运行
          </Button>
        ),
        <Button
          key="refresh"
          onClick={() => agentTaskId && fetchLogs(agentTaskId)}
          loading={loadingLogs}
        >
          刷新
        </Button>,
        <Button key="close" type="primary" onClick={handleClose}>
          关闭
        </Button>,
      ]}
      width={700}
      destroyOnClose
    >
      {currentPrompt && (
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
            whiteSpace: 'pre-wrap',
          }}
          >
            {currentPrompt}
          </div>
        </div>
      )}

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
  );
};

export default CLITaskLogModal;
