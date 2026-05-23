import { invoke } from '@tauri-apps/api/core';
import { modelConfigs } from '@/config/aiCharacters';
import { readLegacyApiKey } from '@/config/providers';
import { mapFromRust } from '@/store/providerStore';

function getLocalApiKey(keyName: string): string {
  return localStorage.getItem(`API_KEY_${keyName}`) || '';
}

export interface ResolvedLlmCredentials {
  model: string;
  /** 走 Rust providerId + vault 路径 */
  providerId?: string;
  baseURL?: string;
  apiKey?: string;
}

/**
 * 解析模型调用凭据：优先「模型服务」Provider + vault，fallback 旧 modelConfigs + localStorage。
 */
export async function resolveLlmCredentials(model: string): Promise<ResolvedLlmCredentials> {
  try {
    const rustProviders = await invoke<Array<Parameters<typeof mapFromRust>[0]>>('list_providers');
    const candidates = rustProviders
      .map(mapFromRust)
      .filter((p) => p.enabled !== false && (p.models || []).includes(model));

    candidates.sort((a, b) => {
      if (a.source === 'builtin' && b.source !== 'builtin') return -1;
      if (b.source === 'builtin' && a.source !== 'builtin') return 1;
      return a.id.localeCompare(b.id);
    });

    for (const provider of candidates) {
      try {
        const hasVault = await invoke<boolean>('secret_has', { name: provider.apiKeyRef });
        if (hasVault) {
          return { model, providerId: provider.id };
        }
      } catch {
        /* try next */
      }

      const legacy = readLegacyApiKey(provider.id);
      if (legacy) {
        return { model, baseURL: provider.baseURL, apiKey: legacy };
      }
    }
  } catch (e) {
    console.warn('[resolveLlmCredentials] provider lookup failed:', e);
  }

  const modelConfig = modelConfigs.find((c) => c.model === model);
  if (!modelConfig) {
    throw new Error(
      `不支持的模型「${model}」。请在「群员库 → 模型服务」中为对应 Provider 添加该模型。`,
    );
  }

  let baseURL = modelConfig.baseURL;
  const apiKey = getLocalApiKey(modelConfig.apiKey);

  if (modelConfig.apiKey === 'OLLAMA_API_KEY' || localStorage.getItem('API_KEY_OLLAMA_URL')) {
    const customOllamaUrl = localStorage.getItem('API_KEY_OLLAMA_URL');
    if (customOllamaUrl) baseURL = customOllamaUrl;
  }

  if (!apiKey && modelConfig.apiKey !== 'OLLAMA_API_KEY') {
    throw new Error(
      `${model} 的 API 密钥未配置。请在「群员库 → 模型服务」中为对应 Provider 配置密钥。`,
    );
  }

  return { model, baseURL, apiKey };
}
