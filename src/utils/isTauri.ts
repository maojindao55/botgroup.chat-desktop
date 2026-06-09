export const isTauri =
  typeof window !== 'undefined'
  && (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== undefined;

/** Windows/Linux Tauri builds use frameless windows with a custom title bar. */
export function needsCustomWindowChrome(): boolean {
  if (!isTauri || typeof navigator === 'undefined') return false;
  return !/Macintosh|Mac OS X/.test(navigator.userAgent);
}
