import React, { useEffect, useMemo, useState } from 'react';
import { Button, Tag, Tooltip, Modal, Empty } from 'antd';
import { useProviderStore } from '@/store/providerStore';
import type { Provider } from '@/config/providers';
import { Plus, Edit2, Trash2, Server, CheckCircle2, AlertTriangle, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { createStyles } from 'antd-style';

const useStyles = createStyles(({ token, css }) => ({
  toolbar: css`
    display: flex;
    justify-content: flex-end;
    padding: 16px 24px 0;
  `,
  listContainer: css`
    padding: 16px 24px;
  `,
  providerCard: css`
    background: ${token.colorBgContainer};
    border-radius: 12px;
    padding: 16px;
    margin-bottom: 12px;
    border: 1px solid ${token.colorBorderSecondary};
    transition: all 0.2s ease;
    display: flex;
    gap: 16px;
    align-items: flex-start;
    &:hover {
      border-color: ${token.colorPrimaryBorderHover};
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.03);
    }
  `,
  iconWrap: css`
    width: 48px;
    height: 48px;
    border-radius: 12px;
    background: ${token.colorPrimaryBg};
    color: ${token.colorPrimary};
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  `,
  infoSection: css`
    flex: 1;
    min-width: 0;
  `,
  headerRow: css`
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
    flex-wrap: wrap;
  `,
  name: css`
    font-size: 15px;
    font-weight: 600;
    color: ${token.colorText};
  `,
  description: css`
    font-size: 13px;
    color: ${token.colorTextSecondary};
    margin-bottom: 8px;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  `,
  metaDetails: css`
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    font-size: 12px;
    color: ${token.colorTextTertiary};
    border-top: 1px dashed ${token.colorBorderSecondary};
    padding-top: 8px;
    margin-top: 8px;
  `,
  metaItem: css`
    display: flex;
    align-items: center;
    gap: 4px;
    max-width: 100%;
  `,
  baseUrl: css`
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 280px;
  `,
  actionColumn: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
  `,
  badgeBuiltin: css`
    background: ${token.colorPrimaryBg} !important;
    color: ${token.colorPrimaryText} !important;
    border: 1px solid ${token.colorPrimaryBorder} !important;
  `,
  badgeUser: css`
    background: ${token.colorFillAlter} !important;
    color: ${token.colorTextSecondary} !important;
    border: 1px solid ${token.colorBorder} !important;
  `,
  secretOk: css`
    color: ${token.colorSuccess};
    display: inline-flex;
    align-items: center;
    gap: 4px;
  `,
  secretWarn: css`
    color: ${token.colorWarning};
    display: inline-flex;
    align-items: center;
    gap: 4px;
  `,
}));

interface ProviderLibraryProps {
  onCreate: () => void;
  onEdit: (provider: Provider) => void;
}

function truncateUrl(url: string, max = 48): string {
  if (url.length <= max) return url;
  return `${url.slice(0, max - 3)}...`;
}

export const ProviderLibrary: React.FC<ProviderLibraryProps> = ({ onCreate, onEdit }) => {
  const { styles } = useStyles();
  const { providers, remove, clone, hasSecret } = useProviderStore();
  const [secretStatus, setSecretStatus] = useState<Record<string, boolean>>({});

  const providerList = useMemo(() => {
    return Object.values(providers).sort((a, b) => {
      if (a.source === 'user' && b.source === 'builtin') return -1;
      if (a.source === 'builtin' && b.source === 'user') return 1;
      return a.name.localeCompare(b.name, 'zh-CN');
    });
  }, [providers]);

  useEffect(() => {
    let cancelled = false;

    const loadSecrets = async () => {
      const entries = await Promise.all(
        providerList.map(async (p) => {
          try {
            const configured = await hasSecret(p.id);
            return [p.id, configured] as const;
          } catch {
            return [p.id, false] as const;
          }
        }),
      );

      if (!cancelled) {
        setSecretStatus(Object.fromEntries(entries));
      }
    };

    if (providerList.length > 0) {
      loadSecrets();
    } else {
      setSecretStatus({});
    }

    return () => {
      cancelled = true;
    };
  }, [providerList, hasSecret]);

  const handleDelete = (provider: Provider) => {
    Modal.confirm({
      title: '确认删除模型服务？',
      content: `确定要删除「${provider.name}」吗？此操作不可撤销。`,
      okText: '确认删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        await remove(provider.id);
      },
    });
  };

  const renderProviderItem = (provider: Provider) => {
    const configured = secretStatus[provider.id];

    return (
      <div className={styles.providerCard} key={provider.id}>
        <div className={styles.iconWrap}>
          <Server size={22} />
        </div>

        <div className={styles.infoSection}>
          <div className={styles.headerRow}>
            <span className={styles.name}>{provider.name}</span>
            <Tag className={provider.source === 'builtin' ? styles.badgeBuiltin : styles.badgeUser}>
              {provider.source === 'builtin' ? '系统预设' : '自建'}
            </Tag>
            {provider.enabled === false && <Tag color="default">已禁用</Tag>}
          </div>

          {provider.description && (
            <div className={styles.description}>{provider.description}</div>
          )}

          <div className={styles.metaDetails}>
            <div className={styles.metaItem}>
              <strong>地址:</strong>
              <Tooltip title={provider.baseURL}>
                <span className={styles.baseUrl}>{truncateUrl(provider.baseURL)}</span>
              </Tooltip>
            </div>
            <div className={styles.metaItem}>
              <strong>模型:</strong> {provider.models?.length || 0} 个
            </div>
            <div className={styles.metaItem}>
              <strong>密钥:</strong>
              {configured ? (
                <span className={styles.secretOk}>
                  <CheckCircle2 size={14} />
                  已配置
                </span>
              ) : (
                <span className={styles.secretWarn}>
                  <AlertTriangle size={14} />
                  未配置
                </span>
              )}
            </div>
          </div>
        </div>

        <div className={styles.actionColumn}>
          <Button
            type="text"
            icon={<Copy size={14} />}
            onClick={async () => {
              try {
                const copied = await clone(provider.id);
                toast.success(`已复制为「${copied.name}」`);
              } catch (e) {
                toast.error(e instanceof Error ? e.message : '复制失败');
              }
            }}
            style={{ padding: '4px 8px', height: 'auto' }}
          >
            复制
          </Button>
          <Button
            type="text"
            icon={<Edit2 size={14} />}
            onClick={() => onEdit(provider)}
            style={{ padding: '4px 8px', height: 'auto' }}
          >
            编辑
          </Button>
          {provider.source !== 'builtin' ? (
            <Button
              type="text"
              danger
              icon={<Trash2 size={14} />}
              onClick={() => handleDelete(provider)}
              style={{ padding: '4px 8px', height: 'auto' }}
            >
              删除
            </Button>
          ) : (
            <Tooltip title="内置预设服务无法删除">
              <Button
                type="text"
                disabled
                icon={<Trash2 size={14} />}
                style={{ padding: '4px 8px', height: 'auto', opacity: 0.4 }}
              >
                删除
              </Button>
            </Tooltip>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      <div className={styles.toolbar}>
        <Button type="primary" icon={<Plus size={16} />} onClick={onCreate}>
          新增模型服务
        </Button>
      </div>

      {providerList.length === 0 ? (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '300px' }}>
          <Empty description="暂无模型服务，点击上方按钮添加" />
        </div>
      ) : (
        <div className={styles.listContainer}>{providerList.map(renderProviderItem)}</div>
      )}
    </>
  );
};
