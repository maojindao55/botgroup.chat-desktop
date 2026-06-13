import { Settings2 } from 'lucide-react';
import { Tooltip } from 'antd';
import { createStyles } from 'antd-style';
import { useTranslation } from 'react-i18next';

import type { AppSettingsSection } from '@/config/appSettings';

interface SidebarPreferencesProps {
  isOpen: boolean;
  onOpenSettings?: (section?: AppSettingsSection) => void;
}

const useStyles = createStyles(({ token, css }) => ({
  wrapper: css`
    padding: 0 8px 8px;
    background: ${token.colorBgContainer};
    flex: none;
  `,
  settingsBtn: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
    min-height: 32px;
    padding: 5px 8px;
    border: none;
    border-radius: 7px;
    background: transparent;
    color: ${token.colorTextSecondary};
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;

    &:hover {
      background: ${token.colorFillQuaternary};
      color: ${token.colorText};
    }

    &:focus-visible {
      outline: 2px solid rgba(255, 102, 0, 0.4);
      outline-offset: 1px;
    }
  `,
  settingsLabel: css`
    display: inline-flex;
    align-items: center;
    gap: 9px;
    min-width: 0;
  `,
  iconBox: css`
    width: 24px;
    height: 24px;
    border-radius: 6px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: #ff6600;
    background: rgba(255, 102, 0, 0.08);
    flex: none;
  `,
  labelText: css`
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  collapsedWrap: css`
    display: flex;
    justify-content: center;
    padding: 0 0 8px;
    background: ${token.colorBgContainer};
    flex: none;
  `,
  collapsedTrigger: css`
    display: flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    min-height: 34px;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 7px;
    background: rgba(255, 102, 0, 0.08);
    color: ${token.colorTextSecondary};
    cursor: pointer;
    transition: all 0.15s ease;

    &:hover {
      color: ${token.colorText};
      border-color: ${token.colorBorder};
      background: ${token.colorFillQuaternary};
    }

    &:focus-visible {
      outline: 2px solid rgba(255, 102, 0, 0.4);
      outline-offset: 1px;
    }
  `,
}));

export function SidebarPreferences({ isOpen, onOpenSettings }: SidebarPreferencesProps) {
  const { styles } = useStyles();
  const { t } = useTranslation('sidebar');

  const openGeneral = () => onOpenSettings?.('general');

  if (isOpen) {
    return (
      <div className={styles.wrapper}>
        <button
          type="button"
          className={styles.settingsBtn}
          onClick={openGeneral}
          aria-label={t('nav.settings')}
        >
          <span className={styles.settingsLabel}>
            <span className={styles.iconBox}>
              <Settings2 size={15} strokeWidth={2} />
            </span>
            <span className={styles.labelText}>{t('nav.settings')}</span>
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className={styles.collapsedWrap}>
      <Tooltip title={t('nav.settings')} placement="right" mouseEnterDelay={0.15}>
        <button
          type="button"
          className={styles.collapsedTrigger}
          onClick={openGeneral}
          aria-label={t('nav.settings')}
        >
          <Settings2 size={16} strokeWidth={2} style={{ color: '#ff6600' }} />
        </button>
      </Tooltip>
    </div>
  );
}
