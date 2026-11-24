import { getLobeIconCDN } from '@lobehub/icons';
import { parseLobehubAvatar } from '@/utils/lobehubAvatarCore';

export * from '@/utils/lobehubAvatarCore';

export const LOCAL_AVATAR_PREFIX = 'local:';

export function isLocalAvatar(value?: string | null): boolean {
  return !!value?.startsWith(LOCAL_AVATAR_PREFIX);
}

export function lobehubAvatarUrl(iconId: string): string {
  return getLobeIconCDN(iconId, { format: 'avatar', cdn: 'aliyun' });
}

/** 将存储的头像值（lobehub:IconId / URL / local: 文件）解析为可渲染地址 */
export function resolveAvatarSource(avatar?: string | null): string | undefined {
  if (!avatar) return undefined;
  const iconId = parseLobehubAvatar(avatar);
  if (iconId) return lobehubAvatarUrl(iconId);
  if (isLocalAvatar(avatar)) return localAvatarAssetUrl(avatar.slice(LOCAL_AVATAR_PREFIX.length));
  return avatar;
}

/**
 * 把 appdata 内的本地头像转成 Tauri asset URL（同步、无需异步读取）。
 * 非 Tauri 环境或不可用时返回 undefined，由调用方回退到首字母色块。
 */
export function localAvatarAssetUrl(path: string): string | undefined {
  if (!path || typeof window === 'undefined') return undefined;
  const internals = (window as typeof window & {
    __TAURI_INTERNALS__?: { convertFileSrc?: unknown };
  }).__TAURI_INTERNALS__;
  if (typeof internals?.convertFileSrc !== 'function') return undefined;
  try {
    return (internals.convertFileSrc as (p: string) => string)(path);
  } catch {
    return undefined;
  }
}
