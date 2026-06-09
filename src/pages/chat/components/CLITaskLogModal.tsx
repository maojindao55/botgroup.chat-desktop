import { useState, useEffect, useCallback } from 'react';
import { Modal, Button, Spin } from 'antd';
import { createStyles } from 'antd-style';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation(['cli', 'common']);
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

  const fetchLogs = useCallback(async (taskId: string) => {
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
  }, []);

  const fetchTaskMeta = useCallback(async (taskId: string) => {
    try {
      const res = await request(`/api/cli/tasks/get?taskId=${taskId}`);
      const json = await res.json();
      if (json.success && json.data) {
        const nextStatus = json.data.status as string | undefined;
        if (nextStatus) {
          setCurrentStatus(nextStatus);
          onStatusChange?.(nextStatus);
        }
        if (json.data.prompt) setCurrentPrompt(json.data.prompt);
      }
    } catch (e) {
      console.error('Failed to fetch task metadata:', e);
    }
  }, [onStatusChange]);

  const refreshTask = useCallback(async (taskId: string) => {
    await Promise.all([
      fetchLogs(taskId),
      fetchTaskMeta(taskId),
    ]);
  }, [fetchLogs, fetchTaskMeta]);

  useEffect(() => {
    if (!open || !agentTaskId) return;

    refreshTask(agentTaskId);

    if (currentStatus !== 'running') return;

    const timer = setInterval(() => {
      refreshTask(agentTaskId);
    }, 2000);

    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- poll only by task id / running state
  }, [open, agentTaskId, currentStatus, refreshTask]);

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
        await fetchTaskMeta(agentTaskId);
      } catch (e) {
        console.error('Failed to cancel task from log modal:', e);
      }
    }
  };

  const subtitleParts = [
    agentName,
    adapter ? `(${adapter})` : '',
    currentStatus ? t('cli:taskLog.statusPrefix', { status: currentStatus }) : '',
  ].filter(Boolean);
  const subtitle = subtitleParts.join(' ');

  return (
    <Modal
      title={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingRight: 24 }}>
          <span>{t('cli:taskLog.title')}</span>
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
            {t('cli:taskLog.stop')}
          </Button>
        ),
        <Button
          key="refresh"
          onClick={() => agentTaskId && refreshTask(agentTaskId)}
          loading={loadingLogs}
        >
          {t('cli:taskLog.refresh')}
        </Button>,
        <Button key="close" type="primary" onClick={handleClose}>
          {t('cli:taskLog.close')}
        </Button>,
      ]}
      width={700}
      destroyOnClose
    >
      {currentPrompt && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: 'var(--ant-color-text-secondary)', marginBottom: 4 }}>
            <strong>{t('cli:taskLog.promptLabel')}</strong>
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
          <Spin tip={t('cli:taskLog.loading')} />
        </div>
      ) : logEntries.length === 0 ? (
        <div className={styles.logConsole}>
          <div className={cx(styles.logRow, styles.logTypeSystem)}>
            <span>{t('cli:taskLog.empty')}</span>
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
