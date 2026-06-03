import React, { useEffect, useState } from 'react';
import { Modal } from 'antd';
import {
  Cpu,
  Settings2,
  Sparkles,
  Terminal,
  X,
  Server,
} from 'lucide-react';
import { createStyles } from 'antd-style';
import { useTranslation } from 'react-i18next';

import type { AppSettingsSection } from '@/config/appSettings';
import { APP_SETTINGS_SECTIONS } from '@/config/appSettings';
import type { Group } from '@/config/groups';
import { GeneralSettingsPanel } from './GeneralSettingsPanel';
import { ResourceLibraryContent } from './ResourceLibraryContent';

const useStyles = createStyles(({ token, css }) => ({
  shell: css`
    display: flex;
    height: min(720px, calc(100vh - 120px));
    min-height: 480px;
    overflow: hidden;
    background: ${token.colorBgContainer};
  `,
  nav: css`
    width: 200px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 12px;
    border-right: 1px solid ${token.colorBorderSecondary};
    background: ${token.colorBgContainer};
    overflow-y: auto;
  `,
  navItem: css`
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
    text-align: left;
    cursor: pointer;
    transition: all 0.15s ease;

    &:hover {
      background: ${token.colorFillTertiary};
      color: ${token.colorText};
    }
  `,
  navItemActive: css`
    background: rgba(255, 102, 0, 0.1) !important;
    color: #ff6600 !important;
    font-weight: 600;
  `,
  main: css`
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: ${token.colorBgLayout};
  `,
  mainScroll: css`
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 24px 28px;
    background: ${token.colorBgLayout};
  `,
  modalTitle: css`
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 16px;
    font-weight: 600;
  `,
}));

const SECTION_ICONS: Record<AppSettingsSection, typeof Settings2> = {
  general: Settings2,
  providers: Server,
  llm: Cpu,
  agent: Sparkles,
  cli: Terminal,
};

export interface AppSettingsModalProps {
  open: boolean;
  onClose: () => void;
  groups: Group[];
  /** 打开时默认选中的分区 */
  initialSection?: AppSettingsSection;
}

export const AppSettingsModal: React.FC<AppSettingsModalProps> = ({
  open,
  onClose,
  groups,
  initialSection = 'general',
}) => {
  const { styles, cx } = useStyles();
  const { t } = useTranslation('appSettings');
  const [section, setSection] = useState<AppSettingsSection>(initialSection);

  useEffect(() => {
    if (open) {
      setSection(initialSection);
    }
  }, [open, initialSection]);

  return (
    <Modal
      title={(
        <span className={styles.modalTitle}>
          <Settings2 size={18} style={{ color: '#ff6600' }} />
          {t('title')}
        </span>
      )}
      open={open}
      onCancel={onClose}
      footer={null}
      width={960}
      destroyOnClose
      closeIcon={<X size={16} />}
      styles={{
        body: { padding: 0 },
        content: { overflow: 'hidden' },
      }}
      aria-label={t('title')}
    >
      <div className={styles.shell}>
        <nav className={styles.nav} aria-label={t('title')}>
          {APP_SETTINGS_SECTIONS.map((key) => {
            const Icon = SECTION_ICONS[key];
            return (
              <button
                key={key}
                type="button"
                className={cx(styles.navItem, section === key && styles.navItemActive)}
                onClick={() => setSection(key)}
                aria-current={section === key ? 'page' : undefined}
              >
                <Icon size={16} style={{ flexShrink: 0 }} />
                <span>{t(`nav.${key}`)}</span>
              </button>
            );
          })}
        </nav>

        <div className={styles.main}>
          {section === 'general' ? (
            <div className={styles.mainScroll}>
              <GeneralSettingsPanel />
            </div>
          ) : (
            <ResourceLibraryContent
              section={section}
              groups={groups}
              active={open}
            />
          )}
        </div>
      </div>
    </Modal>
  );
};
