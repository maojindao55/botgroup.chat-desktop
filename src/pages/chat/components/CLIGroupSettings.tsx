/**
 * CLI Agent 群聊配置面板
 * 管理 CLI Agent 成员、workspacePath、审批模式、超时等
 */
import { useState, useEffect } from 'react';
import { Drawer, Switch, Button, Input, InputNumber, Tooltip } from 'antd';
import { Avatar as LobeAvatar, ActionIcon } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { FolderOpen, Terminal, Mic, MicOff, CheckCircle2, XCircle } from 'lucide-react';
import { request } from '@/utils/request';
import type { CLIAgent } from '@/config/aiCharacters';
import type { CLIGroup, CLIStrategy } from '@/config/groups';
import { getAvatarData, resolveAvatarByName } from '@/utils/avatar';
import { invoke } from '@tauri-apps/api/core';

type CliStatus = { installed: boolean; version?: string; path?: string };

interface CLIGroupSettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group: CLIGroup;
  members: CLIAgent[];
  mutedUsers: string[];
  onToggleMute: (userId: string) => void;
  workspacePath: string;
  onWorkspacePathChange: (path: string) => void;
  approvalMode: 'auto' | 'ask';
  onApprovalModeChange: (mode: 'auto' | 'ask') => void;
  timeout: number;
  onTimeoutChange: (timeout: number) => void;
  strategy: CLIStrategy;
  onStrategyChange: (strategy: CLIStrategy) => void;
}

const useStyles = createStyles(({ token, css }) => ({
  panel: css`
    background: ${token.colorFillTertiary};
    border-radius: 12px;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  `,
  panelHeader: css`
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    font-weight: 500;
  `,
  panelDesc: css`
    font-size: 12px;
    color: ${token.colorTextTertiary};
  `,
  rowBetween: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
  `,
  strategyGrid: css`
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
  `,
  strategyBtn: css`
    padding: 8px;
    border-radius: 8px;
    border: 1px solid ${token.colorBorderSecondary};
    background: transparent;
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
    transition: all 0.15s;
    &:hover {
      background: ${token.colorFillTertiary};
    }
  `,
  strategyBtnActive: css`
    border-color: #ff6600;
    background: rgba(255, 102, 0, 0.08);
    color: #ff6600;
  `,
  memberRow: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 8px;
    transition: background 0.15s;
    margin-bottom: 8px;
    &:hover {
      background: ${token.colorFillTertiary};
    }
  `,
  adapterTag: css`
    display: inline-flex;
    align-items: center;
    gap: 2px;
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 4px;
    background: rgba(168, 85, 247, 0.12);
    color: #a855f7;
  `,
  scrollList: css`
    max-height: calc(100vh - 520px);
    overflow: auto;
  `,
}));

