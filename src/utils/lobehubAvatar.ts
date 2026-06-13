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

/** 将存储的头像值（lobehub:IconId / URL）解析为可渲染地址；local: 请用 userStore.avatarDisplaySrc */
export function resolveAvatarSource(avatar?: string | null): string | undefined {
  if (!avatar) return undefined;
  const iconId = parseLobehubAvatar(avatar);
  if (iconId) return lobehubAvatarUrl(iconId);
  if (isLocalAvatar(avatar)) return undefined;
  return avatar;
}
