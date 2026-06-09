import type { Window as TauriWindow } from '@tauri-apps/api/window';

let appWindowPromise: Promise<TauriWindow> | null = null;

/** Lazily load the Tauri main window (cached). Safe for web builds — only call when in Tauri. */
export function getAppWindow(): Promise<TauriWindow> {
  if (!appWindowPromise) {
    appWindowPromise = import('@tauri-apps/api/window').then(({ getCurrentWindow }) => getCurrentWindow());
  }
  return appWindowPromise;
}
