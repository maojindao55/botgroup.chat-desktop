import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createStyles } from 'antd-style';
import { toast } from 'sonner';
import { ArrowUpCircle, Loader2, RefreshCw } from 'lucide-react';

import { useAppVersion } from '@/hooks/use-app-version';
import { checkForUpdate } from '@/utils/checkUpdate';

const isTauri =
  typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__ !== undefined;

/** 在桌面端用系统默认浏览器打开链接，其他环境回退到 window.open。 */
async function openExternal(url: string): Promise<void> {
  if (isTauri) {
    try {
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(url);
      return;
    } catch {
      // 回退到 window.open
    }
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

const useStyles = createStyles(({ token, css }) => ({
  row: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding-top: 2px;
  `,
  version: css`
    font-size: 11px;
    color: ${token.colorTextTertiary};
    user-select: text;
    letter-spacing: 0.01em;
  `,
  action: css`
    display: inline-flex;
    align-items: center;
    gap: 4px;
    border: none;
    background: transparent;
    padding: 2px 6px;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 500;
    color: ${token.colorTextSecondary};
    cursor: pointer;
    transition: all 0.15s ease;

    &:hover {
      color: ${token.colorText};
      background: ${token.colorFillTertiary};
    }

    &:disabled {
      cursor: default;
      opacity: 0.6;
    }
  `,
  actionUpdate: css`
    color: #ff6600;

    &:hover {
      color: #ff6600;
      background: rgba(255, 102, 0, 0.1);
    }
  `,
  spin: css`
    @keyframes app-version-spin {
      to {
        transform: rotate(360deg);
      }
    }
    animation: app-version-spin 0.8s linear infinite;
  `,
}));

type Status = 'idle' | 'checking' | 'update';

/**
 * 侧边栏底部的版本号 + 轻量「检查更新」入口。
 * 检查到新版本时高亮，点击跳转到 GitHub Release 下载页。
 */
export function AppVersionBadge() {
  const { styles, cx } = useStyles();
  const { t } = useTranslation('sidebar');
  const version = useAppVersion();
  const [status, setStatus] = useState<Status>('idle');
  const [latest, setLatest] = useState<{ version: string; url: string } | null>(null);

  const handleCheck = async () => {
    if (status === 'checking') return;
    setStatus('checking');
    try {
      const result = await checkForUpdate(version);
      if (result.hasUpdate && result.latestVersion) {
        setLatest({ version: result.latestVersion, url: result.releaseUrl });
        setStatus('update');
        toast.success(t('version.available', { version: result.latestVersion }));
      } else {
        setStatus('idle');
        toast.success(t('version.latest'));
      }
    } catch {
      setStatus('idle');
      toast.error(t('version.error'));
    }
  };

  return (
    <div className={styles.row}>
      <span className={styles.version}>v{version}</span>
      {status === 'update' && latest ? (
        <button
          type="button"
          className={cx(styles.action, styles.actionUpdate)}
          onClick={() => openExternal(latest.url)}
        >
          <ArrowUpCircle size={12} strokeWidth={2} />
          <span>{t('version.updateAction')}</span>
        </button>
      ) : (
        <button
          type="button"
          className={styles.action}
          onClick={handleCheck}
          disabled={status === 'checking'}
        >
          {status === 'checking' ? (
            <Loader2 size={12} strokeWidth={2} className={styles.spin} />
          ) : (
            <RefreshCw size={12} strokeWidth={2} />
          )}
          <span>{status === 'checking' ? t('version.checking') : t('version.check')}</span>
        </button>
      )}
    </div>
  );
}
