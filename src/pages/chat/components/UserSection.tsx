import React, { useState, useRef } from 'react';
import { Edit2 as Edit2Icon, Check as CheckIcon, X as XIcon } from 'lucide-react';
import { Input, Tooltip } from 'antd';
import { Avatar as LobeAvatar, ActionIcon } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { request } from '@/utils/request';
import { useUserStore } from '@/store/userStore';
import { getAvatarData } from '@/utils/avatar';
import { toast } from 'sonner';

const useStyles = createStyles(({ token, css }) => ({
  container: css`
    padding: 12px;
    border-top: 1px solid ${token.colorBorderSecondary};
    border-bottom: 1px solid ${token.colorBorderSecondary};
    height: 80px;
    display: flex;
    align-items: center;
    gap: 12px;
    transition: background 0.15s;
    &:hover { background: ${token.colorFillTertiary}; }
  `,
  avatarWrap: css`
    position: relative;
    cursor: pointer;
    &:hover .avatar-overlay {
      opacity: 1;
    }
  `,
  avatarOverlay: css`
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background: rgba(0,0,0,0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: opacity 0.15s;
  `,
  infoCol: css`
    display: flex;
    flex-direction: column;
    position: relative;
    flex: 1;
    min-width: 0;
  `,
  nicknameRow: css`
    display: flex;
    align-items: center;
    cursor: pointer;
    &:hover .edit-icon {
      opacity: 1;
    }
  `,
  nickname: css`
    font-size: 14px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100px;
    transition: color 0.15s;
  `,
  editIcon: css`
    margin-left: 4px;
    opacity: 0;
    transition: opacity 0.15s;
    cursor: pointer;
  `,
}));

interface UserSectionProps {
  isOpen: boolean;
}

export const UserSection: React.FC<UserSectionProps> = ({ isOpen }) => {
  const { styles } = useStyles();
  const [isLoading, setIsLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [newNickname, setNewNickname] = useState('');
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const userStore = useUserStore();

  const updateNickname = async () => {
    if (!newNickname.trim()) return;

    try {
      setIsLoading(true);
      const response = await request('/api/user/update', {
        method: 'POST',
        body: JSON.stringify({ nickname: newNickname.trim() })
      });
      const { data } = await response.json();
      userStore.setUserInfo(data);
      toast.success('更新昵称成功');
      setIsEditing(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '更新昵称失败');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAvatarUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setUploadingAvatar(true);
      toast.info('本地版暂不支持云端头像上传，头像将以昵称首字渲染');
    } catch (error) {
      console.error('上传头像失败:', error);
    } finally {
      setUploadingAvatar(false);
    }
  };

  if (!isOpen || !userStore.userInfo || !userStore.userInfo.status) return null;

  const avatarData = getAvatarData(userStore.userInfo?.nickname || '我');

  return (
    <div className={styles.container}>
      <div className={styles.avatarWrap}>
        <input
          type="file"
          ref={fileInputRef}
          style={{ display: 'none' }}
          accept="image/*"
          onChange={handleAvatarUpload}
        />
        <div onClick={() => !uploadingAvatar && fileInputRef.current?.click()}>
          <LobeAvatar
            shape="circle"
            avatar={userStore.userInfo?.avatar_url || avatarData.text}
            background={avatarData.backgroundColor}
            size={40}
          />
          <div
            className={`avatar-overlay ${styles.avatarOverlay}`}
            onClick={() => !uploadingAvatar && fileInputRef.current?.click()}
          >
            {uploadingAvatar ? (
              <div
                style={{
                  width: 20,
                  height: 20,
                  border: '2px solid #fff',
                  borderTopColor: 'transparent',
                  borderRadius: '50%',
                  animation: 'spin 1s linear infinite',
                }}
              />
            ) : (
              <Edit2Icon size={16} style={{ color: '#fff' }} />
            )}
          </div>
        </div>
      </div>

      <div className={styles.infoCol}>
        <div className={styles.nicknameRow}>
          {isEditing ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <Input
                size="small"
                value={newNickname}
                onChange={(e) => setNewNickname(e.target.value)}
                placeholder={userStore.userInfo?.nickname || '输入新昵称'}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') updateNickname();
                  if (e.key === 'Escape') setIsEditing(false);
                }}
                autoFocus
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Tooltip title="保存">
                  <ActionIcon
                    icon={CheckIcon}
                    size="small"
                    onClick={updateNickname}
                    style={{ color: '#10b981' }}
                    title=""
                  />
                </Tooltip>
                <Tooltip title="取消">
                  <ActionIcon
                    icon={XIcon}
                    size="small"
                    onClick={() => setIsEditing(false)}
                    style={{ color: '#ef4444' }}
                    title=""
                  />
                </Tooltip>
              </div>
            </div>
          ) : (
            <>
              <span className={styles.nickname}>
                {isLoading ? '加载中...' : userStore.userInfo?.nickname || '本地用户'}
              </span>
              <Edit2Icon
                size={12}
                className={`edit-icon ${styles.editIcon}`}
                style={{ opacity: 0.5 }}
                onClick={() => {
                  setIsEditing(true);
                  setNewNickname(userStore.userInfo?.nickname || '');
                }}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
};
