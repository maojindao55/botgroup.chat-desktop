import { useEffect, useMemo, useState } from 'react';
import { Button, Drawer, Spin, Tag } from 'antd';
import { createStyles } from 'antd-style';
import { GitCompare, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { CLIDevelopmentTask, CLIRaceWorktreeEntry, CLITaskStatus } from '@/config/cliTasks';
import { getRaceWorktreeEntries } from '@/config/cliTasks';
import { request } from '@/utils/request';
import { openPath } from '@tauri-apps/plugin-opener';

const useStyles = createStyles(({ token, css }) => ({
  layout: css`
    display: grid;
    grid-template-columns: 280px 1fr;
    gap: 12px;
    height: calc(100vh - 180px);
    min-height: 420px;
  `,
  listPanel: css`
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 12px;
    overflow: auto;
    background: ${token.colorFillTertiary};
  `,
  listItem: css`
    padding: 10px 12px;
    border-bottom: 1px solid ${token.colorBorderSecondary};
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 4px;
    &:hover {
      background: ${token.colorFillSecondary};
    }
  `,
  listItemActive: css`
    background: rgba(255, 102, 0, 0.08) !important;
    border-left: 3px solid #ff6600;
  `,
  detailPanel: css`
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 12px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-width: 0;
  `,
  detailHeader: css`
    padding: 10px 12px;
    border-bottom: 1px solid ${token.colorBorderSecondary};
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    justify-content: space-between;
  `,
  diffBody: css`
    flex: 1;
    overflow: auto;
    padding: 12px;
    background: ${token.colorBgLayout};
  `,
  diffPre: css`
    margin: 0;
    font-family: var(--ant-font-family-code);
    font-size: 11px;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
  `,
  pathText: css`
    font-family: var(--ant-font-family-code);
    font-size: 10px;
    color: ${token.colorTextTertiary};
    word-break: break-all;
  `,
  hint: css`
    font-size: 11px;
    color: ${token.colorTextTertiary};
    line-height: 1.5;
    margin-bottom: 12px;
  `,
  topBar: css`
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
  `,
}));

interface CLIRaceResultsDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: CLIDevelopmentTask | null;
  workspacePath?: string;
  onAdopt: (messageId: string) => void;
}

const statusColor: Record<string, string> = {
  running: 'processing',
  completed: 'success',
  failed: 'error',
  cancelled: 'warning',
  timeout: 'error',
  queued: 'default',
};

async function fetchWorktreeDiff(cwd: string, baseSha: string) {
  const res = await request('/api/cli/git/diff', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cwd, baseSha }),
  });
  const json = await res.json();
  if (!json.success) {
    throw new Error(json.message || 'fetch diff failed');
  }
  return json.data as { stat: string; diff: string; truncated: boolean };
}

async function cleanupWorktrees(paths: string[]) {
  const res = await request('/api/cli/worktree/cleanup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths }),
  });
  const json = await res.json();
  if (!json.success) {
    throw new Error(json.message || 'cleanup failed');
  }
}

