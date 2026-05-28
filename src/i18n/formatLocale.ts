import i18n from './index';

function getLocale(): string {
  return i18n.language || 'zh-CN';
}

export function formatLocaleDateTime(
  value: string | Date,
  options?: Intl.DateTimeFormatOptions,
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(getLocale(), options);
}

export function formatLocaleDate(value: string | Date, options?: Intl.DateTimeFormatOptions): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(getLocale(), options);
}
