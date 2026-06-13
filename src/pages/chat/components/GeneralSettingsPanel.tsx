import { useEffect, useMemo } from 'react';
import { Globe, Monitor, Moon, Sun } from 'lucide-react';
import { InputNumber, Select, Switch, Tooltip } from 'antd';
import { createStyles } from 'antd-style';
import { useTranslation } from 'react-i18next';

import { useLocale } from '@/hooks/use-locale';
import { useTheme } from '@/hooks/use-theme';
import type { LocalePreference } from '@/i18n';
import { useProviderStore } from '@/store/providerStore';
import { useAgentWorkflowPlannerSettings } from '@/store/agentWorkflowPlannerSettings';
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

export function GeneralSettingsPanel() {
  const { styles, cx } = useStyles();
  const { t } = useTranslation(['appSettings', 'sidebar', 'common']);
  const { theme, setTheme } = useTheme();
  const { locale, setLocale } = useLocale();
  const providersRecord = useProviderStore(s => s.providers);
  const loadProviders = useProviderStore(s => s.load);
  const plannerSettings = useAgentWorkflowPlannerSettings(s => s.settings);
  const updatePlannerSettings = useAgentWorkflowPlannerSettings(s => s.update);

  useEffect(() => {
    if (Object.keys(providersRecord).length === 0) {
      loadProviders().catch(() => { /* ignore */ });
    }
  }, [providersRecord, loadProviders]);

  const enabledProviders = useMemo(
    () => Object.values(providersRecord).filter(p => p.enabled !== false),
    [providersRecord],
  );
  const selectedProvider = enabledProviders.find(p => p.id === plannerSettings.providerId);
  const modelOptions = selectedProvider?.models ?? [];
  const llmEnabled = plannerSettings.mode === 'llm';

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

      <section className={styles.section} aria-labelledby="settings-planner">
        <h3 id="settings-planner" className={styles.sectionTitle}>
          {t('appSettings:generalPanel.workflowPlanner')}
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', maxWidth: 420 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Switch
              checked={llmEnabled}
              onChange={(checked) => updatePlannerSettings({ mode: checked ? 'llm' : 'rule' })}
            />
            <span style={{ fontSize: 13 }}>
              {t('appSettings:generalPanel.workflowPlannerEnable')}
            </span>
          </div>
          <div style={{ fontSize: 12, color: '#64748b' }}>
            {t('appSettings:generalPanel.workflowPlannerDescription')}
          </div>
          {llmEnabled ? (
            <>
              <div>
                <div style={{ fontSize: 12, marginBottom: 4, color: '#475569' }}>
                  {t('appSettings:generalPanel.workflowPlannerProvider')}
                </div>
                <Select
                  placeholder={t('appSettings:generalPanel.workflowPlannerProviderPlaceholder')}
                  value={plannerSettings.providerId || undefined}
                  onChange={(value) => {
                    const provider = enabledProviders.find(p => p.id === value);
                    const fallbackModel = provider?.models?.[0] || '';
                    updatePlannerSettings({
                      providerId: value || '',
                      model: provider?.models?.includes(plannerSettings.model) ? plannerSettings.model : fallbackModel,
                    });
                  }}
                  style={{ width: '100%' }}
                  allowClear
                >
                  {enabledProviders.map(p => (
                    <Select.Option key={p.id} value={p.id}>{p.name || p.id}</Select.Option>
                  ))}
                </Select>
              </div>
              <div>
                <div style={{ fontSize: 12, marginBottom: 4, color: '#475569' }}>
                  {t('appSettings:generalPanel.workflowPlannerModel')}
                </div>
                <Select
                  placeholder={t('appSettings:generalPanel.workflowPlannerModelPlaceholder')}
                  value={plannerSettings.model || undefined}
                  onChange={(value) => updatePlannerSettings({ model: value || '' })}
                  disabled={!plannerSettings.providerId}
                  style={{ width: '100%' }}
                  allowClear
                >
                  {modelOptions.map(m => (
                    <Select.Option key={m} value={m}>{m}</Select.Option>
                  ))}
                </Select>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, color: '#475569' }}>
                  {t('appSettings:generalPanel.workflowPlannerTemperature')}
                </span>
                <InputNumber
                  min={0}
                  max={2}
                  step={0.1}
                  value={plannerSettings.temperature}
                  onChange={(value) => {
                    if (typeof value === 'number' && Number.isFinite(value)) {
                      updatePlannerSettings({ temperature: value });
                    }
                  }}
                  size="small"
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Switch
                  checked={plannerSettings.alwaysConfirmBeforeRun}
                  onChange={(checked) => updatePlannerSettings({ alwaysConfirmBeforeRun: checked })}
                />
                <span style={{ fontSize: 13 }}>
                  {t('appSettings:generalPanel.workflowPlannerAlwaysConfirm')}
                </span>
              </div>
              <div style={{ fontSize: 12, color: '#64748b' }}>
                {t('appSettings:generalPanel.workflowPlannerAlwaysConfirmDescription')}
              </div>
            </>
          ) : null}
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
