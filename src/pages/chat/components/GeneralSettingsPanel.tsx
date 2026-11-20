import { useEffect, useState } from 'react';
import { Globe, Monitor, Moon, Sun } from 'lucide-react';
import { App, Button, Popconfirm, Select, Tooltip } from 'antd';
import { createStyles } from 'antd-style';
import { useTranslation } from 'react-i18next';

import { useLocale } from '@/hooks/use-locale';
import { useTheme } from '@/hooks/use-theme';
import type { LocalePreference } from '@/i18n';
import { AGE_PROFILES, loadAgeBand, saveAgeBand, type AgeBand } from '@/config/ageProfile';
import { clearKidChats } from '@/config/kidChatHistory';
import { clearKidMemory } from '@/config/kidMemory';
import { loadKidModel, saveKidModel } from '@/config/kidModel';
import { useProviderStore } from '@/store/providerStore';
import { AppVersionBadge } from './AppVersionBadge';

type ThemeOption = 'system' | 'light' | 'dark';

const useStyles = createStyles(({ token, css }) => ({
  root: css`
    display: flex;
    flex-direction: column;
    max-width: 760px;
  `,
  section: css`
    display: grid;
    grid-template-columns: 160px minmax(0, 1fr);
    align-items: center;
    gap: 16px;
    min-height: 48px;
    padding: 10px 0;
    background: ${token.colorBgContainer};
    border-bottom: 1px solid ${token.colorBorderSecondary};

    &:first-child {
      padding-top: 2px;
    }

    &:last-child {
      border-bottom: none;
    }

    @media (max-width: 720px) {
      grid-template-columns: 1fr;
      align-items: stretch;
      gap: 8px;
    }
  `,
  control: css`
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  `,
  hint: css`
    margin: 0;
    font-size: 12px;
    color: ${token.colorTextTertiary};
    line-height: 1.5;
  `,
  actions: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  `,
  sectionTitle: css`
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: ${token.colorText};
    line-height: 1.4;
  `,
  track: css`
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 3px;
    border-radius: 8px;
    background: ${token.colorFillQuaternary};
    border: 1px solid ${token.colorBorderSecondary};
    width: min(100%, 420px);
  `,
  option: css`
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: 30px;
    padding: 0 10px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: ${token.colorTextSecondary};
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;

    &:hover {
      color: ${token.colorText};
      background: ${token.colorFillTertiary};
    }

    &:focus-visible {
      outline: 2px solid ${token.colorPrimary};
      outline-offset: 1px;
    }
  `,
  optionActive: css`
    color: ${token.colorText};
    background: ${token.colorBgElevated};
    box-shadow: 0 0 0 1px ${token.colorBorderSecondary};

    &:hover {
      background: ${token.colorBgElevated};
    }
  `,
}));

function KidSettingsSections() {
  const { styles, cx } = useStyles();
  const { t } = useTranslation(['appSettings']);
  const { message } = App.useApp();
  const providers = useProviderStore((s) => s.providers);
  const loadProviders = useProviderStore((s) => s.load);
  const [ageBand, setAgeBand] = useState<AgeBand>(loadAgeBand);
  const [kidModel, setKidModel] = useState(() => {
    const saved = loadKidModel();
    return saved ? `${saved.providerId}::${saved.model}` : '';
  });

  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  const modelOptions = Object.values(providers)
    .filter((p) => p.enabled !== false && p.models.length > 0)
    .map((p) => ({
      label: p.name,
      options: p.models.map((model) => ({ label: `${p.name} / ${model}`, value: `${p.id}::${model}` })),
    }));

  const changeModel = (value: string) => {
    setKidModel(value);
    const [providerId, ...rest] = value.split('::');
    saveKidModel(value ? { providerId, model: rest.join('::') } : null);
  };

  return (
    <>
      <section className={styles.section} aria-labelledby="settings-kid-age">
        <h3 id="settings-kid-age" className={styles.sectionTitle}>
          {t('appSettings:generalPanel.kidAgeBand')}
        </h3>
        <div className={styles.control}>
          <div className={styles.track} role="group" aria-label={t('appSettings:generalPanel.kidAgeBand')}>
            {(Object.keys(AGE_PROFILES) as AgeBand[]).map((band) => (
              <button
                key={band}
                type="button"
                data-testid={`kid-age-${band}`}
                className={cx(styles.option, ageBand === band && styles.optionActive)}
                onClick={() => {
                  setAgeBand(band);
                  saveAgeBand(band);
                }}
                aria-pressed={ageBand === band}
              >
                <span>{AGE_PROFILES[band].label}</span>
              </button>
            ))}
          </div>
          <p className={styles.hint}>{t('appSettings:generalPanel.kidAgeBandHint')}</p>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="settings-kid-model">
        <h3 id="settings-kid-model" className={styles.sectionTitle}>
          {t('appSettings:generalPanel.kidModel')}
        </h3>
        <div className={styles.control}>
          <Select
            data-testid="kid-model-select"
            style={{ width: 'min(100%, 420px)' }}
            value={kidModel}
            onChange={changeModel}
            options={[{ label: t('appSettings:generalPanel.kidModelAuto'), value: '' }, ...modelOptions]}
          />
          <p className={styles.hint}>
            {modelOptions.length > 0 ? t('appSettings:generalPanel.kidModelHint') : t('appSettings:generalPanel.kidModelEmpty')}
          </p>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="settings-kid-data">
        <h3 id="settings-kid-data" className={styles.sectionTitle}>
          {t('appSettings:generalPanel.kidData')}
        </h3>
        <div className={styles.actions}>
          <Popconfirm
            title={t('appSettings:generalPanel.kidClearMemoryConfirm')}
            onConfirm={() => {
              clearKidMemory();
              message.success(t('appSettings:generalPanel.kidCleared'));
            }}
          >
            <Button>{t('appSettings:generalPanel.kidClearMemory')}</Button>
          </Popconfirm>
          <Popconfirm
            title={t('appSettings:generalPanel.kidClearChatsConfirm')}
            onConfirm={() => {
              clearKidChats();
              message.success(t('appSettings:generalPanel.kidCleared'));
            }}
          >
            <Button>{t('appSettings:generalPanel.kidClearChats')}</Button>
          </Popconfirm>
        </div>
      </section>
    </>
  );
}

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
      <KidSettingsSections />

      <section className={styles.section} aria-labelledby="settings-appearance">
        <h3 id="settings-appearance" className={styles.sectionTitle}>
          {t('appSettings:generalPanel.appearance')}
        </h3>
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
                <Icon size={16} strokeWidth={2} aria-hidden />
                <span>{title}</span>
              </button>
            </Tooltip>
          ))}
        </div>
      </section>

      <section className={styles.section} aria-labelledby="settings-language">
        <h3 id="settings-language" className={styles.sectionTitle}>
          {t('appSettings:generalPanel.language')}
        </h3>
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
                {Icon ? <Icon size={15} strokeWidth={2} aria-hidden /> : null}
                <span>{label}</span>
              </button>
            </Tooltip>
          ))}
        </div>
      </section>

      <section className={styles.section} aria-labelledby="settings-about">
        <h3 id="settings-about" className={styles.sectionTitle}>
          {t('appSettings:generalPanel.about')}
        </h3>
        <AppVersionBadge />
      </section>
    </div>
  );
};
