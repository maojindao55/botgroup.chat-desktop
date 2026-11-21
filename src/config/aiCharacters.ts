import type { AIMember } from './aiMembers';
import { applyPromptTemplate } from '@/utils/prompt';

// ============ 模型配置 ============
export const modelConfigs = [
  {
    model: "qwen-plus",
    apiKey: "DASHSCOPE_API_KEY",
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1"
  },
  {
    model: "deepseek-v3-250324",
    apiKey: "ARK_API_KEY",
    baseURL: "https://ark.cn-beijing.volces.com/api/v3"
  },
  {
    model: "hunyuan-turbos-latest",
    apiKey: "HUNYUAN_API_KEY1",
    baseURL: "https://api.hunyuan.cloud.tencent.com/v1"
  },
  {
    model: "doubao-1-5-lite-32k-250115",
    apiKey: "ARK_API_KEY",
    baseURL: "https://ark.cn-beijing.volces.com/api/v3"
  },
  {
    model: "ep-20250306223646-szzkw",
    apiKey: "ARK_API_KEY1",
    baseURL: "https://ark.cn-beijing.volces.com/api/v3"
  },
  {
    model: "glm-4-air",
    apiKey: "GLM_API_KEY",
    baseURL: "https://open.bigmodel.cn/api/paas/v4/"
  },
  {
    model: "qwen-turbo",
    apiKey: "DASHSCOPE_API_KEY",
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1"
  },
  {
    model: "deepseek-chat",
    apiKey: "DEEPSEEK_API_KEY",
    baseURL: "https://api.deepseek.com/v1"
  },
  {
    model: "moonshot-v1-8k",
    apiKey: "KIMI_API_KEY",
    baseURL: "https://api.moonshot.cn/v1"
  },
  {
    model: "ernie-3.5-128k",
    apiKey: "BAIDU_API_KEY",
    baseURL: "https://qianfan.baidubce.com/v2"
  }
] as const;

export type ModelType = typeof modelConfigs[number]["model"];

// ============ LLM 角色接口 ============
export interface AICharacter {
  id: string;
  name: string;
  personality: string;
  model: ModelType;
  providerId?: string;
  avatar?: string;
  custom_prompt?: string;
  tags?: string[];
  stages?: { name: string; prompt: string }[];
  runtime?: 'llm';
}

export type Character = AICharacter;

/** 替换 prompt 中的占位符，未传 groupName 时仍处理 {{aiName}} 等 */
function applyGroupNamePlaceholder(text: string | undefined, groupName?: string, aiName?: string): string | undefined {
  if (!text) return text;
  return applyPromptTemplate(text, { groupName, aiName });
}

/**
 * Convert AIMember to legacy AICharacter
 * @param groupName 可选，传入后会把 customPrompt / stages 内的 `#groupName#` 占位符替换为实际群名
 */
export function mapAIMemberToLegacy(m: AIMember, groupName?: string): AICharacter {
  return {
    id: m.id,
    name: m.name,
    personality: m.schedulerTag || m.name,
    providerId: m.providerId,
    model: m.model as ModelType,
    avatar: m.avatar,
    custom_prompt: applyGroupNamePlaceholder(m.customPrompt, groupName, m.name),
    tags: m.tags,
    stages: groupName && m.stages
      ? m.stages.map((s) => ({
          name: s.name,
          prompt: applyGroupNamePlaceholder(s.prompt, groupName, m.name) || s.prompt,
        }))
      : m.stages,
    runtime: 'llm'
  };
}
