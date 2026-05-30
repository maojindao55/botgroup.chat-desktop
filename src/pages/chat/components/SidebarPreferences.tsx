import { Globe, Monitor, Moon, Sun } from 'lucide-react';
import { Popover, Tooltip } from 'antd';
import { createStyles } from 'antd-style';
import { useTranslation } from 'react-i18next';

import { useLocale } from '@/hooks/use-locale';
import { useTheme } from '@/hooks/use-theme';
import type { LocalePreference } from '@/i18n';

type ThemeOption = 'system' | 'light' | 'dark';

interface SidebarPreferencesProps {
  isOpen: boolean;
}

const useStyles = createStyles(({ token, css }) => ({
  wrapper: css`
    padding: 8px 12px;
    border-top: 1px solid ${token.colorBorderSecondary};
    background: ${token.colorBgContainer};
    flex: none;
  `,
  panel: css`
    display: flex;
    flex-direction: column;
    gap: 6px;
  `,
  track: css`
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 3px;
    border-radius: 10px;
    background: ${token.colorFillQuaternary};
    border: 1px solid ${token.colorBorderSecondary};
  `,
  option: css`
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    min-height: 28px;
    padding: 0 6px;
    border: none;
    border-radius: 7px;
    background: transparent;
    color: ${token.colorTextSecondary};
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;

    &:hover {
      color: ${token.colorText};
      background: ${token.colorFillTertiary};
    }
  `,
  optionActive: css`
    color: ${token.colorText};
    background: ${token.colorBgContainer};
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);

    &:hover {
      background: ${token.colorBgContainer};
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
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    width: 40px;
    min-height: 52px;
    padding: 8px 0;
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
  collapsedLocale: css`
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.02em;
    line-height: 1;
  `,
  popoverPanel: css`
    width: 220px;
  `,
}));

function PreferencesPanel() {
  const { styles, cx } = useStyles();
  const { t } = useTranslation(['sidebar', 'common']);
  const { theme, setTheme } = useTheme();
  const { locale, setLocale } = useLocale();

  const themeOptions: { value: ThemeOption; icon: typeof Monitor; title: string }[] = [
    { value: 'system', icon: Monitor, title: t('sidebar:preferences.themeSystem') },
    { value: 'light', icon: Sun, title: t('sidebar:preferences.themeLight') },
    { value: 'dark', icon: Moon, title: t('sidebar:preferences.themeDark') },
  ];

  const localeOptions: { value: LocalePreference; label: string; title: string; icon?: typeof Globe }[] = [
    { value: 'system', label: t('common:locale.systemShort'), title: t('common:locale.system'), icon: Globe },
    { value: 'zh-CN', label: '中', title: t('common:locale.zhCN') },
    { value: 'en-US', label: 'EN', title: t('common:locale.enUS') },
  ];

  return (
    <div className={styles.panel}>
      <div className={styles.track} role="group" aria-label={t('sidebar:preferences.appearance')}>
        {themeOptions.map(({ value, icon: Icon, title }) => (
          <Tooltip key={value} title={title} mouseEnterDelay={0.3}>
            <button
              type="button"
              className={cx(styles.option, theme === value && styles.optionActive)}
              onClick={() => setTheme(value)}
              aria-pressed={theme === value}
              aria-label={title}
            >
              <Icon size={14} strokeWidth={2} />
            </button>
          </Tooltip>
        ))}
      </div>
      <div className={styles.track} role="group" aria-label={t('sidebar:preferences.language')}>
        {localeOptions.map(({ value, label, title, icon: Icon }) => (
          <Tooltip key={value} title={title} mouseEnterDelay={0.3}>
            <button
              type="button"
              className={cx(styles.option, locale === value && styles.optionActive)}
              onClick={() => setLocale(value)}
              aria-pressed={locale === value}
              aria-label={title}
            >
              {Icon ? <Icon size={13} strokeWidth={2} /> : null}
              <span>{label}</span>
            </button>
          </Tooltip>
        ))}
      </div>
    </div>
  );
}

export function SidebarPreferences({ isOpen }: SidebarPreferencesProps) {
  const { styles } = useStyles();
  const { t } = useTranslation('sidebar');
  const { theme } = useTheme();
  const { locale } = useLocale();

  if (isOpen) {
    return (
      <div className={styles.wrapper}>
        <PreferencesPanel />
      </div>
    );
  }

  const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;
  const LocaleIcon = locale === 'system' ? Globe : null;
  const localeLabel = locale === 'zh-CN' ? '中' : locale === 'en-US' ? 'EN' : null;

  return (
    <div className={styles.collapsedWrap}>
      <Popover
        content={<div className={styles.popoverPanel}><PreferencesPanel /></div>}
        placement="rightBottom"
        trigger="click"
        arrow={false}
      >
        <Tooltip title={t('preferences.title')} placement="right" mouseEnterDelay={0.15}>
          <button
            type="button"
            className={styles.collapsedTrigger}
            aria-label={t('preferences.title')}
          >
            <ThemeIcon size={14} strokeWidth={2} />
            {LocaleIcon ? (
              <LocaleIcon size={13} strokeWidth={2} />
            ) : (
              <span className={styles.collapsedLocale}>{localeLabel}</span>
            )}
          </button>
        </Tooltip>
      </Popover>
    </div>
  );
}