export const CLIGroupSettings = ({
  open,
  onOpenChange,
  group: _group,
  members,
  mutedUsers,
  onToggleMute,
  workspacePath,
  onWorkspacePathChange,
  approvalMode,
  onApprovalModeChange,
  timeout,
  onTimeoutChange,
  strategy,
  onStrategyChange,
}: CLIGroupSettingsProps) => {
  const { styles, cx } = useStyles();
  const [cliStatus, setCliStatus] = useState<Record<string, CliStatus | 'loading'>>({});

  useEffect(() => {
    if (!open || members.length === 0) return;
    let cancelled = false;

    (async () => {
      for (const m of members) {
        if (cancelled) break;
        const adapter = m.cli?.adapter;
        if (!adapter) continue;
        setCliStatus(prev => ({ ...prev, [m.id]: 'loading' }));
        try {
          const res = await request('/api/cli/check', {
            method: 'POST',
            body: JSON.stringify({ adapter }),
          });
          const json = await res.json();
          if (!cancelled) {
            setCliStatus(prev => ({ ...prev, [m.id]: json.data || { installed: false } }));
          }
        } catch {
          if (!cancelled) {
            setCliStatus(prev => ({ ...prev, [m.id]: { installed: false } }));
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, members]);

  const strategyDescriptions: Record<CLIStrategy, string> = {
    sequential: '逐个 CLI Agent 依次执行任务',
    router: '根据任务特征自动选择最合适的 CLI Agent',
    race: '所有 CLI Agent 同时执行，对比结果取最优',
    pipeline: '按顺序形成流水线：生成→审查→优化',
  };

  return (
    <Drawer
      title="CLI Agent 配置"
      placement="right"
      open={open}
      onClose={() => onOpenChange(false)}
      width={400}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* workspace */}
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <FolderOpen size={16} />
            <span>本地 Workspace</span>
          </div>
          <div className={styles.panelDesc}>
            CLI Agent 将在此目录下执行命令，支持选择或输入绝对路径
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Input
              placeholder="/Users/you/projects/your-repo"
              value={workspacePath}
              onChange={(e) => onWorkspacePathChange(e.target.value)}
              style={{ flex: 1, fontFamily: 'var(--ant-font-family-code)' }}
            />
            <Button
              type="default"
              icon={<FolderOpen size={14} />}
              onClick={async () => {
                try {
                  const selected = await invoke<string | null>('select_directory');
                  if (selected) onWorkspacePathChange(selected);
                } catch (e) {
                  console.error('Failed to select directory:', e);
                }
              }}
            >
              选择
            </Button>
          </div>
        </div>

        {/* approval */}
        <div className={styles.panel}>
          <div className={styles.rowBetween}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 500 }}>自动审批</div>
              <div className={styles.panelDesc} style={{ marginTop: 4 }}>开启后 Agent 自动执行，无需确认</div>
            </div>
            <Switch
              checked={approvalMode === 'auto'}
              onChange={(v) => onApprovalModeChange(v ? 'auto' : 'ask')}
            />
          </div>
        </div>

        {/* timeout */}
        <div className={styles.panel}>
          <div style={{ fontSize: 14, fontWeight: 500 }}>执行超时</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <InputNumber
              value={timeout / 1000}
              onChange={(v) => onTimeoutChange(Number(v) * 1000)}
              min={30}
              max={600}
              style={{ width: 100 }}
            />
            <span className={styles.panelDesc}>秒</span>
          </div>
        </div>

        {/* strategy */}
        <div className={styles.panel}>
          <div style={{ fontSize: 14, fontWeight: 500 }}>执行策略</div>
          <div className={styles.strategyGrid}>
            {[
              { value: 'sequential' as const, label: '顺序执行' },
              { value: 'router' as const, label: '智能路由' },
              { value: 'race' as const, label: '竞争模式' },
              { value: 'pipeline' as const, label: '流水线' },
            ].map((item) => (
              <button
                key={item.value}
                onClick={() => onStrategyChange(item.value)}
                className={cx(
                  styles.strategyBtn,
                  strategy === item.value && styles.strategyBtnActive,
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
          <p className={styles.panelDesc} style={{ marginTop: 4 }}>
            {strategyDescriptions[strategy]}
          </p>
        </div>

        {/* members */}
        <div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 12,
            }}
          >
            <span style={{ fontSize: 14, fontWeight: 500 }}>CLI Agents（{members.length}）</span>
          </div>
          <div className={styles.scrollList}>
            {members.map((agent) => {
              const status = cliStatus[agent.id];
              const a = getAvatarData(agent.name);
              const url = resolveAvatarByName(agent.name, agent.avatar, 36);
              const muted = mutedUsers.includes(agent.id);
              return (
                <div key={agent.id} className={styles.memberRow}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <LobeAvatar
                      shape="circle"
                      avatar={url || a.text}
                      background={a.backgroundColor}
                      size={36}
                    />
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 14, fontWeight: 500 }}>{agent.name}</span>
                        <span className={styles.adapterTag}>
                          <Terminal size={10} /> {agent.cli.adapter}
                        </span>
                      </div>
                      {status === 'loading' && (
                        <span style={{ fontSize: 10, opacity: 0.6, marginTop: 4 }}>检测中...</span>
                      )}
                      {status && status !== 'loading' && status.installed && (
                        <span
                          style={{
                            fontSize: 10,
                            color: '#22c55e',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 2,
                            marginTop: 4,
                          }}
                        >
                          <CheckCircle2 size={10} />
                          {status.version || '已安装'}
                        </span>
                      )}
                      {status && status !== 'loading' && !status.installed && (
                        <span
                          style={{
                            fontSize: 10,
                            color: '#ef4444',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 2,
                            marginTop: 4,
                          }}
                        >
                          <XCircle size={10} />
                          未安装
                        </span>
                      )}
                      {muted && (
                        <span style={{ fontSize: 10, color: '#ef4444', marginTop: 4 }}>已禁言</span>
                      )}
                    </div>
                  </div>
                  <Tooltip title={muted ? '取消禁言' : '禁言'}>
                    <ActionIcon
                      icon={muted ? MicOff : Mic}
                      size="small"
                      onClick={() => onToggleMute(agent.id)}
                      style={{ color: muted ? '#ef4444' : '#22c55e' }}
                      title=""
                    />
                  </Tooltip>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Drawer>
  );
};

export default CLIGroupSettings;
