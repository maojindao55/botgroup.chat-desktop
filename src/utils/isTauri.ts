export const isTauri =
  typeof window !== 'undefined'
  && (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== undefined;

export const isMacOS =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPod|iPad/i.test(navigator.platform);
