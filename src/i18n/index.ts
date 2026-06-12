import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import commonEn from './resources/en-US/common.json';
import adEn from './resources/en-US/ad.json';
import chatEn from './resources/en-US/chat.json';
import homeEn from './resources/en-US/home.json';
import cliEn from './resources/en-US/cli.json';
import editorEn from './resources/en-US/editor.json';
import engineEn from './resources/en-US/engine.json';
import libraryEn from './resources/en-US/library.json';
import productEn from './resources/en-US/product.json';
import providersEn from './resources/en-US/providers.json';
import settingsEn from './resources/en-US/settings.json';
import sidebarEn from './resources/en-US/sidebar.json';
import tagsEn from './resources/en-US/tags.json';
import userEn from './resources/en-US/user.json';
import wizardEn from './resources/en-US/wizard.json';
import appSettingsEn from './resources/en-US/appSettings.json';
import adZh from './resources/zh-CN/ad.json';
import commonZh from './resources/zh-CN/common.json';
import chatZh from './resources/zh-CN/chat.json';
import homeZh from './resources/zh-CN/home.json';
import cliZh from './resources/zh-CN/cli.json';
import editorZh from './resources/zh-CN/editor.json';
import engineZh from './resources/zh-CN/engine.json';
import libraryZh from './resources/zh-CN/library.json';
import productZh from './resources/zh-CN/product.json';
import providersZh from './resources/zh-CN/providers.json';
import settingsZh from './resources/zh-CN/settings.json';
import sidebarZh from './resources/zh-CN/sidebar.json';
import tagsZh from './resources/zh-CN/tags.json';
import userZh from './resources/zh-CN/user.json';
import wizardZh from './resources/zh-CN/wizard.json';
import appSettingsZh from './resources/zh-CN/appSettings.json';

export type ResolvedLocale = 'zh-CN' | 'en-US';
export type LocalePreference = 'system' | ResolvedLocale;

const STORAGE_KEY = 'locale';

export function resolveSystemLocale(): ResolvedLocale {
  const lang = typeof navigator !== 'undefined' ? navigator.language : 'zh-CN';
  return lang.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US';
}

export function getStoredLocalePreference(): LocalePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'system' || stored === 'zh-CN' || stored === 'en-US') {
      return stored;
    }
  } catch {}
  return 'system';
}

export function resolveLocalePreference(preference: LocalePreference): ResolvedLocale {
  return preference === 'system' ? resolveSystemLocale() : preference;
}

function getInitialLocale(): ResolvedLocale {
  return resolveLocalePreference(getStoredLocalePreference());
}

i18n.use(initReactI18next).init({
  resources: {
    'zh-CN': {
      common: commonZh,
      home: homeZh,
      sidebar: sidebarZh,
      user: userZh,
      wizard: wizardZh,
      product: productZh,
      providers: providersZh,
      library: libraryZh,
      editor: editorZh,
      settings: settingsZh,
      chat: chatZh,
      cli: cliZh,
      engine: engineZh,
      tags: tagsZh,
      ad: adZh,
      appSettings: appSettingsZh,
    },
    'en-US': {
      common: commonEn,
      home: homeEn,
      sidebar: sidebarEn,
      user: userEn,
      wizard: wizardEn,
      product: productEn,
      providers: providersEn,
      library: libraryEn,
      editor: editorEn,
      settings: settingsEn,
      chat: chatEn,
      cli: cliEn,
      engine: engineEn,
      tags: tagsEn,
      ad: adEn,
      appSettings: appSettingsEn,
    },
  },
  lng: getInitialLocale(),
  fallbackLng: 'zh-CN',
  defaultNS: 'common',
  interpolation: {
    escapeValue: false,
  },
});

export function syncI18nLocale(locale: ResolvedLocale) {
  if (i18n.language !== locale) {
    void i18n.changeLanguage(locale);
  }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale;
  }
}

syncI18nLocale(getInitialLocale());

export { i18n };
export default i18n;
