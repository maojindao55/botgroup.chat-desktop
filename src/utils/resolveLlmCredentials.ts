import { invoke } from '@tauri-apps/api/core';
import { readLegacyApiKey } from '@/config/providers';

export interface ResolvedLlmCredentials {
  model: string;
  /** 走 Rust providerId + vault 路径 */
  providerId?: string;
  baseURL?: string;
  apiKey?: string;
}

/**
 * 解析模型调用凭据：优先显式 providerId + vault，否则按 model 查 Provider。
 */
export async function resolveLlmCredentials(
  model: string,
  explicitProviderId?: string,
): Promise<ResolvedLlmCredentials> {
  const tryProvider = async (providerId: string): Promise<ResolvedLlmCredentials | null> => {
    if (providerId.startsWith('unmapped-')) return null;
    try {
      const hasVault = await invoke<boolean>('secret_has', {
        name: `provider:${providerId}`,
      });
      if (hasVault) {
        return { model, providerId };
      }
    } catch {
      /* try legacy fallback */
    }
    const legacy = readLegacyApiKey(providerId);
    if (legacy) {
      const rustProviders = await invoke<Array<{ id: string; baseUrl: string }>>('list_providers');
      const provider = rustProviders.find((p) => p.id === providerId);
      return {
        model,
        baseURL: provider?.baseUrl,
        apiKey: legacy,
      };
    }
    return null;
  };

  if (explicitProviderId) {
    const resolved = await tryProvider(explicitProviderId);
    if (resolved) return resolved;
    throw new Error(
      `${model} 的 API 密钥未配置。请在「群员库 → 模型服务」中为 Provider「${explicitProviderId}」配置密钥。`,
    );
  }

  try {
    const rustProviders = await invoke<
      Array<{ id: string; baseUrl: string; models: string[]; source: string; enabled: boolean }>
    >('list_providers');

    const candidates = rustProviders
      .filter((p) => p.enabled !== false && (p.models || []).includes(model))
      .sort((a, b) => {
        if (a.source === 'builtin' && b.source !== 'builtin') return -1;
        if (b.source === 'builtin' && a.source !== 'builtin') return 1;
        return a.id.localeCompare(b.id);
      });

    for (const provider of candidates) {
      const resolved = await tryProvider(provider.id);
      if (resolved) return resolved;
    }
  } catch (e) {
    console.warn('[resolveLlmCredentials] provider lookup failed:', e);
  }

  throw new Error(
    `${model} 的 API 密钥未配置。请在「群员库 → 模型服务」中为对应 Provider 配置密钥。`,
  );
}
