import { builtinAIMembers, AIMember } from './aiMembers';
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

// ============ LLM 角色接口（AI 群聊专用）============
export interface AICharacter {
  id: string;
  name: string;
  personality: string;
  model: ModelType;
  avatar?: string;
  custom_prompt?: string;
  tags?: string[];
  stages?: { name: string; prompt: string }[];
  runtime?: 'llm';
}

// ============ CLI Agent 接口（CLI 群聊专用）============
export interface CLIAgent {
  id: string;
  name: string;
  personality: string;
  model: ModelType;           // 占位，CLI 不真正用 LLM
  avatar?: string;
  custom_prompt?: string;
  tags?: string[];
  runtime: 'cli';
  cli: {
    adapter: 'codex' | 'opencode' | 'claude' | 'cursor' | 'aider' | 'gemini' | 'generic';
    binary?: string;
    extraArgs?: string[];
    toolSessionId?: string;
    env?: Record<string, string>;
    approvalMode?: 'auto' | 'ask';
    showStderr?: boolean;
  };
}

// 联合类型（兼容旧代码中 `AICharacter` 的使用）
export type Character = AICharacter | CLIAgent;

/** 替换 prompt 中的占位符，未传 groupName 时仍处理 {{aiName}} 等 */
function applyGroupNamePlaceholder(text: string | undefined, groupName?: string, aiName?: string): string | undefined {
  if (!text) return text;
  return applyPromptTemplate(text, { groupName, aiName });
}

/**
 * Convert AIMember to legacy AICharacter / CLIAgent
 * @param groupName 可选，传入后会把 customPrompt / stages 内的 `#groupName#` 占位符替换为实际群名
 */
export function mapAIMemberToLegacy(m: AIMember, groupName?: string): Character {
  if (m.kind === 'llm') {
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
  } else if (m.kind === 'cli') {
    return {
      id: m.id,
      name: m.name,
      personality: m.id + '-cli',
      model: modelConfigs[0].model,
      avatar: m.avatar,
      custom_prompt: '',
      tags: m.tags,
      runtime: 'cli',
      cli: m.cli
    };
  } else {
    // Agent: systemPrompt 当作老 custom_prompt 暴露
    return {
      id: m.id,
      name: m.name,
      personality: 'agent',
      providerId: m.providerId,
      model: m.model,
      avatar: m.avatar,
      custom_prompt: applyGroupNamePlaceholder(m.systemPrompt, groupName, m.name),
      tags: m.tags
    };
  }
}

// ============ LLM 角色列表（AI 群聊专用）============
export function generateAICharacters(_groupName: string, allTags: string): AICharacter[] {
  return [
    {
      id: 'ai0',
      name: "调度器",
      personality: "sheduler",
      model: modelConfigs[0].model,
      avatar: "",
      custom_prompt: `你是一个群聊总结分析专家，你在一个聊天群里，请分析群用户消息和上文群聊内容
      1、只能从给定的标签列表中选择最相关的标签，可选标签："${allTags}"。
      2、请只返回标签列表，用逗号分隔，不要有其他解释, 不要有任何前缀。
      3、回复格式示例：文字游戏, 新闻报道, 娱乐`
    }
  ];
}

export const cliAgents: CLIAgent[] = builtinAIMembers
  .filter(m => m.kind === 'cli')
  .map(m => mapAIMemberToLegacy(m)) as CLIAgent[];

/** 获取所有 LLM 角色（不含调度器） */
export function getAvailableAICharacters(): AICharacter[] {
  return builtinAIMembers
    .filter(m => m.kind === 'llm')
    .map(m => mapAIMemberToLegacy(m)) as AICharacter[];
}

/** 获取所有 CLI Agent */
export function getAvailableCLIAgents(): CLIAgent[] {
  return cliAgents;
}
