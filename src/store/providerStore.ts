import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { builtinProviders, readLegacyApiKey, type Provider } from '@/config/providers';

interface RustProvider {
  id: string;
  name: string;
  baseURL: string;
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
    baseURL: r.baseURL,
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
    baseURL: p.baseURL,
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
        if (rustProviders.length === 0) {
          await invoke('seed_builtin_providers', {
            providers: builtinProviders.map((p) => ({
              id: p.id,
              name: p.name,
              baseURL: p.baseURL,
              apiKeyRef: p.apiKeyRef,
              models: p.models,
              source: p.source,
              iconUrl: p.iconUrl ?? null,
              description: p.description ?? null,
              enabled: p.enabled !== false,
            })),
          });
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
    if (isTauri) {
      await invoke('upsert_provider', { provider: mapToRust(p) });
    } else {
      const localStr = localStorage.getItem('custom_providers') || '[]';
      let customProviders = JSON.parse(localStr) as Provider[];
      customProviders = customProviders.filter((item) => item.id !== p.id);
      if (p.source !== 'builtin') {
        customProviders.push(p);
      }
      localStorage.setItem('custom_providers', JSON.stringify(customProviders));
    }

    set((state) => ({
      providers: {
        ...state.providers,
        [p.id]: p,
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
