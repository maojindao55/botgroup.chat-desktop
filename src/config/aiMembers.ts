import type { AgentTool } from './groups';
import type { CLIAdapterId } from './cliAdapters';

export interface AIMemberBase {
  id: string;                   // Unique ID (e.g. llm-*, agent-*, cli-*)
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

export interface AgentMember_v2 extends AIMemberBase {
  kind: 'agent';
  role: string;
  systemPrompt: string;
  providerId: string;
  model: string;
  tools: AgentTool[];
  maxTurns: number;
  temperature: number;
}

export interface CLIMember extends AIMemberBase {
  kind: 'cli';
  cli: {
    adapter: CLIAdapterId;
    binary?: string;
    extraArgs?: string[];
    toolSessionId?: string;
    env?: Record<string, string>;
    approvalMode?: 'auto' | 'ask';
    showStderr?: boolean;
  };
}

export type AIMember = LLMMember | AgentMember_v2 | CLIMember;
export type AIMemberKind = AIMember['kind'];

// Built-in Seed Presets（仅开发成员；角色与专家由用户自建）
export const builtinAIMembers: AIMember[] = [
  {
    id: 'cli-codex',
    kind: 'cli',
    name: 'Codex',
    avatar: '/img/codex.webp?v=1779334925',
    description: 'Codex CLI Agent，擅长自动编码及代码重构',
    tags: ['编码', '重构', '调试', '编程', '深度推理'],
    source: 'builtin',
    enabled: true,
    cli: {
      adapter: 'codex',
      extraArgs: ['--json', '--sandbox', 'workspace-write'],
      approvalMode: 'auto',
      showStderr: true,
    }
  },
  {
    id: 'cli-claude-code',
    kind: 'cli',
    name: 'ClaudeCode',
    avatar: '/img/claude.webp?v=1779334925',
    description: 'Claude Code CLI Agent，擅长代码库分析及复杂调试',
    tags: ['编码', '重构', '调试', '编程', '分析数据', '深度推理'],
    source: 'builtin',
    enabled: true,
    cli: {
      adapter: 'claude',
      approvalMode: 'auto',
      showStderr: false,
    }
  },
  {
    id: 'cli-opencode',
    kind: 'cli',
    name: 'OpenCode',
    avatar: '/img/opencode.webp?v=1779334925',
    description: 'OpenCode 开源编码助手',
    tags: ['编码', '重构', '调试', '编程'],
    source: 'builtin',
    enabled: true,
    cli: {
      adapter: 'opencode',
      approvalMode: 'auto',
      showStderr: true,
    }
  },
  {
    id: 'cli-cursor',
    kind: 'cli',
    name: 'Cursor',
    avatar: 'lobehub:Cursor',
    description: 'Cursor Agent CLI，基于 Composer 模型的本地编码助手',
    tags: ['编码', '重构', '调试', '编程', '深度推理'],
    source: 'builtin',
    enabled: true,
    cli: {
      adapter: 'cursor',
      approvalMode: 'auto',
      showStderr: false,
    }
  },
];
