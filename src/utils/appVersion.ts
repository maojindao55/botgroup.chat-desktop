import pkg from '../../package.json';

const isTauri =
  typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__ !== undefined;

/**
 * 构建时打包进来的版本号，作为非 Tauri 环境（如浏览器预览）的回退值。
 * package.json 与 src-tauri/tauri.conf.json 的版本由 scripts/release.sh 保持同步。
 */
export const FALLBACK_APP_VERSION: string = (pkg as { version?: string }).version ?? '0.0.0';

/**
 * 获取当前应用版本号。
 * - Tauri 桌面环境：读取 tauri.conf.json 中的真实版本（与实际构建产物一致）。
 * - 其他环境：回退到 package.json 的版本。
 */
export async function getAppVersion(): Promise<string> {
  if (isTauri) {
    try {
      const { getVersion } = await import('@tauri-apps/api/app');
      return await getVersion();
    } catch {
      // 读取失败时回退到打包版本
    }
  }
  return FALLBACK_APP_VERSION;
}
