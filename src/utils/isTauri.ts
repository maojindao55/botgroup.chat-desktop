export const isTauri =
  typeof window !== 'undefined'
  && (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== undefined;

export function isTauriMacOS(): boolean {
  if (!isTauri || typeof navigator === 'undefined') return false;
  return /Macintosh|Mac OS X/.test(navigator.userAgent);
}
