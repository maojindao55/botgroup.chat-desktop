import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';

import {
  getStoredLocalePreference,
  resolveLocalePreference,
  resolveSystemLocale,
  syncI18nLocale,
  type LocalePreference,
  type ResolvedLocale,
} from '@/i18n';

const STORAGE_KEY = 'locale';

let currentLocale: LocalePreference = getStoredLocalePreference();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): LocalePreference {
  return currentLocale;
}

function setLocaleValue(locale: LocalePreference) {
  currentLocale = locale;
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {}
  syncI18nLocale(resolveLocalePreference(locale));
  listeners.forEach((listener) => listener());
}

export function useLocale() {
  const locale = useSyncExternalStore(subscribe, getSnapshot);

  const resolvedLocale: ResolvedLocale = useMemo(
    () => resolveLocalePreference(locale),
    [locale],
  );

  const setLocale = useCallback((next: LocalePreference) => {
    setLocaleValue(next);
  }, []);

  useEffect(() => {
    syncI18nLocale(resolvedLocale);
  }, [resolvedLocale]);

  useEffect(() => {
    const handler = () => {
      if (currentLocale === 'system') {
        syncI18nLocale(resolveSystemLocale());
        listeners.forEach((listener) => listener());
      }
    };

    window.addEventListener('languagechange', handler);
    return () => window.removeEventListener('languagechange', handler);
  }, []);

  return { locale, resolvedLocale, setLocale };
}

export type { LocalePreference, ResolvedLocale };
