/**
 * 角色群设置面板 - 管理群友和发言方式
 */
import { useState } from 'react';
import { Drawer, Button, Tooltip } from 'antd';
import { Avatar as LobeAvatar, ActionIcon } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { UserPlus, Mic, MicOff, Check, X } from 'lucide-react';
import type { AICharacter } from '@/config/aiCharacters';
import type { AIGroup } from '@/config/groups';
import { getAvatarData, resolveAvatarByName } from '@/utils/avatar';
import { MemberPicker } from './MemberPicker';
import { useAIMemberStore } from '@/store/aiMemberStore';
import { aiSpeechModes, applyAISpeechMode, resolveAISpeechMode } from '@/config/groupProduct';

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
  /** 新接口：批量替换成员（来自资源库 MemberPicker） */
  onMembersChange?: (memberIds: string[]) => void;
  /** 旧接口：单个添加 */
  onAddMember?: (memberId: string) => void;
  /** 旧接口：单个移除 */
  onRemoveMember?: (memberId: string) => void;
  /** 桌面端使用内联面板，移动端使用 Drawer */
  inline?: boolean;
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
  inlinePanel: css`
    width: 400px;
    height: 100%;
    display: flex;
    flex-direction: column;
    background: ${token.colorBgContainer};
    border-left: 1px solid ${token.colorBorderSecondary};
    flex-shrink: 0;
    z-index: 5;
  `,
  inlineHeader: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px;
    border-bottom: 1px solid ${token.colorBorderSecondary};
    height: 52px;
    flex-shrink: 0;
  `,
  inlineTitle: css`
    font-size: 14px;
    font-weight: 600;
    color: ${token.colorText};
  `,
  inlineCloseBtn: css`
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: ${token.colorTextSecondary};
    border-radius: 4px;
    transition: background 0.2s;
    &:hover {
      background: ${token.colorFillTertiary};
    }
  `,
  inlineContent: css`
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  `,
}));

export const AIGroupSettings = ({
  open,
  onOpenChange,
  group,
  users,
  mutedUsers,
  onToggleMute,
  isGroupDiscussionMode,
  onToggleGroupDiscussion,
  schedulerStrategy,
  onStrategyChange,
  onMembersChange,
  onAddMember,
  onRemoveMember,
  inline,
}: AIGroupSettingsProps) => {
  const { styles, cx } = useStyles();
  const [showAddMember, setShowAddMember] = useState(false);
  const allMembers = useAIMemberStore((s) => s.members);
  const speechMode = resolveAISpeechMode({
    isGroupDiscussionMode,
    schedulerStrategy,
  });

  // 优先使用 group.memberIds（id 引用模型）；fallback 到 users 里推断
  const currentMemberIds = group.memberIds
    || group.members
    || users.filter((u) => 'personality' in u).map((u) => u.id as string);

  // 从资源库取 LLM 类成员，作为可添加候选
  const availableToAdd = Object.values(allMembers)
    .filter((m) => m && m.kind === 'llm' && m.enabled !== false)
    .filter((m) => !currentMemberIds.includes(m.id));

  // 兼容两种 props 风格：优先新 onMembersChange，否则用旧 add/remove
  const handleAdd = (id: string) => {
    if (onMembersChange) {
      onMembersChange([...currentMemberIds, id]);
    } else {
      onAddMember?.(id);
    }
  };
  const handleRemove = (id: string) => {
    if (onMembersChange) {
      onMembersChange(currentMemberIds.filter((x) => x !== id));
    } else {
      onRemoveMember?.(id);
    }
  };

  const settingsContent = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <label style={{ fontSize: 14, fontWeight: 500 }}>发言方式</label>
        {aiSpeechModes.map((item) => (
          <button
            key={item.value}
            onClick={() => {
              const next = applyAISpeechMode(item.value);
              if (next.isGroupDiscussionMode !== isGroupDiscussionMode) {
                onToggleGroupDiscussion();
              }
              onStrategyChange(next.schedulerStrategy);
            }}
            className={cx(
              styles.strategyBtn,
              speechMode === item.value && styles.strategyBtnActive,
            )}
          >
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 500 }}>{item.label}</div>
              <div style={{ fontSize: 10, opacity: 0.6 }}>{item.description}</div>
            </div>
            {speechMode === item.value && (
              <Check size={14} style={{ color: '#ff6600' }} />
            )}
          </button>
        ))}
      </div>

      {/* 成员管理：MemberPicker（批量）+ 旧版「添加成员」面板（单个） */}
      <div>
        {onMembersChange && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
            <span style={{ fontSize: 14, fontWeight: 500 }}>选择角色</span>
            <MemberPicker
              kind="llm"
              value={currentMemberIds}
              onChange={(newIds) => onMembersChange(newIds)}
              placeholder="选择角色加入群聊..."
            />
          </div>
        )}

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 12,
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 500 }}>群友（{users.length}）</span>
          {availableToAdd.length > 0 && (
            <Button
              size="small"
              icon={<UserPlus size={14} />}
              onClick={() => setShowAddMember(!showAddMember)}
            >
              快速添加
            </Button>
          )}
        </div>

        {/* 快速添加面板 */}
        {showAddMember && availableToAdd.length > 0 && (
          <div className={styles.addMemberBox}>
            <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 8 }}>点击添加到群聊</div>
            <div className={styles.addScrollList}>
              {availableToAdd.map((char) => {
                const a = getAvatarData(char.name);
                const url = resolveAvatarByName(char.name, char.avatar, 24);
                return (
                  <button
                    key={char.id}
                    onClick={() => handleAdd(char.id)}
                    className={styles.addMemberItem}
                  >
                    <LobeAvatar
                      shape="circle"
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
            const url = resolveAvatarByName(user.name, user.avatar, 32);
            const isAI = 'personality' in user;
            const muted = mutedUsers.includes(user.id as string);
            return (
              <div key={user.id} className={styles.memberRow}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <LobeAvatar
                    shape="circle"
                    avatar={url || a.text}
                    background={a.backgroundColor}
                    size={32}
                  />
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: 14 }}>{user.name}</span>
                    {muted && (
                      <span style={{ fontSize: 10, color: '#ef4444', marginTop: 4 }}>已禁言</span>
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
                          onClick={() => handleRemove(user.id as string)}
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
  );

  if (inline) {
    if (!open) return null;
    return (
      <div className={styles.inlinePanel}>
        <div className={styles.inlineHeader}>
          <span className={styles.inlineTitle}>AI 群聊配置</span>
          <button className={styles.inlineCloseBtn} onClick={() => onOpenChange(false)}>
            <X size={16} />
          </button>
        </div>
        <div className={styles.inlineContent}>
          {settingsContent}
        </div>
      </div>
    );
  }

  return (
    <Drawer
      title="AI 群聊配置"
      placement="right"
      open={open}
      onClose={() => onOpenChange(false)}
      width={400}
      destroyOnClose={false}
    >
      {settingsContent}
    </Drawer>
  );
};

export default AIGroupSettings;
