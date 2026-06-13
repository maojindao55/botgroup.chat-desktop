export const LOBEHUB_AVATAR_PREFIX = 'lobehub:';

export function isLobehubAvatar(value?: string | null): boolean {
  return !!value?.startsWith(LOBEHUB_AVATAR_PREFIX);
}

export function encodeLobehubAvatar(iconId: string): string {
  return `${LOBEHUB_AVATAR_PREFIX}${iconId}`;
}

export function parseLobehubAvatar(value?: string | null): string | null {
  if (!isLobehubAvatar(value)) return null;
  const iconId = value!.slice(LOBEHUB_AVATAR_PREFIX.length);
  return iconId || null;
}
