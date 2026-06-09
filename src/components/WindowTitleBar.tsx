import { useCallback, useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Minus, Square, X } from 'lucide-react';
import { createStyles } from 'antd-style';
import { useTranslation } from 'react-i18next';

import { needsCustomWindowChrome } from '@/utils/isTauri';

const useStyles = createStyles(({ token, css }) => ({
  root: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex: none;
    height: 32px;
    padding: 0 8px;
    border-bottom: 1px solid ${token.colorBorderSecondary};
    background: ${token.colorBgContainer};
    user-select: none;
  `,
  dragRegion: css`
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    height: 100%;
  `,
  title: css`
    margin: 0;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    font-weight: 600;
    color: ${token.colorTextSecondary};
    line-height: 1;
  `,
  logo: css`
    width: 14px;
    height: 14px;
    flex: none;
  `,
  controls: css`
    display: flex;
    align-items: center;
    flex: none;
    gap: 2px;
  `,
  controlBtn: css`
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 28px;
    padding: 0;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: ${token.colorTextSecondary};
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease;

    &:hover {
      background: ${token.colorFillTertiary};
      color: ${token.colorText};
    }

    &[data-variant='close']:hover {
      background: #e81123;
      color: #fff;
    }
  `,
}));

function WindowControls({
  maximized,
  labels,
  onMinimize,
  onToggleMaximize,
  onClose,
}: {
  maximized: boolean;
  labels: { minimize: string; maximize: string; restore: string; close: string };
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onClose: () => void;
}) {
  const { styles } = useStyles();
  const maximizeLabel = maximized ? labels.restore : labels.maximize;

  return (
    <div className={styles.controls}>
      <button
        type="button"
        className={styles.controlBtn}
        onClick={onMinimize}
        aria-label={labels.minimize}
        title={labels.minimize}
      >
        <Minus size={14} />
      </button>
      <button
        type="button"
        className={styles.controlBtn}
        onClick={onToggleMaximize}
        aria-label={maximizeLabel}
        title={maximizeLabel}
      >
        <Square size={12} />
      </button>
      <button
        type="button"
        className={styles.controlBtn}
        data-variant="close"
        onClick={onClose}
        aria-label={labels.close}
        title={labels.close}
      >
        <X size={14} />
      </button>
    </div>
  );
}

export function WindowTitleBar() {
  const { styles } = useStyles();
  const { t } = useTranslation('common');
  const [maximized, setMaximized] = useState(false);
  const [title, setTitle] = useState('');

  const refreshMaximized = useCallback(async () => {
    setMaximized(await getCurrentWindow().isMaximized());
  }, []);

  useEffect(() => {
    if (!needsCustomWindowChrome()) return;

    const appWindow = getCurrentWindow();
    let disposed = false;

    void (async () => {
      setTitle(await appWindow.title());
      setMaximized(await appWindow.isMaximized());
    })();

    const unlistenPromise = appWindow.onResized(() => {
      if (!disposed) void refreshMaximized();
    });

    return () => {
      disposed = true;
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [refreshMaximized]);

  if (!needsCustomWindowChrome()) return null;

  const labels = {
    minimize: t('windowChrome.minimize'),
    maximize: t('windowChrome.maximize'),
    restore: t('windowChrome.restore'),
    close: t('windowChrome.close'),
  };

  const handleMinimize = () => { void getCurrentWindow().minimize(); };
  const handleToggleMaximize = () => { void getCurrentWindow().toggleMaximize(); };
  const handleClose = () => { void getCurrentWindow().close(); };

  return (
    <header className={styles.root} data-tauri-drag-region>
      <div className={styles.dragRegion} data-tauri-drag-region>
        <img src="/img/logo.svg" alt="" className={styles.logo} aria-hidden />
        <span className={styles.title}>{title}</span>
      </div>
      <WindowControls
        maximized={maximized}
        labels={labels}
        onMinimize={handleMinimize}
        onToggleMaximize={handleToggleMaximize}
        onClose={handleClose}
      />
    </header>
  );
}
