import i18n from './index';

export function getTranslatedProviderName(id: string, fallback: string): string {
  return i18n.t(`providers:builtin.${id}`, { defaultValue: fallback });
}
