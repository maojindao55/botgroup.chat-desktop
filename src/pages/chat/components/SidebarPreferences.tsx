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
    padding: 8px 12px;
    border-top: 1px solid ${token.colorBorderSecondary};
    background: ${token.colorBgContainer};
    flex: none;
  `,
  settingsBtn: css`
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 10px 12px;
    border: none;
    border-radius: 10px;
    background: transparent;
    color: ${token.colorTextSecondary};
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;

    &:hover {
      background: ${token.colorFillTertiary};
      color: ${token.colorText};
    }
  `,
  collapsedWrap: css`
    display: flex;
    justify-content: center;
    padding: 8px 0;
    border-top: 1px solid ${token.colorBorderSecondary};
    background: ${token.colorBgContainer};
    flex: none;
  `,
  collapsedTrigger: css`
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    min-height: 40px;
    padding: 0;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 10px;
    background: ${token.colorFillQuaternary};
    color: ${token.colorTextSecondary};
    cursor: pointer;
    transition: all 0.15s ease;

    &:hover {
      color: ${token.colorText};
      border-color: ${token.colorBorder};
      background: ${token.colorFillTertiary};
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
          <Settings2 size={16} style={{ color: '#ff6600', flexShrink: 0 }} />
          <span>{t('nav.settings')}</span>
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
