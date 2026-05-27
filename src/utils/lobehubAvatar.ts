import { getLobeIconCDN } from '@lobehub/icons';
import { parseLobehubAvatar } from '@/utils/lobehubAvatarCore';

export * from '@/utils/lobehubAvatarCore';

export function lobehubAvatarUrl(iconId: string): string {
  return getLobeIconCDN(iconId, { format: 'avatar', cdn: 'aliyun' });
}

/** 将存储的头像值（lobehub:IconId / URL / 本地路径）解析为可渲染地址 */
export function resolveAvatarSource(avatar?: string | null): string | undefined {
  if (!avatar) return undefined;
  const iconId = parseLobehubAvatar(avatar);
  if (iconId) return lobehubAvatarUrl(iconId);
  return avatar;
}
