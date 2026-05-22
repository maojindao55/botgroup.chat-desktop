/**
 * Agent 群聊配置面板
 * 管理自定义 Agent 成员、执行策略、工具等
 */
import { Drawer, Input, InputNumber, Tooltip } from 'antd';
import { Avatar as LobeAvatar, ActionIcon } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { Mic, MicOff, X } from 'lucide-react';
import type { AgentGroup, AgentStrategy } from '@/config/groups';
import { getAvatarData, resolveAvatarByName } from '@/utils/avatar';
import { MemberPicker } from './MemberPicker';
import { useAIMemberStore } from '@/store/aiMemberStore';

interface AgentGroupSettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group: AgentGroup;
  mutedUsers: string[];
  onToggleMute: (userId: string) => void;
  onUpdateGroup: (updates: Partial<AgentGroup>) => void;
}

const useStyles = createStyles(({ token, css }) => ({
  scrollArea: css`
    height: calc(100vh - 80px);
    overflow: auto;
    padding-right: 8px;
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
    text-align: center;
    color: ${token.colorText};
    &:hover {
      background: ${token.colorFillTertiary};
    }
  `,
  strategyBtnActive: css`
    border-color: #ff6600;
    background: rgba(255, 102, 0, 0.08);
    color: #ff6600;
    &:hover {
      background: rgba(255, 102, 0, 0.12);
    }
  `,
  strategyDesc: css`
    font-size: 11px;
    color: ${token.colorTextTertiary};
    margin-top: 6px;
  `,
  supervisorBadge: css`
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 4px;
    background: rgba(255, 102, 0, 0.12);
    color: #ff6600;
    font-weight: 500;
    white-space: nowrap;
  `,
  memberRow: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    border-radius: 8px;
    transition: background 0.15s;
    &:hover {
      background: ${token.colorFillTertiary};
    }
  `,
  scrollList: css`
    max-height: calc(100vh - 420px);
    overflow: auto;
  `,
}));

export const AgentGroupSettings = ({
  open,
  onOpenChange,
  group,
  mutedUsers,
  onToggleMute,
  onUpdateGroup,
}: AgentGroupSettingsProps) => {
  const { styles, cx } = useStyles();
  const { members: allMembers } = useAIMemberStore();

  const currentMemberIds = group.memberIds || group.agents?.map((a) => a.id) || [];
  const currentAgents = currentMemberIds
    .map((id) => allMembers[id])
    .filter((m) => m && m.kind === 'agent');

  const strategyOptions: { value: AgentStrategy; label: string }[] = [
    { value: 'sequential', label: '顺序执行' },
    { value: 'router', label: '意图路由' },
    { value: 'discussion', label: '全员讨论' },
    { value: 'react', label: 'ReAct' },
    { value: 'pipeline', label: '流水线' },
    { value: 'debate', label: '辩论' },
    { value: 'mapreduce', label: 'MapReduce' },
    { value: 'supervisor', label: '监督者' },
  ];

  const strategyDescriptions: Record<AgentStrategy, string> = {
    sequential: '按成员顺序依次执行，后者可看到前者的输出',
    router: '智能分析用户意图，选择最相关的 Agent 回答',
    discussion: '所有 Agent 并行回复同一消息',
    react: '协调者分析→分派任务→执行→判断是否完成→循环',
    pipeline: '按角色分工形成流水线，每阶段产出作为下一阶段输入',
    debate: '多 Agent 独立回答→互相评论→最终综合裁决',
    mapreduce: '自动拆分任务→各 Agent 并行处理→汇总合并结果',
    supervisor: '监督者分派任务→审查质量→反馈修改→直到满意',
  };

  const showCoordinatorPrompt = ['router', 'react', 'discussion', 'supervisor', 'debate', 'mapreduce'].includes(
    group.strategy,
  );

  return (
    <Drawer
      title="Agent 群聊配置"
      placement="right"
      open={open}
      onClose={() => onOpenChange(false)}
      width={440}
    >
      <div className={styles.scrollArea}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* 执行策略 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={{ fontSize: 14, fontWeight: 500 }}>执行策略</label>
            <div className={styles.strategyGrid}>
              {strategyOptions.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => onUpdateGroup({ strategy: item.value })}
                  className={cx(
                    styles.strategyBtn,
                    group.strategy === item.value && styles.strategyBtnActive,
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <p className={styles.strategyDesc}>{strategyDescriptions[group.strategy]}</p>
          </div>

          {/* 协调者 Prompt */}
          {showCoordinatorPrompt && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 14, fontWeight: 500 }}>协调者 Prompt</label>
              <Input.TextArea
                autoSize={{ minRows: 3, maxRows: 6 }}
                placeholder="定义协调者如何分派任务..."
                value={group.coordinatorPrompt || ''}
                onChange={(e) => onUpdateGroup({ coordinatorPrompt: e.target.value })}
              />
            </div>
          )}

          {/* 最大轮数 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <label style={{ fontSize: 14, fontWeight: 500, whiteSpace: 'nowrap' }}>最大轮数</label>
            <InputNumber
              value={group.maxRounds}
              min={1}
              max={10}
              style={{ width: 80 }}
              onChange={(v) => onUpdateGroup({ maxRounds: Number(v) })}
            />
          </div>

          {/* Agent 成员管理 */}
          <div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
              <span style={{ fontSize: 14, fontWeight: 500 }}>添加/管理 Agent 成员</span>
              <MemberPicker
                kind="agent"
                value={currentMemberIds}
                onChange={(newIds) => onUpdateGroup({ memberIds: newIds })}
                placeholder="选择 Agent 成员加入群聊..."
              />
            </div>

            <div style={{ marginBottom: 12 }}>
              <span style={{ fontSize: 14, fontWeight: 500 }}>群成员（{currentAgents.length}）</span>
            </div>

            {/* 成员列表 */}
            <div className={styles.scrollList}>
              {currentAgents.map((agent) => {
                if (!agent) return null;
                const avatarData = getAvatarData(agent.name || 'A');
                const avatarUrl = resolveAvatarByName(agent.name || 'A', agent.avatar, 32);
                const isSupervisor = group.strategy === 'supervisor' && currentMemberIds[0] === agent.id;
                const muted = mutedUsers.includes(agent.id);

                return (
                  <div key={agent.id} className={styles.memberRow}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                      <LobeAvatar
                        shape="circle"
                        avatar={avatarUrl || avatarData.text}
                        background={avatarData.backgroundColor}
                        size={32}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 13,
                            fontWeight: 500,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                          }}
                        >
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {agent.name}
                          </span>
                          {isSupervisor && <span className={styles.supervisorBadge}>👑 监督者</span>}
                        </div>
                        {agent.description && (
                          <div
                            style={{
                              fontSize: 11,
                              opacity: 0.6,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {agent.description}
                          </div>
                        )}
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 4 }}>
                      <Tooltip title={muted ? '取消禁言' : '禁言'}>
                        <ActionIcon
                          icon={muted ? MicOff : Mic}
                          size="small"
                          onClick={() => onToggleMute(agent.id)}
                          style={{ color: muted ? '#ef4444' : '#22c55e' }}
                          title=""
                        />
                      </Tooltip>
                      <Tooltip title="移除成员">
                        <ActionIcon
                          icon={X}
                          size="small"
                          onClick={() => {
                            const newIds = currentMemberIds.filter((id) => id !== agent.id);
                            onUpdateGroup({ memberIds: newIds });
                          }}
                          title=""
                        />
                      </Tooltip>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </Drawer>
  );
};

export default AgentGroupSettings;
