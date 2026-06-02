import { Globe, Monitor, Moon, Sun } from 'lucide-react';
import { Tooltip } from 'antd';
import { createStyles } from 'antd-style';
import { useTranslation } from 'react-i18next';

import { useLocale } from '@/hooks/use-locale';
import { useTheme } from '@/hooks/use-theme';
import type { LocalePreference } from '@/i18n';
import { AppVersionBadge } from './AppVersionBadge';

type ThemeOption = 'system' | 'light' | 'dark';

const useStyles = createStyles(({ token, css }) => ({
  root: css`
    display: flex;
    flex-direction: column;
    gap: 20px;
    max-width: 420px;
  `,
  heading: css`
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: ${token.colorText};
  `,
  description: css`
    margin: 6px 0 0;
    font-size: 13px;
    color: ${token.colorTextSecondary};
    line-height: 1.5;
  `,
  field: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
  `,
  label: css`
    font-size: 13px;
    font-weight: 500;
    color: ${token.colorText};
  `,
  track: css`
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px;
    border-radius: 10px;
    background: ${token.colorFillQuaternary};
    border: 1px solid ${token.colorBorderSecondary};
  `,
  option: css`
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: 36px;
    padding: 0 10px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: ${token.colorTextSecondary};
    font-size: 13px;
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
}));

export function GeneralSettingsPanel() {
  const { styles, cx } = useStyles();
  const { t } = useTranslation(['appSettings', 'sidebar', 'common']);
  const { theme, setTheme } = useTheme();
  const { locale, setLocale } = useLocale();

  const themeOptions: { value: ThemeOption; icon: typeof Monitor; title: string }[] = [
    { value: 'system', icon: Monitor, title: t('sidebar:preferences.themeSystem') },
    { value: 'light', icon: Sun, title: t('sidebar:preferences.themeLight') },
    { value: 'dark', icon: Moon, title: t('sidebar:preferences.themeDark') },
  ];

  const localeOptions: {
    value: LocalePreference;
    label: string;
    title: string;
    icon?: typeof Globe;
  }[] = [
    { value: 'system', label: t('common:locale.systemShort'), title: t('common:locale.system'), icon: Globe },
    { value: 'zh-CN', label: '中', title: t('common:locale.zhCN') },
    { value: 'en-US', label: 'EN', title: t('common:locale.enUS') },
  ];

  return (
    <div className={styles.root}>
      <div>
        <h3 className={styles.heading}>{t('appSettings:general.heading')}</h3>
        <p className={styles.description}>{t('appSettings:general.description')}</p>
      </div>

      <div className={styles.field}>
        <span className={styles.label}>{t('sidebar:preferences.appearance')}</span>
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
                <Icon size={16} strokeWidth={2} />
                <span>{title}</span>
              </button>
            </Tooltip>
          ))}
        </div>
      </div>

      <div className={styles.field}>
        <span className={styles.label}>{t('sidebar:preferences.language')}</span>
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
                {Icon ? <Icon size={15} strokeWidth={2} /> : null}
                <span>{label}</span>
              </button>
            </Tooltip>
          ))}
        </div>
      </div>

      <AppVersionBadge />
    </div>
  );
}
