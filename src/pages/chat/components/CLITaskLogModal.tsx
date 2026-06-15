import { useState, useEffect, useCallback, useRef } from 'react';
import { Modal, Button, Spin, Alert } from 'antd';
import { createStyles } from 'antd-style';
import { useTranslation } from 'react-i18next';
import { request } from '@/utils/request';

export interface CLITaskLogEntry {
  ts: string;
  type: 'stdout' | 'stderr' | 'system';
  content: string;
}

interface CLITaskLogPage {
  lines?: CLITaskLogEntry[];
  totalLines?: number;
  startLine?: number;
  truncated?: boolean;
  returnedBytes?: number;
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
    min-width: 0;
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
    min-width: 0;
    overflow-wrap: anywhere;
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

const LOG_VIEW_LINE_LIMIT = 500;
const LOG_VIEW_MAX_BYTES = 1024 * 1024;
const LOG_ENTRY_RENDER_LIMIT = 8192;
const BASE64_RUN_MIN_CHARS = 2048;

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function abbreviateLogContent(content: string): string {
  if (!content) return '';
  if (content.length > LOG_ENTRY_RENDER_LIMIT * 4) {
    return `${content.slice(0, LOG_ENTRY_RENDER_LIMIT)}\n[log line truncated locally: original ${formatBytes(content.length)}]`;
  }
  const redacted = content.replace(
    new RegExp(`[A-Za-z0-9+/=_-]{${BASE64_RUN_MIN_CHARS},}`, 'g'),
    match => `[base64 omitted locally: ${formatBytes(match.length)}]`,
  );
  if (redacted.length <= LOG_ENTRY_RENDER_LIMIT) return redacted;
  return `${redacted.slice(0, LOG_ENTRY_RENDER_LIMIT)}\n[log line truncated locally: original ${formatBytes(redacted.length)}]`;
}

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
  const [logTruncated, setLogTruncated] = useState(false);
  const [currentStatus, setCurrentStatus] = useState(status || '');
  const [currentPrompt, setCurrentPrompt] = useState(prompt || '');
  const lastLineRef = useRef(0);

  useEffect(() => {
    if (open) {
      setCurrentStatus(status || '');
      setCurrentPrompt(prompt || '');
    } else {
      setLogEntries([]);
      setLogTruncated(false);
      lastLineRef.current = 0;
    }
  }, [open, status, prompt, agentTaskId]);

  const fetchLogs = useCallback(async (
    taskId: string,
    options: { incremental?: boolean; silent?: boolean } = {},
  ) => {
    if (!options.silent) setLoadingLogs(true);
    try {
      const params = new URLSearchParams({
        taskId,
        limit: String(LOG_VIEW_LINE_LIMIT),
        maxBytes: String(LOG_VIEW_MAX_BYTES),
        redact: 'true',
      });
      if (options.incremental && lastLineRef.current > 0) {
        params.set('sinceLine', String(lastLineRef.current));
      } else {
        params.set('tail', 'true');
      }
      const res = await request(`/api/cli/tasks/log?${params.toString()}`);
      const json = await res.json();
      if (json.success && json.data) {
        const data = json.data as CLITaskLogPage;
        const nextLines = (data.lines || []).map(entry => ({
          ...entry,
          content: abbreviateLogContent(entry.content || ''),
        }));
        if (typeof data.totalLines === 'number') {
          lastLineRef.current = data.totalLines;
        }
        setLogTruncated(prev => options.incremental ? prev || Boolean(data.truncated) : Boolean(data.truncated));
        setLogEntries(prev => {
          const merged = options.incremental ? [...prev, ...nextLines] : nextLines;
          return merged.slice(-LOG_VIEW_LINE_LIMIT);
        });
      }
    } catch (e) {
      console.error('Failed to fetch logs:', e);
    } finally {
      if (!options.silent) setLoadingLogs(false);
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

  const refreshTask = useCallback(async (
    taskId: string,
    options: { incremental?: boolean; silent?: boolean } = {},
  ) => {
    await Promise.all([
      fetchLogs(taskId, options),
      fetchTaskMeta(taskId),
    ]);
  }, [fetchLogs, fetchTaskMeta]);

  useEffect(() => {
    if (!open || !agentTaskId) return;

    lastLineRef.current = 0;
    setLogEntries([]);
    setLogTruncated(false);
    refreshTask(agentTaskId);
  }, [open, agentTaskId, refreshTask]);

  useEffect(() => {
    if (!open || !agentTaskId) return;

    if (currentStatus !== 'running') return;

    const timer = setInterval(() => {
      refreshTask(agentTaskId, { incremental: true, silent: true });
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
          onClick={() => {
            if (!agentTaskId) return;
            lastLineRef.current = 0;
            refreshTask(agentTaskId);
          }}
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
            {abbreviateLogContent(currentPrompt)}
          </div>
        </div>
      )}

      {logTruncated && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message={t('cli:taskLog.truncated', {
            defaultValue: '日志视图仅显示最近输出，并已隐藏过大的 base64 / 二进制内容。',
          })}
        />
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
