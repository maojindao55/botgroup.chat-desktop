import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal } from 'antd';
import {
  Cpu,
  Settings2,
  Terminal,
  X,
  Server,
} from 'lucide-react';
import { createStyles } from 'antd-style';
import { useTranslation } from 'react-i18next';

import type { AppSettingsSection } from '@/config/appSettings';
import {
  APP_SETTINGS_NAV_GROUPS,
  APP_SETTINGS_SECTIONS,
} from '@/config/appSettings';
import type { Group } from '@/config/groups';
import { GeneralSettingsPanel } from './GeneralSettingsPanel';
import { ResourceLibraryContent } from './ResourceLibraryContent';
import { SettingsSectionHeader } from './SettingsSectionHeader';

const useStyles = createStyles(({ token, css }) => ({
  shell: css`
    display: flex;
    height: min(740px, calc(100vh - 72px));
    min-height: 520px;
    overflow: hidden;
    background: ${token.colorBgContainer};

    @media (max-width: 720px) {
      min-height: min(680px, calc(100vh - 48px));
      flex-direction: column;
    }
  `,
  nav: css`
    width: 208px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 10px 8px;
    border-right: 1px solid ${token.colorBorder};
    background: ${token.colorBgContainer};
    overflow-y: auto;

    @media (max-width: 720px) {
      width: 100%;
      max-height: 148px;
      border-right: none;
      border-bottom: 1px solid ${token.colorBorderSecondary};
      padding: 8px;
    }
  `,
  navGroup: css`
    display: flex;
    flex-direction: column;
    gap: 2px;

    &:not(:first-child) {
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid ${token.colorBorderSecondary};
    }
  `,
  navGroupLabel: css`
    padding: 3px 9px 5px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: ${token.colorTextTertiary};
  `,
  navItem: css`
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    min-height: 32px;
    padding: 6px 9px;
    border: none;
    border-radius: 7px;
    background: transparent;
    color: ${token.colorTextSecondary};
    font-size: 13px;
    font-weight: 500;
    text-align: left;
    cursor: pointer;
    position: relative;
    transition: background 0.15s ease, color 0.15s ease;

    &:hover {
      background: ${token.colorFillQuaternary};
      color: ${token.colorText};
    }

    &:focus-visible {
      outline: 2px solid ${token.colorPrimary};
      outline-offset: 2px;
    }
  `,
  navItemActive: css`
    background: ${token.colorFillQuaternary} !important;
    color: ${token.colorText} !important;
    font-weight: 600;

    &::before {
      content: '';
      position: absolute;
      left: 3px;
      top: 8px;
      bottom: 8px;
      width: 3px;
      border-radius: 999px;
      background: #ff6600;
    }
  `,
  main: css`
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: ${token.colorBgContainer};
  `,
  mainBody: css`
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  `,
  mainScroll: css`
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 14px 20px 20px;
    background: ${token.colorBgContainer};
  `,
  modalTitle: css`
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 15px;
    font-weight: 600;
  `,
}));

const SECTION_ICONS: Record<AppSettingsSection, typeof Settings2> = {
  general: Settings2,
  providers: Server,
  llm: Cpu,
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
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (open) {
      setSection(initialSection);
    }
  }, [open, initialSection]);

  const sectionTitle = t(`sections.${section}.title`);
  const sectionDescription = t(`sections.${section}.description`);

  const focusNavItem = useCallback((key: AppSettingsSection) => {
    const btn = navRef.current?.querySelector<HTMLButtonElement>(`[data-section="${key}"]`);
    btn?.focus();
  }, []);

  const moveSection = useCallback((delta: number) => {
    const idx = APP_SETTINGS_SECTIONS.indexOf(section);
    const next = APP_SETTINGS_SECTIONS[idx + delta];
    if (next) {
      setSection(next);
      focusNavItem(next);
    }
  }, [section, focusNavItem]);

  const handleNavKeyDown = (event: React.KeyboardEvent, key: AppSettingsSection) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveSection(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveSection(-1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setSection(APP_SETTINGS_SECTIONS[0]);
      focusNavItem(APP_SETTINGS_SECTIONS[0]);
    } else if (event.key === 'End') {
      event.preventDefault();
      const last = APP_SETTINGS_SECTIONS[APP_SETTINGS_SECTIONS.length - 1];
      setSection(last);
      focusNavItem(last);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setSection(key);
    }
  };

  return (
    <Modal
      title={(
        <span className={styles.modalTitle}>
          <Settings2 size={18} style={{ color: '#ff6600' }} aria-hidden />
          {t('title')}
        </span>
      )}
      open={open}
      onCancel={onClose}
      footer={null}
      width={980}
      destroyOnClose
      closeIcon={<X size={16} />}
      styles={{
        body: { padding: 0 },
        content: { overflow: 'hidden', borderRadius: 10 },
      }}
      aria-label={t('title')}
    >
      <div className={styles.shell}>
        <nav
          ref={navRef}
          className={styles.nav}
          aria-label={t('title')}
          role="tablist"
          aria-orientation="vertical"
        >
          {APP_SETTINGS_NAV_GROUPS.map((group) => (
            <div key={group.labelKey} className={styles.navGroup} role="presentation">
              <div className={styles.navGroupLabel} id={`settings-group-${group.labelKey}`}>
                {t(group.labelKey)}
              </div>
              {group.sections.map((key) => {
                const Icon = SECTION_ICONS[key];
                const selected = section === key;
                return (
                  <button
                    key={key}
                    type="button"
                    data-section={key}
                    role="tab"
                    id={`settings-tab-${key}`}
                    aria-selected={selected}
                    aria-controls="settings-panel"
                    tabIndex={selected ? 0 : -1}
                    className={cx(styles.navItem, selected && styles.navItemActive)}
                    onClick={() => setSection(key)}
                    onKeyDown={(e) => handleNavKeyDown(e, key)}
                  >
                    <Icon
                      size={16}
                      style={{ flexShrink: 0, color: selected ? '#ff6600' : undefined }}
                      aria-hidden
                    />
                    <span>{t(`nav.${key}`)}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className={styles.main}>
          <SettingsSectionHeader
            title={sectionTitle}
            description={sectionDescription}
          />
          <div
            id="settings-panel"
            role="tabpanel"
            aria-labelledby={`settings-tab-${section}`}
            className={styles.mainBody}
          >
            {section === 'general' ? (
              <div className={styles.mainScroll}>
                <GeneralSettingsPanel />
              </div>
            ) : (
              <ResourceLibraryContent
                section={section}
                groups={groups}
                active={open}
                onSectionChange={setSection}
              />
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
};
