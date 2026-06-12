import React, { useEffect, useState, useRef } from 'react';
import { Edit2 as Edit2Icon, Check as CheckIcon, X as XIcon, Settings2 } from 'lucide-react';
import { Input, Tooltip } from 'antd';
import { Avatar as LobeAvatar, ActionIcon } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { useTranslation } from 'react-i18next';
import type { AppSettingsSection } from '@/config/appSettings';
import { request } from '@/utils/request';
import { useUserStore } from '@/store/userStore';
import { getAvatarData } from '@/utils/avatar';
import { uploadUserAvatar, normalizeDesktopUser } from '@/utils/userAvatar';
import { fileToDataUrl } from '@/utils/localAvatarLoader';
import { toast } from 'sonner';

const useStyles = createStyles(({ token, css }) => ({
  container: css`
    padding: 8px 8px 10px;
    background: ${token.colorBgContainer};
    flex: none;
  `,
  accountCard: css`
    display: flex;
    align-items: center;
    width: 100%;
    box-sizing: border-box;
    min-height: 44px;
    gap: 10px;
    padding: 6px 6px 6px 8px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 8px;
    background: ${token.colorFillQuaternary};
    transition: border-color 0.15s ease, background 0.15s ease;

    &:hover {
      border-color: ${token.colorBorder};
      background: ${token.colorBgContainer};
    }
  `,
  containerCollapsed: css`
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 10px 0;
    background: ${token.colorBgContainer};
    flex: none;
  `,
  avatarWrap: css`
    position: relative;
    width: 32px;
    height: 32px;
    flex: none;
    cursor: pointer;
    &:hover .avatar-overlay {
      opacity: 1;
    }
  `,
  avatarOverlay: css`
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.42);
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
    gap: 4px;
    cursor: pointer;
    min-height: 24px;
    border-radius: 7px;
    &:hover .edit-icon {
      opacity: 1;
    }
    &:hover {
      color: ${token.colorText};
    }
  `,
  nickname: css`
    font-size: 13px;
    font-weight: 600;
    line-height: 18px;
    color: ${token.colorText};
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    transition: color 0.15s;
  `,
  editIcon: css`
    opacity: 0.45;
    transition: opacity 0.15s;
    cursor: pointer;
    flex: none;
    color: ${token.colorTextTertiary};
  `,
  helperText: css`
    margin-top: 1px;
    font-size: 11px;
    line-height: 14px;
    color: ${token.colorTextTertiary};
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  settingsBtn: css`
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    flex: none;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 7px;
    background: transparent;
    color: ${token.colorTextSecondary};
    cursor: pointer;
    transition: all 0.15s ease;

    &:hover {
      color: #ff6600;
      border-color: rgba(255, 102, 0, 0.2);
      background: rgba(255, 102, 0, 0.08);
    }

    &:focus-visible {
      outline: 2px solid rgba(255, 102, 0, 0.4);
      outline-offset: 1px;
    }
  `,
  collapsedSettingsBtn: css`
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 7px;
    background: rgba(255, 102, 0, 0.08);
    color: #ff6600;
    cursor: pointer;
    transition: all 0.15s ease;

    &:hover {
      border-color: ${token.colorBorder};
      background: ${token.colorFillQuaternary};
      color: ${token.colorText};
    }
  `,
}));

interface UserSectionProps {
  isOpen: boolean;
  onOpenSettings?: (section?: AppSettingsSection) => void;
}

export const UserSection: React.FC<UserSectionProps> = ({ isOpen, onOpenSettings }) => {
  const { styles } = useStyles();
  const { t } = useTranslation(['user', 'common', 'sidebar']);
  const [isLoading, setIsLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [newNickname, setNewNickname] = useState('');
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const userInfo = useUserStore(s => s.userInfo);
  const avatarDisplaySrc = useUserStore(s => s.avatarDisplaySrc);
  const setUserInfo = useUserStore(s => s.setUserInfo);
  const setAvatarDisplaySrc = useUserStore(s => s.setAvatarDisplaySrc);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const response = await request('/api/user/info');
        const payload = await response.json();
        if (!cancelled && payload?.data) {
          setUserInfo(normalizeDesktopUser(payload.data));
        }
      } catch {
        if (!cancelled && !useUserStore.getState().userInfo.nickname) {
          setUserInfo({
            id: 0,
            phone: '',
            nickname: t('defaultNickname'),
            avatar_url: null,
            status: 1,
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [setUserInfo, t]);

  const displayName = userInfo.nickname || t('defaultNickname');

  const updateNickname = async () => {
    if (!newNickname.trim()) return;

    try {
      setIsLoading(true);
      const response = await request('/api/user/update', {
        method: 'POST',
        body: JSON.stringify({ nickname: newNickname.trim() })
      });
      const { data } = await response.json();
      setUserInfo(normalizeDesktopUser(data));
      toast.success(t('toast.nicknameUpdated'));
      setIsEditing(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('toast.nicknameUpdateFailed'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleAvatarUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setUploadingAvatar(true);
      const preview = await fileToDataUrl(file);
      setAvatarPreviewUrl(preview);
      setAvatarDisplaySrc(preview);
      const updatedUser = await uploadUserAvatar(file, displayName);
      setUserInfo(updatedUser);
      setAvatarPreviewUrl(null);
      toast.success(t('toast.avatarUpdated'));
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message === 'invalid_image_type') {
        toast.error(t('toast.avatarInvalidType'));
      } else if (message === 'image_too_large') {
        toast.error(t('toast.avatarTooLarge'));
      } else {
        toast.error(message || t('toast.avatarUploadFailed'));
      }
    } finally {
      setUploadingAvatar(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const openAvatarPicker = () => {
    if (!uploadingAvatar) {
      fileInputRef.current?.click();
    }
  };

  const openSettings = () => onOpenSettings?.('general');

  const avatarData = getAvatarData(displayName);
  const resolvedAvatar = avatarDisplaySrc || avatarPreviewUrl;

  const avatarNode = (
    <div className={styles.avatarWrap}>
      <input
        type="file"
        ref={fileInputRef}
        style={{ display: 'none' }}
        accept="image/*"
        onChange={handleAvatarUpload}
      />
      <div onClick={openAvatarPicker}>
        <LobeAvatar
          key={resolvedAvatar ?? userInfo.avatar_url ?? 'default'}
          shape="circle"
          avatar={resolvedAvatar || avatarData.text}
          background={avatarData.backgroundColor}
          size={32}
          title={displayName}
          unoptimized
        />
        {isOpen && (
          <div
            className={`avatar-overlay ${styles.avatarOverlay}`}
            onClick={(e) => {
              e.stopPropagation();
              openAvatarPicker();
            }}
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
        )}
      </div>
    </div>
  );

  if (!isOpen) {
    return (
      <div className={styles.containerCollapsed}>
        <Tooltip title={displayName} placement="right" mouseEnterDelay={0.15}>
          {avatarNode}
        </Tooltip>
        <Tooltip title={t('sidebar:nav.settings')} placement="right" mouseEnterDelay={0.15}>
          <button
            type="button"
            className={styles.collapsedSettingsBtn}
            onClick={openSettings}
            aria-label={t('sidebar:nav.settings')}
          >
            <Settings2 size={16} strokeWidth={2} />
          </button>
        </Tooltip>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.accountCard}>
        {avatarNode}

        <div className={styles.infoCol}>
          <div className={styles.nicknameRow}>
            {isEditing ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, width: '100%' }}>
                <Input
                  size="small"
                  value={newNickname}
                  onChange={(e) => setNewNickname(e.target.value)}
                  placeholder={userInfo.nickname || t('nicknamePlaceholder')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') updateNickname();
                    if (e.key === 'Escape') setIsEditing(false);
                  }}
                  autoFocus
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Tooltip title={t('common:actions.save')}>
                    <ActionIcon
                      icon={CheckIcon}
                      size="small"
                      onClick={updateNickname}
                      style={{ color: '#10b981' }}
                      title=""
                    />
                  </Tooltip>
                  <Tooltip title={t('common:actions.cancel')}>
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
                  {isLoading ? t('common:status.loading') : displayName}
                </span>
                <Edit2Icon
                  size={12}
                  className={`edit-icon ${styles.editIcon}`}
                  onClick={() => {
                    setIsEditing(true);
                    setNewNickname(userInfo.nickname || '');
                  }}
                />
              </>
            )}
          </div>
          {!isEditing && (
            <span className={styles.helperText}>
              {t('sidebar:nav.settings')}
            </span>
          )}
        </div>

        {!isEditing && (
          <Tooltip title={t('sidebar:nav.settings')} placement="top" mouseEnterDelay={0.15}>
            <button
              type="button"
              className={styles.settingsBtn}
              onClick={openSettings}
              aria-label={t('sidebar:nav.settings')}
            >
              <Settings2 size={16} strokeWidth={2} />
            </button>
          </Tooltip>
        )}
      </div>
    </div>
  );
};
