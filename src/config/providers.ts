import { modelConfigs } from './aiCharacters';

export interface Provider {
  id: string;
  name: string;
  baseURL: string;
  apiKeyRef: string;
  models: string[];
  source: 'builtin' | 'user';
  enabled?: boolean;
  iconUrl?: string;
  description?: string;
}

const API_KEY_TO_PROVIDER: Record<string, { id: string; name: string }> = {
  DASHSCOPE_API_KEY: { id: 'qwen', name: '通义千问' },
  ARK_API_KEY: { id: 'volcengine', name: '火山引擎' },
  ARK_API_KEY1: { id: 'volcengine', name: '火山引擎' },
  HUNYUAN_API_KEY1: { id: 'hunyuan', name: '腾讯混元' },
  GLM_API_KEY: { id: 'glm', name: '智谱 GLM' },
  DEEPSEEK_API_KEY: { id: 'deepseek', name: 'DeepSeek' },
  KIMI_API_KEY: { id: 'kimi', name: 'Moonshot Kimi' },
  BAIDU_API_KEY: { id: 'baidu', name: '百度千帆' },
};

function buildFromModelConfigs(): Provider[] {
  const byKey = new Map<string, Provider>();

  for (const cfg of modelConfigs) {
    const meta = API_KEY_TO_PROVIDER[cfg.apiKey];
    if (!meta) continue;

    const apiKeyRef = `provider:${meta.id}`;
    const key = `${cfg.baseURL}\0${apiKeyRef}`;

    let provider = byKey.get(key);
    if (!provider) {
      provider = {
        id: meta.id,
        name: meta.name,
        baseURL: cfg.baseURL,
        apiKeyRef,
        models: [],
        source: 'builtin',
        enabled: true,
      };
      byKey.set(key, provider);
    }

    if (!provider.models.includes(cfg.model)) {
      provider.models.push(cfg.model);
    }
  }

  return Array.from(byKey.values());
}

export const builtinProviders: Provider[] = [
  ...buildFromModelConfigs(),
  {
    id: 'ollama',
    name: 'Ollama 本地',
    baseURL: 'http://localhost:11434/v1',
    apiKeyRef: 'provider:ollama',
    models: [],
    source: 'builtin',
    enabled: true,
  },
];

/** 通过 model 反查 builtin Provider（多命中时取 builtin 字母序最小 id） */
export function lookupProviderByModel(
  model: string,
  providers: Provider[] = builtinProviders,
): string {
  const candidates = providers
    .filter((p) => p.enabled !== false && (p.models || []).includes(model))
    .sort((a, b) => {
      if (a.source === 'builtin' && b.source !== 'builtin') return -1;
      if (b.source === 'builtin' && a.source !== 'builtin') return 1;
      return a.id.localeCompare(b.id);
    });
  return candidates[0]?.id ?? `unmapped-${model}`;
}

/** 环境变量名 → Provider id（未命中返回 unmapped-* placeholder） */
export function lookupProviderByEnvName(envName: string): string {
  let s = envName.trim();
  if (s.startsWith('API_KEY_')) s = s.slice('API_KEY_'.length);
  for (const suffix of ['_API_KEY1', '_API_KEY']) {
    if (s.endsWith(suffix)) {
      s = s.slice(0, -suffix.length);
      break;
    }
  }
  const lower = s.toLowerCase();
  const map: Record<string, string> = {
    dashscope: 'qwen',
    ark: 'volcengine',
    hunyuan: 'hunyuan',
    glm: 'glm',
    deepseek: 'deepseek',
    kimi: 'kimi',
    baidu: 'baidu',
    ollama_url: 'ollama',
    ollama: 'ollama',
  };
  return map[lower] ?? `unmapped-${envName}`;
}

export const LEGACY_API_KEY_PREFIX = 'API_KEY_';

/** legacy localStorage 键映射（迁移后清除；迁移前只读 fallback） */
export const LEGACY_API_KEY_STORAGE: Record<string, string[]> = {
  qwen: ['API_KEY_DASHSCOPE_API_KEY'],
  volcengine: ['API_KEY_ARK_API_KEY', 'API_KEY_ARK_API_KEY1'],
  hunyuan: ['API_KEY_HUNYUAN_API_KEY', 'API_KEY_HUNYUAN_API_KEY1'],
  glm: ['API_KEY_GLM_API_KEY'],
  deepseek: ['API_KEY_DEEPSEEK_API_KEY'],
  kimi: ['API_KEY_KIMI_API_KEY'],
  baidu: ['API_KEY_BAIDU_API_KEY'],
  ollama: ['API_KEY_OLLAMA_URL'],
};

export function readLegacyApiKey(providerId: string): string | null {
  if (typeof localStorage === 'undefined') return null;
  const keys = LEGACY_API_KEY_STORAGE[providerId];
  if (!keys) return null;
  for (const storageKey of keys) {
    const val = localStorage.getItem(storageKey)?.trim();
    if (val) return val;
  }
  return null;
}

export function mapProviderToRust(p: Provider) {
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
