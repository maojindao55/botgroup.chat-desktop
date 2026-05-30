import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { builtinProviders, readLegacyApiKey, type Provider } from '@/config/providers';
import i18n from '@/i18n';

/** Rust serde camelCase: base_url → baseUrl (not baseURL) */
interface RustProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKeyRef: string;
  models: string[];
  source: string;
  iconUrl?: string | null;
  description?: string | null;
  enabled: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export function mapFromRust(r: RustProvider): Provider {
  return {
    id: r.id,
    name: r.name,
    baseURL: r.baseUrl,
    apiKeyRef: r.apiKeyRef,
    models: r.models,
    source: r.source as 'builtin' | 'user',
    enabled: r.enabled,
    iconUrl: r.iconUrl ?? undefined,
    description: r.description ?? undefined,
  };
}

export function mapToRust(p: Provider): RustProvider {
  return {
    id: p.id,
    name: p.name,
    baseUrl: p.baseURL,
    apiKeyRef: p.apiKeyRef,
    models: p.models,
    source: p.source,
    iconUrl: p.iconUrl ?? null,
    description: p.description ?? null,
    enabled: p.enabled !== false,
  };
}

export interface ProviderTestResult {
  ok: boolean;
  latencyMs: number;
  modelEcho?: string;
  errorClass?: string;
  message?: string;
}

interface ProviderStore {
  providers: Record<string, Provider>;
  loaded: boolean;
  load: () => Promise<void>;
  get: (id: string) => Provider | undefined;
  upsert: (p: Provider) => Promise<void>;
  remove: (id: string) => Promise<void>;
  clone: (id: string) => Promise<Provider>;
  testConnection: (params: {
    id?: string;
    baseURL: string;
    apiKey: string;
    models?: string[];
  }) => Promise<ProviderTestResult>;
  setSecret: (providerId: string, value: string) => Promise<void>;
  hasSecret: (providerId: string) => Promise<boolean>;
  /** 若 vault 无密钥，尝试从左下角 legacy localStorage 导入 */
  ensureSecret: (providerId: string, inlineKey?: string) => Promise<boolean>;
}

const isTauri =
  typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__ !== undefined;

function secretNameForProvider(providerId: string, providers: Record<string, Provider>): string {
  return providers[providerId]?.apiKeyRef ?? `provider:${providerId}`;
}

export const useProviderStore = create<ProviderStore>((set, get) => ({
  providers: {},
  loaded: false,

  load: async () => {
    try {
      if (isTauri) {
        let rustProviders = await invoke<RustProvider[]>('list_providers');
        // 一次性迁移：清理历史遗留的内置预设服务商（现已不再预设服务商）。
        // 幂等：清理完成后列表中不再有 builtin 项，后续启动不会重复执行。
        const builtinLeftovers = rustProviders.filter((r) => r.source === 'builtin');
        if (builtinLeftovers.length > 0) {
          for (const r of builtinLeftovers) {
            try {
              await invoke('delete_provider', { id: r.id });
            } catch (e) {
              console.warn('[providerStore] failed to remove legacy builtin provider', r.id, e);
            }
          }
          rustProviders = await invoke<RustProvider[]>('list_providers');
        }
        const record: Record<string, Provider> = {};
        rustProviders.forEach((r) => {
          record[r.id] = mapFromRust(r);
        });
        set({ providers: record });
      } else {
        const record: Record<string, Provider> = {};
        builtinProviders.forEach((p) => {
          record[p.id] = p;
        });
        const localStr = localStorage.getItem('custom_providers') || '[]';
        const customProviders = JSON.parse(localStr) as Provider[];
        customProviders.forEach((p) => {
          record[p.id] = p;
        });
        set({ providers: record });
      }
    } catch (e) {
      console.error('Failed to load providers', e);
    } finally {
      set({ loaded: true });
    }
  },

  get: (id: string) => {
    return get().providers[id];
  },

  upsert: async (p: Provider) => {
    const existing = get().providers[p.id];
    if (existing?.source === 'builtin') {
      throw new Error(i18n.t('common:store.provider.cannotEditBuiltin'));
    }
    if (!existing && p.source === 'builtin') {
      throw new Error(i18n.t('common:store.provider.cannotCreateBuiltin'));
    }

    const updated: Provider = {
      ...p,
      source: 'user',
    };

    if (isTauri) {
      await invoke('upsert_provider', { provider: mapToRust(updated) });
    } else {
      const localStr = localStorage.getItem('custom_providers') || '[]';
      let customProviders = JSON.parse(localStr) as Provider[];
      customProviders = customProviders.filter((item) => item.id !== updated.id);
      customProviders.push(updated);
      localStorage.setItem('custom_providers', JSON.stringify(customProviders));
    }

    set((state) => ({
      providers: {
        ...state.providers,
        [updated.id]: updated,
      },
    }));
  },

  remove: async (id: string) => {
    if (isTauri) {
      await invoke('delete_provider', { id });
    } else {
      const localStr = localStorage.getItem('custom_providers') || '[]';
      let customProviders = JSON.parse(localStr) as Provider[];
      customProviders = customProviders.filter((item) => item.id !== id);
      localStorage.setItem('custom_providers', JSON.stringify(customProviders));
    }

    set((state) => {
      const copy = { ...state.providers };
      delete copy[id];
      return { providers: copy };
    });
  },

  clone: async (id: string) => {
    const orig = get().providers[id];
    if (!orig) throw new Error(i18n.t('common:store.provider.notFound'));
    const ts = Date.now();
    const newId = `user-${orig.id}-copy-${ts}`;
    const apiKeyRef = `provider:${newId}`;
    const cloned: Provider = {
      ...JSON.parse(JSON.stringify(orig)),
      id: newId,
      source: 'user',
      name: `${orig.name}${i18n.t('common:copyNameSuffix')}`,
      apiKeyRef,
    };
    await get().upsert(cloned);

    if (isTauri) {
      try {
        await invoke<boolean>('secret_copy', {
          fromName: orig.apiKeyRef,
          toName: apiKeyRef,
        });
      } catch (e) {
        console.warn('[providerStore.clone] secret_copy failed:', e);
      }
    }

    return cloned;
  },

  testConnection: async (params) => {
    const model = params.models?.[0];
    return invoke<ProviderTestResult>('provider_ping', {
      baseUrl: params.baseURL.replace(/\/$/, ''),
      apiKey: params.apiKey,
      model: model ?? null,
    });
  },

  setSecret: async (providerId: string, value: string) => {
    const name = secretNameForProvider(providerId, get().providers);
    await invoke('secret_set', { name, value });
  },

  hasSecret: async (providerId: string) => {
    const name = secretNameForProvider(providerId, get().providers);
    return invoke<boolean>('secret_has', { name });
  },

  ensureSecret: async (providerId: string, inlineKey?: string) => {
    const trimmed = inlineKey?.trim();
    if (trimmed) {
      await get().setSecret(providerId, trimmed);
      return true;
    }

    if (await get().hasSecret(providerId)) {
      return true;
    }

    const legacy = readLegacyApiKey(providerId);
    if (legacy) {
      await get().setSecret(providerId, legacy);
      return true;
    }

    return false;
  },
}));
