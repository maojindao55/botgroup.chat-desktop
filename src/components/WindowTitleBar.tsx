import { useCallback, useEffect, useState } from 'react';
import { Minus, Square, X } from 'lucide-react';
import { createStyles } from 'antd-style';

import { isMacOS, isTauri } from '@/utils/isTauri';

const TITLE = 'BotGroup.Chat';

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
    -webkit-app-region: drag;
    app-region: drag;
  `,
  macRoot: css`
    padding-left: 12px;
  `,
  dragRegion: css`
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    height: 100%;
    -webkit-app-region: drag;
    app-region: drag;
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
    -webkit-app-region: no-drag;
    app-region: no-drag;
  `,
  macControls: css`
    order: -1;
    margin-right: 8px;
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
  className,
  maximized,
  onMinimize,
  onToggleMaximize,
  onClose,
}: {
  className?: string;
  maximized: boolean;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onClose: () => void;
}) {
  const { styles, cx } = useStyles();

  return (
    <div className={cx(styles.controls, className)}>
      <button
        type="button"
        className={styles.controlBtn}
        onClick={onMinimize}
        aria-label="Minimize"
        title="Minimize"
      >
        <Minus size={14} />
      </button>
      <button
        type="button"
        className={styles.controlBtn}
        onClick={onToggleMaximize}
        aria-label={maximized ? 'Restore' : 'Maximize'}
        title={maximized ? 'Restore' : 'Maximize'}
      >
        <Square size={12} />
      </button>
      <button
        type="button"
        className={styles.controlBtn}
        data-variant="close"
        onClick={onClose}
        aria-label="Close"
        title="Close"
      >
        <X size={14} />
      </button>
    </div>
  );
}

export function WindowTitleBar() {
  const { styles, cx } = useStyles();
  const [maximized, setMaximized] = useState(false);

  const refreshMaximized = useCallback(async () => {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    setMaximized(await getCurrentWindow().isMaximized());
  }, []);

  useEffect(() => {
    if (!isTauri) return;
    void refreshMaximized();
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void (async () => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const appWindow = getCurrentWindow();
      unlisten = await appWindow.onResized(() => {
        if (!disposed) void refreshMaximized();
      });
    })();

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [refreshMaximized]);

  if (!isTauri) return null;

  const handleMinimize = async () => {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().minimize();
  };

  const handleToggleMaximize = async () => {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const appWindow = getCurrentWindow();
    await appWindow.toggleMaximize();
    setMaximized(await appWindow.isMaximized());
  };

  const handleClose = async () => {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().close();
  };

  const controls = (
    <WindowControls
      className={isMacOS ? styles.macControls : undefined}
      maximized={maximized}
      onMinimize={() => { void handleMinimize(); }}
      onToggleMaximize={() => { void handleToggleMaximize(); }}
      onClose={() => { void handleClose(); }}
    />
  );

  return (
    <header className={cx(styles.root, isMacOS && styles.macRoot)} data-tauri-drag-region>
      {isMacOS ? controls : null}
      <div className={styles.dragRegion} data-tauri-drag-region>
        <img src="/img/logo.svg" alt="" className={styles.logo} aria-hidden />
        <span className={styles.title}>{TITLE}</span>
      </div>
      {!isMacOS ? controls : null}
    </header>
  );
}
