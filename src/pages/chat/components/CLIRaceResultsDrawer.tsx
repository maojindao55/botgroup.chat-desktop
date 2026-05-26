import { useEffect, useMemo, useState } from 'react';
import { Button, Drawer, Spin, Tag } from 'antd';
import { createStyles } from 'antd-style';
import { GitCompare, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { CLIDevelopmentTask, CLIRaceWorktreeEntry } from '@/config/cliTasks';
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
    throw new Error(json.message || '获取 diff 失败');
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
    throw new Error(json.message || '清理 worktree 失败');
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

  useEffect(() => {
    if (!open || entries.length === 0) return;
    setSelectedId(prev => (prev && entries.some(entry => entry.messageId === prev) ? prev : entries[0].messageId));
  }, [open, entries]);

  useEffect(() => {
    if (!open || !selected?.baseSha) {
      setDiffStat('');
      setDiffText('');
      setDiffError(selected && !selected.baseSha ? '缺少基准 commit，无法生成 diff' : null);
      return;
    }

    let cancelled = false;
    setDiffLoading(true);
    setDiffError(null);

    fetchWorktreeDiff(selected.cliCwd, selected.baseSha)
      .then(data => {
        if (cancelled) return;
        setDiffStat(data.stat || '（无变更）');
        setDiffText(data.diff || '（无 diff 输出）');
        setDiffTruncated(Boolean(data.truncated));
      })
      .catch(err => {
        if (cancelled) return;
        setDiffStat('');
        setDiffText('');
        setDiffError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setDiffLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, selected?.messageId, selected?.cliCwd, selected?.baseSha]);

  const handleCleanupOne = async (entry: CLIRaceWorktreeEntry) => {
    const confirmed = window.confirm(`确认清理 ${entry.agentName || '该开发群友'} 的 worktree？\n${entry.cliCwd}`);
    if (!confirmed) return;
    setCleaning(true);
    try {
      await cleanupWorktrees([entry.cliCwd]);
      toast.success('worktree 已清理');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '清理失败');
    } finally {
      setCleaning(false);
    }
  };

  const handleCleanupAll = async () => {
    if (entries.length === 0) return;
    const confirmed = window.confirm(`确认清理此任务的全部 ${entries.length} 个 worktree？此操作不可恢复。`);
    if (!confirmed) return;
    setCleaning(true);
    try {
      await cleanupWorktrees(entries.map(entry => entry.cliCwd));
      toast.success('全部 worktree 已清理');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '清理失败');
    } finally {
      setCleaning(false);
    }
  };

  return (
    <Drawer
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <GitCompare size={18} color="#ff6600" />
          <span>Race 结果对比</span>
        </div>
      }
      open={open}
      onClose={() => onOpenChange(false)}
      width={920}
      destroyOnClose
    >
      <div className={styles.hint}>
        对比各开发群友在独立 worktree 中相对基准 commit 的代码变更。标记采纳仅记录你的选择，不会自动 merge 到主 workspace。
      </div>

      <div className={styles.topBar}>
        <span style={{ fontSize: 12, opacity: 0.7 }}>
          {entries.length} 个 worktree 结果
          {entries.some(entry => entry.adopted) ? ` · 已采纳 ${entries.filter(entry => entry.adopted).length}` : ''}
        </span>
        {entries.length > 0 && (
          <Button
            danger
            size="small"
            icon={<Trash2 size={14} />}
            loading={cleaning}
            onClick={handleCleanupAll}
          >
            清理全部
          </Button>
        )}
      </div>

      {entries.length === 0 ? (
        <div style={{ padding: 24, textAlign: 'center', opacity: 0.6, fontSize: 13 }}>
          暂无 race worktree 结果。请使用「隔离竞赛」模板运行任务后再查看。
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
                  <strong style={{ fontSize: 13 }}>{entry.agentName || entry.agentId || '开发群友'}</strong>
                  <Tag color={statusColor[entry.status || 'queued'] || 'default'} style={{ margin: 0 }}>
                    {entry.status || 'unknown'}
                  </Tag>
                </div>
                {entry.adopted && <Tag color="success" style={{ width: 'fit-content', margin: 0 }}>已采纳</Tag>}
                <div className={styles.pathText}>{entry.cliBranch || entry.cliCwd}</div>
                <div style={{ fontSize: 11, opacity: 0.65, lineHeight: 1.4 }}>
                  {entry.contentPreview || '（无输出摘要）'}
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
                      打开路径
                    </Button>
                    {selected.status === 'completed' && !selected.adopted && (
                      <Button size="small" type="primary" onClick={() => onAdopt(selected.messageId)}>
                        标记采纳
                      </Button>
                    )}
                    <Button
                      size="small"
                      danger
                      loading={cleaning}
                      onClick={() => handleCleanupOne(selected)}
                    >
                      清理 worktree
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
                      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>变更统计</div>
                      <pre className={styles.diffPre}>{diffStat || '（无）'}</pre>
                      <div style={{ fontSize: 12, fontWeight: 600, margin: '12px 0 8px' }}>
                        Diff {diffTruncated ? '（已截断）' : ''}
                      </div>
                      <pre className={styles.diffPre}>{diffText || '（无 diff）'}</pre>
                    </>
                  )}
                </div>
              </>
            ) : (
              <div style={{ padding: 24, opacity: 0.6 }}>请选择左侧结果查看 diff</div>
            )}
          </div>
        </div>
      )}
    </Drawer>
  );
};

export default CLIRaceResultsDrawer;
