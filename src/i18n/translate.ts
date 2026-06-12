import i18n from './index';

/** Non-hook i18n access for engine / utils (Phase 5). */
export function te(key: string, options?: Record<string, unknown>): string {
  return i18n.t(`engine:${key}`, options);
}
