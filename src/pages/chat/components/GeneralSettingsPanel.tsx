import { useEffect, useState } from 'react';
import { Globe, Monitor, Moon, Sun } from 'lucide-react';
import { App, AutoComplete, Button, Input, Popconfirm, Select, Slider, Tooltip } from 'antd';
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
  SPEECH_ENDPOINTS,
  SPEECH_MODELS,
  TOKEN_PLAN_BASE,
  SPEECH_SECRET_NAME,
  customVoice,
  defaultModel,
  gameVoiceKey,
  inheritedVoice,
  loadSpeechConfig,
  saveSpeechConfig,
  voiceCatalog,
  voiceForSpeaker,
  withCustomVoice,
  type SpeechConfig,
  type SpeechEngine,
} from '@/config/speechConfig';
import { synthesizeCloud } from '@/lib/speech/qwenSpeech';
import { KID_COMPANION_IDS, builtinAIMembers, companionMeta } from '@/config/aiMembers';
import { kidGames } from '@/config/aiGame';
import { useAIMemberStore } from '@/store/aiMemberStore';
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
  voiceRow: css`
    display: grid;
    grid-template-columns: 150px minmax(0, 300px) auto;
    align-items: center;
    gap: 8px;

    @media (max-width: 720px) {
      grid-template-columns: minmax(0, 1fr) auto;

      & > :first-child {
        grid-column: 1 / -1;
      }
    }
  `,
  voiceLabel: css`
    display: flex;
    flex-direction: column;
    font-size: 13px;
    line-height: 1.35;
    color: ${token.colorText};
  `,
  voiceOption: css`
    display: flex;
    justify-content: space-between;
    gap: 12px;

    & > span + span {
      font-family: ${token.fontFamilyCode};
      font-size: 12px;
      color: ${token.colorTextTertiary};
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
  const [previewing, setPreviewing] = useState('');
  const members = useAIMemberStore((s) => s.members);

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

  const engineOf = (kind: 'tts' | 'asr') => config[kind].engine;
  const usesCloud = engineOf('tts') !== 'system' || engineOf('asr') !== 'system';
  const usesTokenPlan = engineOf('tts') === 'tokenplan' || engineOf('asr') === 'tokenplan';
  const usesRealtime = engineOf('tts') === 'qwen' || engineOf('asr') === 'qwen';
  const modelOptions = (kind: 'tts' | 'asr') => SPEECH_MODELS[engineOf(kind) === 'qwen' ? 'qwen' : 'tokenplan'][kind];
  const engines: { value: SpeechEngine; label: string }[] = [
    { value: 'system', label: t('appSettings:generalPanel.speechEngineSystem') },
    { value: 'tokenplan', label: t('appSettings:generalPanel.speechEngineTokenPlan') },
    { value: 'qwen', label: t('appSettings:generalPanel.speechEngineQwen') },
  ];

  const changeEngine = (kind: 'tts' | 'asr', engine: SpeechEngine) =>
    update((prev) => {
      const sameFamily = (prev[kind].engine === 'qwen') === (engine === 'qwen');
      const model = sameFamily ? prev[kind].model : defaultModel(kind, engine);
      return kind === 'tts'
        ? { ...prev, tts: { ...prev.tts, engine, model, voice: sameFamily ? prev.tts.voice : '' } }
        : { ...prev, asr: { ...prev.asr, engine, model } };
    });

  const engineTrack = (kind: 'tts' | 'asr') => (
    <div className={styles.track} role="group" aria-label={t(`appSettings:generalPanel.speech${kind === 'tts' ? 'Tts' : 'Asr'}`)}>
      {engines.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          data-testid={`speech-${kind}-${value}`}
          className={cx(styles.option, config[kind].engine === value && styles.optionActive)}
          onClick={() => changeEngine(kind, value)}
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

  const preview = async (key = 'default', text = t('appSettings:generalPanel.speechPreviewText'), voice = voiceForSpeaker(config)) => {
    setPreviewing(key);
    try {
      const bytes = await synthesizeCloud(text, voice, config);
      const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }));
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      await audio.play();
    } catch (error) {
      message.error(t('appSettings:generalPanel.speechPreviewFailed', { error: String(error) }));
    } finally {
      setPreviewing('');
    }
  };

  const catalog = voiceCatalog(config.tts.model);
  const voiceName = (voice: string) => catalog.options.find((o) => o.value === voice)?.label.split(' · ')[0] || voice;
  const voiceOptions = catalog.options.map((o) => ({
    value: o.value,
    label: (
      <span className={styles.voiceOption}>
        <span>{o.label}</span>
        <span>{o.value}</span>
      </span>
    ),
  }));
  const filterVoice = (input: string, option?: { value: string }) => {
    const query = input.trim().toLowerCase();
    const known = catalog.options.find((o) => o.value === option?.value);
    // 已选中列表里的音色时仍展示全部，方便换一个
    if (!query || catalog.options.some((o) => o.value === input)) return true;
    return Boolean(known && (known.value.toLowerCase().includes(query) || known.label.includes(input.trim())));
  };
  const companionName = (id: string) => members[id]?.name || builtinAIMembers.find((m) => m.id === id)?.name || id;

  const voiceRow = (row: { key: string; testId: string; label: string; sub?: string; placeholder: string; previewText: string; resolved: string }) => (
    <div className={styles.voiceRow} key={row.key}>
      <span className={styles.voiceLabel}>
        <span>{row.label}</span>
        {row.sub && <span className={styles.hint}>{row.sub}</span>}
      </span>
      <AutoComplete
        data-testid={row.testId}
        aria-label={row.label}
        allowClear
        value={customVoice(config, row.key)}
        placeholder={row.placeholder}
        options={voiceOptions}
        filterOption={filterVoice}
        popupMatchSelectWidth={360}
        onChange={(voice: string | undefined) => update((prev) => withCustomVoice(prev, row.key, voice ?? ''))}
      />
      <Button
        data-testid={`${row.testId}-preview`}
        loading={previewing === row.key}
        disabled={Boolean(previewing) && previewing !== row.key}
        onClick={() => preview(row.key, row.previewText, row.resolved)}
      >
        {t('appSettings:generalPanel.speechPreview')}
      </Button>
    </div>
  );

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

          {usesTokenPlan && (
            <section className={styles.section} aria-labelledby="settings-speech-http-base">
              <h3 id="settings-speech-http-base" className={styles.sectionTitle}>
                {t('appSettings:generalPanel.speechHttpBase')}
              </h3>
              <div className={styles.control}>
                <AutoComplete
                  data-testid="speech-http-base"
                  style={{ width: 'min(100%, 420px)' }}
                  value={config.httpBase}
                  onChange={(httpBase: string) => update((prev) => ({ ...prev, httpBase }))}
                  options={[{ label: `Token Plan · ${new URL(TOKEN_PLAN_BASE).host}`, value: TOKEN_PLAN_BASE }]}
                />
                <p className={styles.hint}>{t('appSettings:generalPanel.speechTokenPlanHint')}</p>
              </div>
            </section>
          )}

          {usesRealtime && (
            <section className={styles.section} aria-labelledby="settings-speech-endpoint">
              <h3 id="settings-speech-endpoint" className={styles.sectionTitle}>
                {t('appSettings:generalPanel.speechEndpoint')}
              </h3>
              <div className={styles.control}>
                <AutoComplete
                  data-testid="speech-endpoint"
                  style={{ width: 'min(100%, 420px)' }}
                  value={config.endpoint}
                  onChange={(endpoint: string) => update((prev) => ({ ...prev, endpoint }))}
                  options={SPEECH_ENDPOINTS.map((e) => ({ label: `${e.label} · ${new URL(e.value).host}`, value: e.value }))}
                />
                <p className={styles.hint}>{t('appSettings:generalPanel.speechEndpointHint')}</p>
              </div>
            </section>
          )}

          {config.tts.engine !== 'system' && (
            <section className={styles.section} aria-labelledby="settings-speech-voice">
              <h3 id="settings-speech-voice" className={styles.sectionTitle}>
                {t('appSettings:generalPanel.speechVoice')}
              </h3>
              <div className={styles.control}>
                <div className={styles.actions}>
                  <AutoComplete
                    data-testid="speech-voice"
                    aria-label={t('appSettings:generalPanel.speechVoice')}
                    style={{ width: 'min(100%, 320px)' }}
                    allowClear
                    placeholder={t('appSettings:generalPanel.speechVoiceAuto')}
                    value={config.tts.voice}
                    onChange={(voice: string | undefined) => update((prev) => ({ ...prev, tts: { ...prev.tts, voice: voice ?? '' } }))}
                    options={voiceOptions}
                    filterOption={filterVoice}
                    popupMatchSelectWidth={360}
                  />
                  <AutoComplete
                    data-testid="speech-tts-model"
                    aria-label={t('appSettings:generalPanel.speechModel')}
                    style={{ width: 'min(100%, 260px)' }}
                    value={config.tts.model}
                    options={modelOptions('tts')}
                    onChange={(model: string) => update((prev) => ({ ...prev, tts: { ...prev.tts, model, voice: '' } }))}
                  />
                  <Button
                    data-testid="speech-preview"
                    loading={previewing === 'default'}
                    disabled={Boolean(previewing) && previewing !== 'default'}
                    onClick={() => preview()}
                  >
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
                <p className={styles.hint}>
                  {config.tts.engine === 'tokenplan'
                    ? t('appSettings:generalPanel.speechVoiceTokenPlanHint')
                    : t('appSettings:generalPanel.speechVoiceHint')}
                </p>
                {config.tts.engine === 'tokenplan' && (
                  <>
                    <Input.TextArea
                      data-testid="speech-instruction"
                      aria-label={t('appSettings:generalPanel.speechInstruction')}
                      style={{ width: 'min(100%, 520px)' }}
                      autoSize={{ minRows: 1, maxRows: 3 }}
                      maxLength={200}
                      value={config.tts.instruction}
                      onChange={(e) => update((prev) => ({ ...prev, tts: { ...prev.tts, instruction: e.target.value } }))}
                    />
                    <p className={styles.hint}>{t('appSettings:generalPanel.speechInstructionHint')}</p>
                  </>
                )}
              </div>
            </section>
          )}

          {config.tts.engine !== 'system' && (
            <section className={styles.section} aria-labelledby="settings-speech-companion-voices">
              <h3 id="settings-speech-companion-voices" className={styles.sectionTitle}>
                {t('appSettings:generalPanel.speechCompanionVoices')}
              </h3>
              <div className={styles.control}>
                {KID_COMPANION_IDS.map((id) => {
                  const fallback = inheritedVoice(config, id);
                  return voiceRow({
                    key: id,
                    testId: `speech-voice-${id}`,
                    label: `${companionMeta[id].emoji} ${companionName(id)}`,
                    placeholder: t('appSettings:generalPanel.speechVoiceInherited', { voice: voiceName(fallback) }),
                    previewText: companionMeta[id].greeting,
                    resolved: voiceForSpeaker(config, id),
                  });
                })}
                {kidGames.map((game) => {
                  const hostVoice = voiceForSpeaker(config, game.hostCompanionId);
                  const host = companionName(game.hostCompanionId);
                  return voiceRow({
                    key: gameVoiceKey(game.id),
                    testId: `speech-voice-game-${game.id}`,
                    label: `${game.emoji} ${game.name}`,
                    sub: t('appSettings:generalPanel.speechGameHost', { name: host }),
                    placeholder: t('appSettings:generalPanel.speechVoiceFollowHost', { name: host, voice: voiceName(hostVoice) }),
                    previewText: t('appSettings:generalPanel.speechGamePreviewText', { game: game.name }),
                    resolved: voiceForSpeaker(config, game.hostCompanionId, game.id),
                  });
                })}
                <p className={styles.hint}>{t('appSettings:generalPanel.speechCompanionVoicesHint')}</p>
              </div>
            </section>
          )}

          {config.asr.engine !== 'system' && (
            <section className={styles.section} aria-labelledby="settings-speech-asr-model">
              <h3 id="settings-speech-asr-model" className={styles.sectionTitle}>
                {t('appSettings:generalPanel.speechAsr')} · {t('appSettings:generalPanel.speechModel')}
              </h3>
              <AutoComplete
                data-testid="speech-asr-model"
                style={{ width: 'min(100%, 320px)' }}
                value={config.asr.model}
                options={modelOptions('asr')}
                onChange={(model: string) => update((prev) => ({ ...prev, asr: { ...prev.asr, model } }))}
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
