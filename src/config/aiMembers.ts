export interface AIMemberBase {
  id: string;                   // Unique ID (e.g. llm-*)
  name: string;
  avatar?: string;
  description?: string;
  tags?: string[];
  source: 'builtin' | 'user';   // Builtin preset vs user created
  /** 若由官方模板派生，记录模板 id */
  forkedFrom?: string;
  enabled?: boolean;
  createdAt?: number;
  updatedAt?: number;
}

export interface LLMMember extends AIMemberBase {
  kind: 'llm';
  providerId: string;
  model: string;
  /** 仅供消息调度分类，不影响运行 */
  schedulerTag?: string;
  customPrompt?: string;
  stages?: { name: string; prompt: string }[];
}

export type AIMember = LLMMember;
export type AIMemberKind = AIMember['kind'];

/** 旧版本遗留的开发群友 / 专家成员类型，读取历史数据时需要过滤掉 */
export const REMOVED_MEMBER_KINDS = ['cli', 'agent'] as const;

export function isSupportedMemberKind(kind: unknown): kind is AIMemberKind {
  return kind === 'llm';
}

// Built-in Seed Presets
export const builtinAIMembers: AIMember[] = [];