export const CLIRaceResultsDrawer = ({
  open,
  onOpenChange,
  task,
  workspacePath,
  onAdopt,
}: CLIRaceResultsDrawerProps) => {
  const { styles, cx } = useStyles();
  const { t } = useTranslation(['cli']);
  const entries = useMemo(
    () => (task ? getRaceWorktreeEntries(task, workspacePath) : []),
    [task, workspacePath],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [diffStat, setDiffStat] = useState('');
  const [diffText, setDiffText] = useState('');
  const [diffTruncated, setDiffTruncated] = useState(false);
  const [cleaning, setCleaning] = useState(false);

  const selected = entries.find(entry => entry.messageId === selectedId) || entries[0] || null;

  const statusLabel = (status?: string) => {
    const key = status as CLITaskStatus | undefined;
    if (key && t(`cli:status.${key}`, { defaultValue: '' })) {
      return t(`cli:status.${key}`);
    }
    return status || 'unknown';
  };

  useEffect(() => {
    if (!open || entries.length === 0) return;
    setSelectedId(prev => (prev && entries.some(entry => entry.messageId === prev) ? prev : entries[0].messageId));
  }, [open, entries]);

  useEffect(() => {
    if (!open || !selected?.baseSha) {
      setDiffStat('');
      setDiffText('');
      setDiffError(selected && !selected.baseSha ? t('cli:raceResults.missingBaseSha') : null);
      return;
    }

    let cancelled = false;
    setDiffLoading(true);
    setDiffError(null);

    fetchWorktreeDiff(selected.cliCwd, selected.baseSha)
      .then(data => {
        if (cancelled) return;
        setDiffStat(data.stat || t('cli:raceResults.noChanges'));
        setDiffText(data.diff || t('cli:raceResults.noDiffOutput'));
        setDiffTruncated(Boolean(data.truncated));
      })
      .catch(err => {
        if (cancelled) return;
        setDiffStat('');
        setDiffText('');
        const message = err instanceof Error ? err.message : String(err);
        setDiffError(message === 'fetch diff failed' ? t('cli:raceResults.fetchDiffFailed') : message);
      })
      .finally(() => {
        if (!cancelled) setDiffLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, selected?.messageId, selected?.cliCwd, selected?.baseSha, t]);

  const handleCleanupOne = async (entry: CLIRaceWorktreeEntry) => {
    const confirmed = window.confirm(
      t('cli:raceResults.cleanupConfirmOne', {
        agentName: entry.agentName || t('cli:raceResults.defaultAgent'),
        path: entry.cliCwd,
      }),
    );
    if (!confirmed) return;
    setCleaning(true);
    try {
      await cleanupWorktrees([entry.cliCwd]);
      toast.success(t('cli:raceResults.cleanupSuccess'));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(message === 'cleanup failed' ? t('cli:raceResults.cleanupFailed') : message);
    } finally {
      setCleaning(false);
    }
  };

  const handleCleanupAll = async () => {
    if (entries.length === 0) return;
    const confirmed = window.confirm(t('cli:raceResults.cleanupConfirmAll', { count: entries.length }));
    if (!confirmed) return;
    setCleaning(true);
    try {
      await cleanupWorktrees(entries.map(entry => entry.cliCwd));
      toast.success(t('cli:raceResults.cleanupAllSuccess'));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(message === 'cleanup failed' ? t('cli:raceResults.cleanupFailed') : message);
    } finally {
      setCleaning(false);
    }
  };

  const adoptedCount = entries.filter(entry => entry.adopted).length;

  return (
    <Drawer
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <GitCompare size={18} color="#ff6600" />
          <span>{t('cli:raceResults.title')}</span>
        </div>
      }
      open={open}
      onClose={() => onOpenChange(false)}
      width={920}
      destroyOnClose
    >
      <div className={styles.hint}>
        {t('cli:raceResults.hint')}
      </div>

      <div className={styles.topBar}>
        <span style={{ fontSize: 12, opacity: 0.7 }}>
          {t('cli:raceResults.summary', { count: entries.length })}
          {adoptedCount > 0 ? t('cli:raceResults.adoptedCount', { count: adoptedCount }) : ''}
        </span>
        {entries.length > 0 && (
          <Button
            danger
            size="small"
            icon={<Trash2 size={14} />}
            loading={cleaning}
            onClick={handleCleanupAll}
          >
            {t('cli:raceResults.cleanupAll')}
          </Button>
        )}
      </div>

      {entries.length === 0 ? (
        <div style={{ padding: 24, textAlign: 'center', opacity: 0.6, fontSize: 13 }}>
          {t('cli:raceResults.empty')}
        </div>
      ) : (
        <div className={styles.layout}>
          <div className={styles.listPanel}>
            {entries.map(entry => (
              <div
                key={entry.messageId}
                className={cx(
                  styles.listItem,
                  selected?.messageId === entry.messageId && styles.listItemActive,
                )}
                onClick={() => setSelectedId(entry.messageId)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <strong style={{ fontSize: 13 }}>{entry.agentName || entry.agentId || t('cli:raceResults.defaultAgent')}</strong>
                  <Tag color={statusColor[entry.status || 'queued'] || 'default'} style={{ margin: 0 }}>
                    {statusLabel(entry.status)}
                  </Tag>
                </div>
                {entry.adopted && <Tag color="success" style={{ width: 'fit-content', margin: 0 }}>{t('cli:raceResults.adopted')}</Tag>}
                <div className={styles.pathText}>{entry.cliBranch || entry.cliCwd}</div>
                <div style={{ fontSize: 11, opacity: 0.65, lineHeight: 1.4 }}>
                  {entry.contentPreview || t('cli:raceResults.noPreview')}
                </div>
              </div>
            ))}
          </div>

          <div className={styles.detailPanel}>
            {selected ? (
              <>
                <div className={styles.detailHeader}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{selected.agentName || selected.agentId}</div>
                    <div className={styles.pathText}>{selected.cliCwd}</div>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    <Button size="small" onClick={() => openPath(selected.cliCwd).catch(() => {})}>
                      {t('cli:raceResults.openPath')}
                    </Button>
                    {selected.status === 'completed' && !selected.adopted && (
                      <Button size="small" type="primary" onClick={() => onAdopt(selected.messageId)}>
                        {t('cli:raceResults.markAdopted')}
                      </Button>
                    )}
                    <Button
                      size="small"
                      danger
                      loading={cleaning}
                      onClick={() => handleCleanupOne(selected)}
                    >
                      {t('cli:raceResults.cleanupOne')}
                    </Button>
                  </div>
                </div>
                <div className={styles.diffBody}>
                  {diffLoading ? (
                    <div style={{ textAlign: 'center', padding: 32 }}><Spin /></div>
                  ) : diffError ? (
                    <div style={{ color: '#ff4d4f', fontSize: 12 }}>{diffError}</div>
                  ) : (
                    <>
                      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>{t('cli:raceResults.changeStats')}</div>
                      <pre className={styles.diffPre}>{diffStat || t('cli:raceResults.noChanges')}</pre>
                      <div style={{ fontSize: 12, fontWeight: 600, margin: '12px 0 8px' }}>
                        {t('cli:raceResults.diffTitle')} {diffTruncated ? t('cli:raceResults.diffTruncated') : ''}
                      </div>
                      <pre className={styles.diffPre}>{diffText || t('cli:raceResults.noDiff')}</pre>
                    </>
                  )}
                </div>
              </>
            ) : (
              <div style={{ padding: 24, opacity: 0.6 }}>{t('cli:raceResults.selectHint')}</div>
            )}
          </div>
        </div>
      )}
    </Drawer>
  );
};

export default CLIRaceResultsDrawer;
