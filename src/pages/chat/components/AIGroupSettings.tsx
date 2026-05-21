/**
 * AI 群聊配置面板 - 成员管理 + 调度策略配置
 * 用于 AI 群聊的 MembersManagement 替代组件
 */
import { useState } from 'react';
import { Drawer, Switch, Button, Tooltip } from 'antd';
import { Avatar as LobeAvatar, ActionIcon } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { UserPlus, Mic, MicOff, Check, X } from 'lucide-react';
import { getAvailableAICharacters } from '@/config/aiCharacters';
import type { AICharacter } from '@/config/aiCharacters';
import type { AIGroup } from '@/config/groups';
import { getAvatarData, resolveAvatarByName } from '@/utils/avatar';

interface User {
  id: number | string;
  name: string;
  avatar?: string;
}

interface AIGroupSettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group: AIGroup;
  users: (User | AICharacter)[];
  mutedUsers: string[];
  onToggleMute: (userId: string) => void;
  isGroupDiscussionMode: boolean;
  onToggleGroupDiscussion: () => void;
  schedulerStrategy: 'tag' | 'round_robin' | 'all';
  onStrategyChange: (strategy: 'tag' | 'round_robin' | 'all') => void;
  onAddMember?: (memberId: string) => void;
  onRemoveMember?: (memberId: string) => void;
}

const useStyles = createStyles(({ token, css }) => ({
  panel: css`
    background: ${token.colorFillTertiary};
    border-radius: 12px;
    padding: 16px;
  `,
  row: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
  `,
  strategyBtn: css`
    width: 100%;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px;
    border-radius: 8px;
    border: 1px solid ${token.colorBorderSecondary};
    background: transparent;
    text-align: left;
    cursor: pointer;
    transition: all 0.15s;
    &:hover {
      background: ${token.colorFillTertiary};
    }
  `,
  strategyBtnActive: css`
    border-color: #ff6600;
    background: rgba(255, 102, 0, 0.08);
  `,
  memberRow: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px;
    border-radius: 8px;
    transition: background 0.15s;
    &:hover {
      background: ${token.colorFillTertiary};
    }
  `,
  addMemberBox: css`
    margin-bottom: 12px;
    padding: 12px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 8px;
    background: ${token.colorFillQuaternary};
  `,
  scrollList: css`
    max-height: calc(100vh - 420px);
    overflow: auto;
  `,
  addScrollList: css`
    max-height: 120px;
    overflow: auto;
  `,
  addMemberItem: css`
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px;
    border-radius: 6px;
    background: transparent;
    border: none;
    text-align: left;
    cursor: pointer;
    transition: background 0.15s;
    &:hover {
      background: ${token.colorFillSecondary};
    }
  `,
}));

export const AIGroupSettings = ({
  open,
  onOpenChange,
  group: _group,
  users,
  mutedUsers,
  onToggleMute,
  isGroupDiscussionMode,
  onToggleGroupDiscussion,
  schedulerStrategy,
  onStrategyChange,
  onAddMember,
  onRemoveMember,
}: AIGroupSettingsProps) => {
  const { styles, cx } = useStyles();
  const [showAddMember, setShowAddMember] = useState(false);
  const allCharacters = getAvailableAICharacters();
  const currentMemberIds = users.filter((u) => 'personality' in u).map((u) => u.id as string);
  const availableToAdd = allCharacters.filter((c) => !currentMemberIds.includes(c.id));

  return (
    <Drawer
      title="AI 群聊配置"
      placement="right"
      open={open}
      onClose={() => onOpenChange(false)}
      width={400}
      destroyOnClose={false}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* 全员讨论模式 */}
        <div className={styles.panel}>
          <div className={styles.row}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 500 }}>全员讨论模式</div>
              <div style={{ fontSize: 12, opacity: 0.6 }}>开启后全员每轮回复</div>
            </div>
            <Switch checked={isGroupDiscussionMode} onChange={onToggleGroupDiscussion} />
          </div>
        </div>

        {/* 调度策略 */}
        {!isGroupDiscussionMode && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={{ fontSize: 14, fontWeight: 500 }}>调度策略</label>
            {[
              { value: 'tag' as const, label: '标签匹配', desc: '根据消息智能匹配相关AI' },
              { value: 'round_robin' as const, label: '轮询', desc: '按顺序轮流回复' },
              { value: 'all' as const, label: '全员', desc: '所有成员都回复' },
            ].map((item) => (
              <button
                key={item.value}
                onClick={() => onStrategyChange(item.value)}
                className={cx(
                  styles.strategyBtn,
                  schedulerStrategy === item.value && styles.strategyBtnActive,
                )}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 500 }}>{item.label}</div>
                  <div style={{ fontSize: 10, opacity: 0.6 }}>{item.desc}</div>
                </div>
                {schedulerStrategy === item.value && (
                  <Check size={14} style={{ color: '#ff6600' }} />
                )}
              </button>
            ))}
          </div>
        )}

        {/* 成员管理 */}
        <div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 12,
            }}
          >
            <span style={{ fontSize: 14, fontWeight: 500 }}>群成员（{users.length}）</span>
            <Button
              size="small"
              icon={<UserPlus size={14} />}
              onClick={() => setShowAddMember(!showAddMember)}
            >
              添加成员
            </Button>
          </div>

          {/* 添加成员面板 */}
          {showAddMember && availableToAdd.length > 0 && (
            <div className={styles.addMemberBox}>
              <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 8 }}>点击添加到群聊</div>
              <div className={styles.addScrollList}>
                {availableToAdd.map((char) => {
                  const a = getAvatarData(char.name);
                  const url = resolveAvatarByName(char.name, char.avatar);
                  return (
                    <button
                      key={char.id}
                      onClick={() => onAddMember?.(char.id)}
                      className={styles.addMemberItem}
                    >
                      <LobeAvatar
                        avatar={url || a.text}
                        background={a.backgroundColor}
                        size={24}
                      />
                      <span style={{ fontSize: 12, flex: 1 }}>{char.name}</span>
                      <UserPlus size={12} style={{ opacity: 0.6 }} />
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* 成员列表 */}
          <div className={styles.scrollList}>
            {users.map((user) => {
              const a = getAvatarData(user.name);
              const url = resolveAvatarByName(user.name, user.avatar);
              const isAI = 'personality' in user;
              const muted = mutedUsers.includes(user.id as string);
              return (
                <div key={user.id} className={styles.memberRow}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <LobeAvatar
                      avatar={url || a.text}
                      background={a.backgroundColor}
                      size={32}
                    />
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontSize: 14 }}>{user.name}</span>
                      {muted && (
                        <span style={{ fontSize: 10, color: '#ef4444' }}>已禁言</span>
                      )}
                    </div>
                  </div>
                  {user.name !== '我' && (
                    <div style={{ display: 'flex', gap: 4 }}>
                      <Tooltip title={muted ? '取消禁言' : '禁言'}>
                        <ActionIcon
                          icon={muted ? MicOff : Mic}
                          size="small"
                          onClick={() => onToggleMute(user.id as string)}
                          style={{ color: muted ? '#ef4444' : '#22c55e' }}
                          title=""
                        />
                      </Tooltip>
                      {isAI && (
                        <Tooltip title="移除成员">
                          <ActionIcon
                            icon={X}
                            size="small"
                            onClick={() => onRemoveMember?.(user.id as string)}
                            title=""
                          />
                        </Tooltip>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Drawer>
  );
};

export default AIGroupSettings;
