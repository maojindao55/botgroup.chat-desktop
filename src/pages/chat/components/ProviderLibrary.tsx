import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Tag, Tooltip, Modal, Empty } from 'antd';
import { useProviderStore } from '@/store/providerStore';
import type { Provider } from '@/config/providers';
import { Plus, Edit2, Trash2, Server, CheckCircle2, AlertTriangle, Copy } from 'lucide-react';
import { BRAND_ON_PRIMARY, brandPrimaryButtonProps } from '@/lib/theme';
import { toast } from 'sonner';
import { createStyles } from 'antd-style';
import { useLocale } from '@/hooks/use-locale';
import { getTranslatedProviderName } from '@/i18n/providerLabels';

const useStyles = createStyles(({ token, css }) => ({
  toolbar: css`
    display: flex;
    justify-content: flex-end;
    align-items: center;
    flex-shrink: 0;
    padding: 12px 24px;
    background: ${token.colorBgContainer};
    border-bottom: 1px solid ${token.colorBorderSecondary};
    margin: 0 0 0;
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
  const { t } = useTranslation(['library', 'common', 'product']);
  const { resolvedLocale } = useLocale();
  const { styles } = useStyles();
  const { providers, remove, clone, hasSecret } = useProviderStore();
  const [secretStatus, setSecretStatus] = useState<Record<string, boolean>>({});

  const providerList = useMemo(() => {
    return Object.values(providers).sort((a, b) => {
      if (a.source === 'user' && b.source === 'builtin') return -1;
      if (a.source === 'builtin' && b.source === 'user') return 1;
      return a.name.localeCompare(b.name, resolvedLocale);
    });
  }, [providers, resolvedLocale]);

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

  const displayProviderName = (provider: Provider) =>
    provider.source === 'builtin'
      ? getTranslatedProviderName(provider.id, provider.name)
      : provider.name;

  const handleDelete = (provider: Provider) => {
    Modal.confirm({
      title: t('library:deleteProvider.confirmTitle'),
      content: t('library:deleteProvider.confirmContent', { name: displayProviderName(provider) }),
      okText: t('common:actions.confirmDelete'),
      okType: 'danger',
      cancelText: t('common:actions.cancel'),
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
            <span className={styles.name}>{displayProviderName(provider)}</span>
            <Tag className={provider.source === 'builtin' ? styles.badgeBuiltin : styles.badgeUser}>
              {provider.source === 'builtin'
                ? t('common:badges.systemPreset')
                : t('common:badges.userCreated')}
            </Tag>
            {provider.enabled === false && <Tag color="default">{t('common:status.disabled')}</Tag>}
          </div>

          {provider.description && (
            <div className={styles.description}>{provider.description}</div>
          )}

          <div className={styles.metaDetails}>
            <div className={styles.metaItem}>
              <strong>{t('library:meta.baseUrl')}</strong>
              <Tooltip title={provider.baseURL}>
                <span className={styles.baseUrl}>{truncateUrl(provider.baseURL)}</span>
              </Tooltip>
            </div>
            <div className={styles.metaItem}>
              <strong>{t('library:meta.models')}</strong>{' '}
              {t('library:meta.modelsCount', { count: provider.models?.length || 0 })}
            </div>
            <div className={styles.metaItem}>
              <strong>{t('library:meta.secret')}</strong>
              {configured ? (
                <span className={styles.secretOk}>
                  <CheckCircle2 size={14} />
                  {t('library:meta.secretConfigured')}
                </span>
              ) : (
                <span className={styles.secretWarn}>
                  <AlertTriangle size={14} />
                  {t('library:meta.secretMissing')}
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
                toast.success(t('library:provider.copiedToast', { name: copied.name }));
              } catch (e) {
                toast.error(e instanceof Error ? e.message : t('library:provider.copyFailed'));
              }
            }}
            style={{ padding: '4px 8px', height: 'auto' }}
          >
            {t('common:actions.copy')}
          </Button>
          <Button
            type="text"
            icon={<Edit2 size={14} />}
            onClick={() => onEdit(provider)}
            style={{ padding: '4px 8px', height: 'auto' }}
          >
            {t('common:actions.edit')}
          </Button>
          {provider.source !== 'builtin' ? (
            <Button
              type="text"
              danger
              icon={<Trash2 size={14} />}
              onClick={() => handleDelete(provider)}
              style={{ padding: '4px 8px', height: 'auto' }}
            >
              {t('common:actions.delete')}
            </Button>
          ) : (
            <Tooltip title={t('library:provider.builtinDeleteTooltip')}>
              <Button
                type="text"
                disabled
                icon={<Trash2 size={14} />}
                style={{ padding: '4px 8px', height: 'auto', opacity: 0.4 }}
              >
                {t('common:actions.delete')}
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
        <Button
          icon={<Plus size={16} color={BRAND_ON_PRIMARY} />}
          onClick={onCreate}
          {...brandPrimaryButtonProps}
        >
          {t('library:create.provider')}
        </Button>
      </div>

      {providerList.length === 0 ? (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '300px' }}>
          <Empty description={t('library:empty.providers')} />
        </div>
      ) : (
        <div className={styles.listContainer}>{providerList.map(renderProviderItem)}</div>
      )}
    </>
  );
};
