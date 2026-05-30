/**
 * 轻量「检查更新」：查询 GitHub 仓库最新 Release 并与当前版本比较。
 * 只依赖公开的 GitHub REST API，无需鉴权，也不依赖 Tauri updater。
 */

/** GitHub 仓库（owner/repo），用于查询最新 Release。 */
export const GITHUB_REPO = 'maojindao55/botgroup.chat-desktop';

/** Release 列表页地址，作为下载入口的回退。 */
const RELEASES_PAGE = `https://github.com/${GITHUB_REPO}/releases/latest`;

export interface UpdateCheckResult {
  /** 远端是否存在比当前更新的版本。 */
  hasUpdate: boolean;
  /** 传入的当前版本。 */
  currentVersion: string;
  /** 远端最新版本号（已去掉前缀 v）；获取不到时为 null。 */
  latestVersion: string | null;
  /** Release 页面地址，供用户前往下载。 */
  releaseUrl: string;
}

/**
 * 比较两个 semver 版本号（仅比较数字段，适配本项目 x.y.z 的发布规则）。
 * a > b 返回正数，a < b 返回负数，相等返回 0。
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * 查询 GitHub 最新 Release 并与当前版本比较。
 * 草稿/预发布版本不会出现在 `releases/latest`，因此只会提示正式版本。
 */
export async function checkForUpdate(currentVersion: string): Promise<UpdateCheckResult> {
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) {
    throw new Error(`GitHub API responded with ${res.status}`);
  }
  const data = (await res.json()) as { tag_name?: string; html_url?: string };
  const latestVersion = (data.tag_name ?? '').replace(/^v/i, '').trim() || null;
  const releaseUrl = data.html_url || RELEASES_PAGE;
  const hasUpdate = latestVersion !== null && compareVersions(latestVersion, currentVersion) > 0;
  return { hasUpdate, currentVersion, latestVersion, releaseUrl };
}
