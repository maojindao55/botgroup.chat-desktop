import React, { useState, useEffect, useRef } from 'react';
import { Edit2 as Edit2Icon, Check as CheckIcon, X as XIcon, KeyRound } from 'lucide-react';
import { Modal, Input, Button, Tooltip } from 'antd';
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
  apiKeyLink: css`
    display: flex;
    align-items: center;
    gap: 2px;
    margin-top: 4px;
    font-size: 12px;
    color: ${token.colorTextTertiary};
    cursor: pointer;
    transition: color 0.2s;
    user-select: none;
    &:hover {
      color: #f59e0b;
      .key-icon { transform: rotate(12deg); }
    }
  `,
  keyIcon: css`
    transition: transform 0.15s;
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

  const [showApiModal, setShowApiModal] = useState(false);
  const [keys, setKeys] = useState({
    DASHSCOPE_API_KEY: '',
    ARK_API_KEY: '',
    HUNYUAN_API_KEY: '',
    GLM_API_KEY: '',
    DEEPSEEK_API_KEY: '',
    KIMI_API_KEY: '',
    BAIDU_API_KEY: '',
    OLLAMA_URL: 'http://localhost:11434/v1',
  });

  useEffect(() => {
    if (showApiModal) {
      setKeys({
        DASHSCOPE_API_KEY: localStorage.getItem('API_KEY_DASHSCOPE_API_KEY') || '',
        ARK_API_KEY: localStorage.getItem('API_KEY_ARK_API_KEY') || '',
        HUNYUAN_API_KEY: localStorage.getItem('API_KEY_HUNYUAN_API_KEY') || '',
        GLM_API_KEY: localStorage.getItem('API_KEY_GLM_API_KEY') || '',
        DEEPSEEK_API_KEY: localStorage.getItem('API_KEY_DEEPSEEK_API_KEY') || '',
        KIMI_API_KEY: localStorage.getItem('API_KEY_KIMI_API_KEY') || '',
        BAIDU_API_KEY: localStorage.getItem('API_KEY_BAIDU_API_KEY') || '',
        OLLAMA_URL: localStorage.getItem('API_KEY_OLLAMA_URL') || 'http://localhost:11434/v1',
      });
    }
  }, [showApiModal]);

  const handleSaveKeys = () => {
    localStorage.setItem('API_KEY_DASHSCOPE_API_KEY', keys.DASHSCOPE_API_KEY);
    localStorage.setItem('API_KEY_ARK_API_KEY', keys.ARK_API_KEY);
    localStorage.setItem('API_KEY_HUNYUAN_API_KEY', keys.HUNYUAN_API_KEY);
    localStorage.setItem('API_KEY_GLM_API_KEY', keys.GLM_API_KEY);
    localStorage.setItem('API_KEY_DEEPSEEK_API_KEY', keys.DEEPSEEK_API_KEY);
    localStorage.setItem('API_KEY_KIMI_API_KEY', keys.KIMI_API_KEY);
    localStorage.setItem('API_KEY_BAIDU_API_KEY', keys.BAIDU_API_KEY);
    localStorage.setItem('API_KEY_OLLAMA_URL', keys.OLLAMA_URL);

    localStorage.setItem('token', 'local_desktop_token_placeholder');

    toast.success('API 密钥及地址已保存！');
    setShowApiModal(false);
  };

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
    <>
      <Modal
        title="本地 API 密钥设置"
        open={showApiModal}
        onCancel={() => setShowApiModal(false)}
        width={480}
        footer={
          <>
            <Button onClick={() => setShowApiModal(false)}>取消</Button>
            <Button
              type="primary"
              onClick={handleSaveKeys}
              style={{ background: '#ff6600', borderColor: '#ff6600' }}
            >
              保存配置
            </Button>
          </>
        }
        styles={{ body: { maxHeight: '55vh', overflow: 'auto' } }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 8 }}>
          <p style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', margin: 0 }}>
            这些密钥会安全地储存在您的本地浏览器缓存中，不会经过任何中转服务器。
          </p>
          {([
            { key: 'OLLAMA_URL', label: 'Ollama 接口地址 (本地大模型)', placeholder: 'e.g. http://localhost:11434/v1', password: false },
            { key: 'DASHSCOPE_API_KEY', label: '阿里通义千问 (DASHSCOPE_API_KEY)', placeholder: 'sk-...', password: true },
            { key: 'ARK_API_KEY', label: '火山引擎豆包 (ARK_API_KEY)', placeholder: 'sk-...', password: true },
            { key: 'HUNYUAN_API_KEY', label: '腾讯混元大模型 (HUNYUAN_API_KEY)', placeholder: 'sk-...', password: true },
            { key: 'GLM_API_KEY', label: '智谱 GLM (GLM_API_KEY)', placeholder: 'sk-...', password: true },
            { key: 'DEEPSEEK_API_KEY', label: 'DeepSeek 官方 (DEEPSEEK_API_KEY)', placeholder: 'sk-...', password: true },
            { key: 'KIMI_API_KEY', label: '月之暗面 Kimi (KIMI_API_KEY)', placeholder: 'sk-...', password: true },
            { key: 'BAIDU_API_KEY', label: '百度千帆大模型 (BAIDU_API_KEY)', placeholder: 'sk-...', password: true },
          ] as const).map((field) => (
            <div key={field.key}>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                {field.label}
              </label>
              {field.password ? (
                <Input.Password
                  placeholder={field.placeholder}
                  value={keys[field.key]}
                  onChange={(e) => setKeys((prev) => ({ ...prev, [field.key]: e.target.value }))}
                />
              ) : (
                <Input
                  placeholder={field.placeholder}
                  value={keys[field.key]}
                  onChange={(e) => setKeys((prev) => ({ ...prev, [field.key]: e.target.value }))}
                />
              )}
            </div>
          ))}
        </div>
      </Modal>

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

          {!isEditing && (
            <div className={styles.apiKeyLink} onClick={() => setShowApiModal(true)}>
              <KeyRound size={12} className={`key-icon ${styles.keyIcon}`} />
              <span>API 密钥配置</span>
            </div>
          )}
        </div>
      </div>
    </>
  );
};
