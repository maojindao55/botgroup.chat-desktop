import { useEffect, useState } from 'react';
import { Globe, Monitor, Moon, Sun } from 'lucide-react';
import { App, Button, Input, Popconfirm, Select, Slider, Tooltip } from 'antd';
import { invoke } from '@tauri-apps/api/core';
import { createStyles } from 'antd-style';
import { useTranslation } from 'react-i18next';

import { useLocale } from '@/hooks/use-locale';
import { useTheme } from '@/hooks/use-theme';
import type { LocalePreference } from '@/i18n';
import { AGE_PROFILES, loadAgeBand, saveAgeBand, type AgeBand } from '@/config/ageProfile';
import { clearKidChats } from '@/config/kidChatHistory';
import { clearKidMemory } from '@/config/kidMemory';
import { loadKidModel, saveKidModel } from '@/config/kidModel';
import {
  KID_VOICE_OPTIONS,
  SPEECH_ENDPOINTS,
  SPEECH_SECRET_NAME,
  loadSpeechConfig,
  saveSpeechConfig,
  voiceForSpeaker,
  type SpeechConfig,
  type SpeechEngine,
} from '@/config/speechConfig';
import { synthesizeWithQwen } from '@/lib/speech/qwenSpeech';
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

function SpeechSettingsSections() {
  const { styles, cx } = useStyles();
  const { t } = useTranslation(['appSettings']);
  const { message } = App.useApp();
  const providers = useProviderStore((s) => s.providers);
  const [config, setConfig] = useState<SpeechConfig>(loadSpeechConfig);
  const [keySaved, setKeySaved] = useState(false);
  const [keyDraft, setKeyDraft] = useState('');
  const [previewing, setPreviewing] = useState(false);

  const refreshKeyState = () =>
    invoke<boolean>('secret_has', { name: SPEECH_SECRET_NAME })
      .then(setKeySaved)
      .catch(() => setKeySaved(false));

  useEffect(() => {
    void refreshKeyState();
  }, []);

  const update = (patch: (prev: SpeechConfig) => SpeechConfig) => {
    setConfig((prev) => {
      const next = patch(prev);
      saveSpeechConfig(next);
      return next;
    });
  };

  const usesCloud = config.tts.engine === 'qwen' || config.asr.engine === 'qwen';
  const engines: { value: SpeechEngine; label: string }[] = [
    { value: 'system', label: t('appSettings:generalPanel.speechEngineSystem') },
    { value: 'qwen', label: t('appSettings:generalPanel.speechEngineQwen') },
  ];

  const engineTrack = (kind: 'tts' | 'asr') => (
    <div className={styles.track} role="group" aria-label={t(`appSettings:generalPanel.speech${kind === 'tts' ? 'Tts' : 'Asr'}`)}>
      {engines.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          data-testid={`speech-${kind}-${value}`}
          className={cx(styles.option, config[kind].engine === value && styles.optionActive)}
          onClick={() => update((prev) => ({ ...prev, [kind]: { ...prev[kind], engine: value } }))}
          aria-pressed={config[kind].engine === value}
        >
          <span>{label}</span>
        </button>
      ))}
    </div>
  );

  const saveKey = async () => {
    const value = keyDraft.trim();
    if (!value) return;
    try {
      await invoke('secret_set', { name: SPEECH_SECRET_NAME, value });
      setKeyDraft('');
      await refreshKeyState();
      message.success(t('appSettings:generalPanel.speechSaved'));
    } catch (error) {
      message.error(String(error));
    }
  };

  const preview = async () => {
    setPreviewing(true);
    try {
      const bytes = await synthesizeWithQwen(t('appSettings:generalPanel.speechPreviewText'), voiceForSpeaker(config), config);
      const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }));
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      await audio.play();
    } catch (error) {
      message.error(t('appSettings:generalPanel.speechPreviewFailed', { error: String(error) }));
    } finally {
      setPreviewing(false);
    }
  };

  const keyOptions = [
    { label: t('appSettings:generalPanel.speechKeyOwn'), value: '' },
    ...Object.values(providers).map((p) => ({
      label: t('appSettings:generalPanel.speechKeyFromProvider', { name: p.name }),
      value: p.id,
    })),
  ];

  return (
    <>
      <section className={styles.section} aria-labelledby="settings-speech-tts">
        <h3 id="settings-speech-tts" className={styles.sectionTitle}>
          {t('appSettings:generalPanel.speechTts')}
        </h3>
        <div className={styles.control}>
          {engineTrack('tts')}
          <p className={styles.hint}>{t('appSettings:generalPanel.speechTtsHint')}</p>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="settings-speech-asr">
        <h3 id="settings-speech-asr" className={styles.sectionTitle}>
          {t('appSettings:generalPanel.speechAsr')}
        </h3>
        <div className={styles.control}>
          {engineTrack('asr')}
          <p className={styles.hint}>{t('appSettings:generalPanel.speechAsrHint')}</p>
        </div>
      </section>

      {usesCloud && (
        <>
          <section className={styles.section} aria-labelledby="settings-speech-key">
            <h3 id="settings-speech-key" className={styles.sectionTitle}>
              {t('appSettings:generalPanel.speechKey')}
            </h3>
            <div className={styles.control}>
              <Select
                data-testid="speech-key-source"
                style={{ width: 'min(100%, 420px)' }}
                value={config.providerId}
                onChange={(providerId: string) => update((prev) => ({ ...prev, providerId }))}
                options={keyOptions}
              />
              {!config.providerId && (
                <div className={styles.actions}>
                  <Input.Password
                    data-testid="speech-key-input"
                    style={{ width: 'min(100%, 320px)' }}
                    value={keyDraft}
                    onChange={(e) => setKeyDraft(e.target.value)}
                    placeholder={
                      keySaved
                        ? `${t('appSettings:generalPanel.speechKeySaved')} ••••••`
                        : t('appSettings:generalPanel.speechKeyPlaceholder')
                    }
                    onPressEnter={saveKey}
                  />
                  <Button data-testid="speech-key-save" onClick={saveKey} disabled={!keyDraft.trim()}>
                    {t('appSettings:generalPanel.speechSave')}
                  </Button>
                </div>
              )}
              <p className={styles.hint}>
                {!config.providerId &&
                  `${keySaved ? t('appSettings:generalPanel.speechKeySaved') : t('appSettings:generalPanel.speechKeyMissing')} · `}
                {t('appSettings:generalPanel.speechKeyHint')}
              </p>
            </div>
          </section>

          <section className={styles.section} aria-labelledby="settings-speech-endpoint">
            <h3 id="settings-speech-endpoint" className={styles.sectionTitle}>
              {t('appSettings:generalPanel.speechEndpoint')}
            </h3>
            <Select
              data-testid="speech-endpoint"
              style={{ width: 'min(100%, 420px)' }}
              value={config.endpoint}
              onChange={(endpoint: string) => update((prev) => ({ ...prev, endpoint }))}
              options={SPEECH_ENDPOINTS.map((e) => ({ label: `${e.label} · ${new URL(e.value).host}`, value: e.value }))}
            />
          </section>

          {config.tts.engine === 'qwen' && (
            <section className={styles.section} aria-labelledby="settings-speech-voice">
              <h3 id="settings-speech-voice" className={styles.sectionTitle}>
                {t('appSettings:generalPanel.speechVoice')}
              </h3>
              <div className={styles.control}>
                <div className={styles.actions}>
                  <Select
                    data-testid="speech-voice"
                    style={{ width: 'min(100%, 260px)' }}
                    value={config.tts.voice}
                    onChange={(voice: string) => update((prev) => ({ ...prev, tts: { ...prev.tts, voice } }))}
                    options={[{ label: t('appSettings:generalPanel.speechVoiceAuto'), value: '' }, ...KID_VOICE_OPTIONS]}
                  />
                  <Input
                    aria-label={t('appSettings:generalPanel.speechModel')}
                    prefix={<span className={styles.hint}>{t('appSettings:generalPanel.speechModel')}</span>}
                    style={{ width: 'min(100%, 260px)' }}
                    value={config.tts.model}
                    onChange={(e) => update((prev) => ({ ...prev, tts: { ...prev.tts, model: e.target.value } }))}
                  />
                  <Button data-testid="speech-preview" loading={previewing} onClick={preview}>
                    {t('appSettings:generalPanel.speechPreview')}
                  </Button>
                </div>
                <div className={styles.actions} style={{ alignItems: 'center' }}>
                  <span className={styles.hint}>{t('appSettings:generalPanel.speechRate')}</span>
                  <Slider
                    style={{ width: 200 }}
                    min={0.5}
                    max={2}
                    step={0.1}
                    value={config.tts.rate}
                    onChange={(rate: number) => update((prev) => ({ ...prev, tts: { ...prev.tts, rate } }))}
                  />
                </div>
              </div>
            </section>
          )}

          {config.asr.engine === 'qwen' && (
            <section className={styles.section} aria-labelledby="settings-speech-asr-model">
              <h3 id="settings-speech-asr-model" className={styles.sectionTitle}>
                {t('appSettings:generalPanel.speechAsr')} · {t('appSettings:generalPanel.speechModel')}
              </h3>
              <Input
                style={{ width: 'min(100%, 260px)' }}
                value={config.asr.model}
                onChange={(e) => update((prev) => ({ ...prev, asr: { ...prev.asr, model: e.target.value } }))}
              />
            </section>
          )}
        </>
      )}
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
      <SpeechSettingsSections />

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
