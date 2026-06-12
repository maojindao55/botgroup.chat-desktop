import { invoke } from '@tauri-apps/api/core';
import { isLocalAvatar, resolveAvatarSource } from '@/utils/lobehubAvatar';

const dataUrlCache = new Map<string, string>();

function bytesToDataUrl(bytes: Uint8Array, mimeType: string): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
}

export function clearLocalAvatarCache(avatarUrl?: string | null) {
  if (avatarUrl) {
    dataUrlCache.delete(avatarUrl);
    return;
  }
  dataUrlCache.clear();
}

export async function loadLocalAvatarDataUrl(
  avatarUrl: string | null | undefined,
): Promise<string | undefined> {
  if (!avatarUrl || !isLocalAvatar(avatarUrl)) return undefined;

  const cached = dataUrlCache.get(avatarUrl);
  if (cached) return cached;

  const payload = await invoke<{
    mimeType?: string;
    mime_type?: string;
    data: number[] | Uint8Array;
  }>('read_local_avatar', { avatarUrl });

  const mimeType = payload.mimeType || payload.mime_type || 'image/jpeg';
  const bytes = payload.data instanceof Uint8Array
    ? payload.data
    : new Uint8Array(payload.data);
  const dataUrl = bytesToDataUrl(bytes, mimeType);
  dataUrlCache.set(avatarUrl, dataUrl);
  return dataUrl;
}

/** 解析用户头像为 LobeAvatar 可识别的 data:/http URL */
export async function resolveUserAvatarDisplay(
  avatarUrl: string | null | undefined,
): Promise<string | undefined> {
  if (!avatarUrl) return undefined;
  if (isLocalAvatar(avatarUrl)) {
    return loadLocalAvatarDataUrl(avatarUrl);
  }
  return resolveAvatarSource(avatarUrl);
}
