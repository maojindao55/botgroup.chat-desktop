/** 收集 localStorage 中 legacy API_KEY_* 条目，供一次性迁移 IPC 使用 */
export function collectLegacyApiKeys(): { name: string; value: string }[] {
  if (typeof localStorage === 'undefined') return [];
  const keys: { name: string; value: string }[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith('API_KEY_')) continue;
    const value = localStorage.getItem(key)?.trim();
    if (value) keys.push({ name: key, value });
  }
  return keys;
}

/** 迁移成功后清除 legacy localStorage 密钥 */
export function clearLegacyApiKeys(): void {
  if (typeof localStorage === 'undefined') return;
  const toRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith('API_KEY_')) toRemove.push(key);
  }
  toRemove.forEach((k) => localStorage.removeItem(k));
}
