import { invoke } from '@tauri-apps/api/core';

export interface DesktopUser {
  id: number;
  phone: string;
  nickname: string | null;
  avatar_url: string | null;
  status: number;
}

/** Tauri IPC 返回 camelCase，统一转成 store 使用的 snake_case */
export function normalizeDesktopUser(raw: Record<string, unknown> | null | undefined): DesktopUser {
  if (!raw) {
    return { id: 0, phone: '', nickname: null, avatar_url: null, status: 0 };
  }
  return {
    id: Number(raw.id ?? 0),
    phone: String(raw.phone ?? ''),
    nickname: String(raw.nickname ?? raw.nickName ?? ''),
    avatar_url: (raw.avatar_url as string | null | undefined)
      ?? (raw.avatarUrl as string | null | undefined)
      ?? null,
    status: Number(raw.status ?? 1),
  };
}

function guessImageMime(name: string, fallback = ''): string {
  if (fallback) return fallback;
  const ext = name.split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
  };
  return ext ? map[ext] ?? '' : '';
}

export async function uploadUserAvatar(file: File, fallbackNickname: string): Promise<DesktopUser> {
  const mimeType = guessImageMime(file.name, file.type);
  if (!mimeType.startsWith('image/')) {
    throw new Error('invalid_image_type');
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new Error('image_too_large');
  }

  let user = await invoke<Record<string, unknown> | null>('get_current_user');
  if (!user) {
    user = await invoke<Record<string, unknown>>('create_local_user', {
      nickname: fallbackNickname || '本地用户',
    });
  }
  const currentUser = normalizeDesktopUser(user);

  const buffer = await file.arrayBuffer();
  const updated = await invoke<Record<string, unknown>>('upload_user_avatar', {
    userId: currentUser.id,
    data: new Uint8Array(buffer),
    mimeType,
  });
  return normalizeDesktopUser(updated);
}
