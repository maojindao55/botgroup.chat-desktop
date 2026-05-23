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

export function mapProviderToRust(p: Provider) {
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
