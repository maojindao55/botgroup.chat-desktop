/**
 * 模型服务的默认采样/生成参数。
 * 键名采用 OpenAI 兼容接口的原生命名（snake_case），便于直接合并进请求体；
 * 这些参数会作为该 Provider 下所有调用的默认值（成员级显式参数可覆盖）。
 * 允许任意自定义键，以透传各厂商专有参数（如 repetition_penalty、enable_thinking 等）。
 */
export interface ProviderParams {
  temperature?: number;
  top_p?: number;
  top_k?: number;
  max_tokens?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  [key: string]: unknown;
}

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
  /** 默认模型参数，会合并进每次请求体（如 temperature、top_p、top_k、max_tokens 等） */
  params?: ProviderParams;
}

/**
 * 服务商类型预设（仅用于「新建模型服务」时快速填入 API 地址）。
 * 注意：这里只提供 name + baseURL，**不预设任何模型**，模型需用户自行填写。
 * id 与 i18n `providers:builtin.*` 对齐，便于展示本地化名称。
 */
export interface ProviderPreset {
  id: string;
  name: string;
  baseURL: string;
}

export const providerPresets: ProviderPreset[] = [
  { id: 'deepseek', name: 'DeepSeek', baseURL: 'https://api.deepseek.com/v1' },
  { id: 'qwen', name: '通义千问', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { id: 'volcengine', name: '火山引擎', baseURL: 'https://ark.cn-beijing.volces.com/api/v3' },
  { id: 'hunyuan', name: '腾讯混元', baseURL: 'https://api.hunyuan.cloud.tencent.com/v1' },
  { id: 'glm', name: '智谱 GLM', baseURL: 'https://open.bigmodel.cn/api/paas/v4/' },
  { id: 'kimi', name: 'Moonshot Kimi', baseURL: 'https://api.moonshot.cn/v1' },
  { id: 'baidu', name: '百度千帆', baseURL: 'https://qianfan.baidubce.com/v2' },
  { id: 'openai', name: 'OpenAI', baseURL: 'https://api.openai.com/v1' },
  { id: 'ollama', name: 'Ollama 本地', baseURL: 'http://localhost:11434/v1' },
  { id: 'custom', name: '自定义', baseURL: '' },
];

/**
 * 不再内置任何模型服务预设（资源库默认为空，仅展示用户自建）。
 * 新建时可通过 {@link providerPresets} 选择服务商类型来快速填入 API 地址。
 */
export const builtinProviders: Provider[] = [];

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
    params: p.params ?? null,
  };
}
