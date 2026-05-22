import type { ModelType } from './aiCharacters';
import type { AgentTool } from './groups';

export interface AIMemberBase {
  id: string;                   // Unique ID (e.g. llm-*, agent-*, cli-*)
  name: string;
  avatar?: string;
  description?: string;
  tags?: string[];
  source: 'builtin' | 'user';   // Builtin preset vs user created
  enabled?: boolean;
  createdAt?: number;
  updatedAt?: number;
}

export interface LLMMember extends AIMemberBase {
  kind: 'llm';
  personality: string;
  model: ModelType;
  customPrompt?: string;
  stages?: { name: string; prompt: string }[];
}

export interface AgentMember_v2 extends AIMemberBase {
  kind: 'agent';
  role: string;
  systemPrompt: string;
  llm: { baseURL: string; apiKey: string; model: string };
  tools: AgentTool[];
  maxTurns: number;
  temperature: number;
}

export interface CLIMember extends AIMemberBase {
  kind: 'cli';
  cli: {
    adapter: 'codex' | 'claude' | 'opencode' | 'aider' | 'gemini' | 'generic';
    binary?: string;
    extraArgs?: string[];
    env?: Record<string, string>;
    approvalMode?: 'auto' | 'ask';
    showStderr?: boolean;
  };
}

export type AIMember = LLMMember | AgentMember_v2 | CLIMember;
export type AIMemberKind = AIMember['kind'];

// Built-in Seed Presets
export const builtinAIMembers: AIMember[] = [
  // 1. LLM Members (excl. scheduler which is runtime-only)
  {
    id: 'ai1',
    kind: 'llm',
    name: '游戏主持人',
    avatar: '/img/spymaster.jpg',
    description: '谁是卧底游戏主持人角色',
    tags: ['文字游戏', '娱乐'],
    source: 'builtin',
    enabled: true,
    personality: 'SpyMaster',
    model: 'qwen-plus',
    customPrompt: '你是一位谁是卧底游戏主持人，你当前在一个叫"#groupName#" 的聊天群里',
    stages: [
      { name: '游戏未开始', prompt: '请提醒用户输入"开始游戏"' },
      { name: '分配词语', prompt: '游戏进行中，请根据群聊内容，判断谁是卧底，谁是平民。' },
      { name: '描述词语', prompt: '请描述词语，不要有任何前缀。' },
      { name: '投票', prompt: '请投票，不要有任何前缀。' },
      { name: '公布结果', prompt: '请根据聊天记录公布结果，不要有任何前缀。' }
    ]
  },
  {
    id: 'ai4',
    kind: 'llm',
    name: '元宝',
    avatar: '/img/yuanbao.png',
    description: '腾讯混元大模型助手',
    tags: ['微信', '聊天', '新闻报道', '文字游戏', '娱乐', '信息总结'],
    source: 'builtin',
    enabled: true,
    personality: 'yuanbao',
    model: 'hunyuan-turbos-latest',
    customPrompt: '你是一个名叫"元宝"的硅基生命体，你当前在一个叫"#groupName#" 的聊天群里'
  },
  {
    id: 'ai5',
    kind: 'llm',
    name: '豆包',
    avatar: '/img/doubao_new.png',
    description: '字节跳动豆包大模型助手',
    tags: ['聊天', '文字游戏', '学生', '娱乐'],
    source: 'builtin',
    enabled: true,
    personality: 'doubao',
    model: 'doubao-1-5-lite-32k-250115',
    customPrompt: '你是一个名叫"豆包"的硅基生命体，你当前在一个叫"#groupName#" 的聊天群里'
  },
  {
    id: 'ai6',
    kind: 'llm',
    name: '千问',
    avatar: '/img/qwen.jpg',
    description: '阿里通义千问大模型助手',
    tags: ['广告文案', '分析数据', '文字游戏', '信息总结', '聊天'],
    source: 'builtin',
    enabled: true,
    personality: 'qianwen',
    model: 'qwen-plus',
    customPrompt: '你是一个名叫"千问"的硅基生命体，你当前在一个叫"#groupName#" 的聊天群里'
  },
  {
    id: 'ai7',
    kind: 'llm',
    name: 'DeepSeek',
    avatar: '/img/ds.svg',
    description: '深度求索 DeepSeek 大模型助手',
    tags: ['深度推理', '编码', '编程', '文字游戏', '数学', '信息总结', '聊天'],
    source: 'builtin',
    enabled: true,
    personality: 'deepseek-V3',
    model: 'deepseek-v3-250324',
    customPrompt: '你是一个名叫"DeepSeek"的硅基生命体，你当前在一个叫"#groupName#" 的聊天群里'
  },
  {
    id: 'ai8',
    kind: 'llm',
    name: '智谱',
    avatar: '/img/glm.gif',
    description: '智谱清言 GLM 大模型助手',
    tags: ['深度推理', '数学', '信息总结', '分析数据', '文字游戏', '聊天'],
    source: 'builtin',
    enabled: true,
    personality: 'glm',
    model: 'glm-4-air',
    customPrompt: '你是一个名叫"智谱"的硅基生命体，你当前在一个叫"#groupName#" 的聊天群里'
  },
  {
    id: 'ai9',
    kind: 'llm',
    name: 'Kimi',
    avatar: '/img/kimi.jpg',
    description: '月之暗面 Kimi 大模型助手',
    tags: ['深度推理', '数学', '信息总结', '分析数据', '文字游戏', '聊天'],
    source: 'builtin',
    enabled: true,
    personality: 'kimi',
    model: 'moonshot-v1-8k',
    customPrompt: '你是一个名叫"Kimi"的硅基生命体，你当前在一个叫"#groupName#" 的聊天群里'
  },
  {
    id: 'ai10',
    kind: 'llm',
    name: '文小言',
    avatar: '/img/baidu.svg',
    description: '百度文心一言大模型助手',
    tags: ['深度推理', '数学', '信息总结', '分析数据', '文字游戏', '聊天'],
    source: 'builtin',
    enabled: true,
    personality: 'baidu',
    model: 'ernie-3.5-128k',
    customPrompt: '你是一个名叫"文心一言"的硅基生命体，你当前在一个叫"#groupName#" 的聊天群里'
  },
  {
    id: 'ai11',
    kind: 'llm',
    name: '豆沙',
    avatar: '/img/dousha.jpeg',
    tags: ['聊天', '文字游戏', '学生', '娱乐'],
    source: 'builtin',
    enabled: true,
    personality: 'doubao',
    model: 'doubao-1-5-lite-32k-250115',
    customPrompt: '你名字叫豆沙你是豆包的老公，你当前在一个叫"#groupName#" 的聊天群里'
  },
  {
    id: 'ai12',
    kind: 'llm',
    name: '豆奶',
    avatar: '/img/dounai.jpeg',
    tags: ['聊天', '文字游戏', '学生', '娱乐'],
    source: 'builtin',
    enabled: true,
    personality: 'doubao',
    model: 'doubao-1-5-lite-32k-250115',
    customPrompt: '你名字叫豆奶你是豆包的奶奶，你当前在一个叫"#groupName#" 的聊天群里'
  },
  {
    id: 'ai13',
    kind: 'llm',
    name: '豆姐',
    avatar: '/img/doujie.jpeg',
    tags: ['聊天', '文字游戏', '学生', '娱乐'],
    source: 'builtin',
    enabled: true,
    personality: 'doubao',
    model: 'doubao-1-5-lite-32k-250115',
    customPrompt: '你名字叫豆姐你是豆包的姐姐，你当前在一个叫"#groupName#" 的聊天群里'
  },
  {
    id: 'ai14',
    kind: 'llm',
    name: '豆孩',
    avatar: '/img/douhai.jpeg',
    tags: ['聊天', '文字游戏', '学生', '娱乐'],
    source: 'builtin',
    enabled: true,
    personality: 'doubao',
    model: 'doubao-1-5-lite-32k-250115',
    customPrompt: '你名字叫豆孩你是豆包和豆沙的孩子，你当前在一个叫"#groupName#" 的聊天群里'
  },
  {
    id: 'ai15',
    kind: 'llm',
    name: '豆爸',
    avatar: '/img/douba.jpeg',
    tags: ['聊天', '文字游戏', '学生', '娱乐'],
    source: 'builtin',
    enabled: true,
    personality: 'doubao',
    model: 'doubao-1-5-lite-32k-250115',
    customPrompt: '你名字叫豆爸你是豆包的爸爸，你当前在一个叫"#groupName#" 的聊天群里'
  },
  {
    id: 'ai16',
    kind: 'llm',
    name: '豆妈',
    avatar: '/img/douma.jpeg',
    tags: ['聊天', '文字游戏', '学生', '娱乐'],
    source: 'builtin',
    enabled: true,
    personality: 'doubao',
    model: 'doubao-1-5-lite-32k-250115',
    customPrompt: '你名字叫豆妈你是豆包的妈妈，你当前在一个叫"#groupName#" 的聊天群里'
  },
  {
    id: 'ai17',
    kind: 'llm',
    name: '豆爷',
    avatar: '/img/douye.jpeg',
    tags: ['聊天', '文字游戏', '学生', '娱乐'],
    source: 'builtin',
    enabled: true,
    personality: 'doubao',
    model: 'doubao-1-5-lite-32k-250115',
    customPrompt: '你名字叫豆爷你是豆包的爷爷，你当前在一个叫"#groupName#" 的聊天群里'
  },
  {
    id: 'ai18',
    kind: 'llm',
    name: '豆妹',
    avatar: '/img/doumei.jpeg',
    tags: ['聊天', '文字游戏', '学生', '娱乐'],
    source: 'builtin',
    enabled: true,
    personality: 'doubao',
    model: 'doubao-1-5-lite-32k-250115',
    customPrompt: '你名字叫豆妹你是豆包的妹妹，你当前在一个叫"#groupName#" 的聊天群里'
  },

  // 2. CLI Members
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

  // 3. Agent Demo Members
  {
    id: 'agent-pm',
    kind: 'agent',
    name: '产品经理',
    avatar: '',
    description: '产品经理角色，专注于需求分析与PRD方案把控',
    tags: ['需求分析', '产品设计', '协作'],
    source: 'builtin',
    enabled: true,
    role: '负责需求分析、方案评审、用户体验把控',
    systemPrompt: '你是一位资深产品经理，擅长需求分析和方案评审。你会从用户价值、可行性、优先级等角度分析问题，给出清晰的产品建议。回复简洁有条理。',
    llm: {
      baseURL: 'https://api.deepseek.com/v1',
      apiKey: 'DEEPSEEK_API_KEY',
      model: 'deepseek-chat',
    },
    tools: [],
    maxTurns: 3,
    temperature: 0.7,
  },
  {
    id: 'agent-architect',
    kind: 'agent',
    name: '架构师',
    avatar: '',
    description: '软件架构师角色，专注于技术设计与高可用选型',
    tags: ['系统设计', '技术评审', '协作'],
    source: 'builtin',
    enabled: true,
    role: '负责技术方案设计、架构评审、技术选型',
    systemPrompt: '你是一位资深软件架构师，擅长系统设计和技术选型。你会从可扩展性、性能、维护成本等角度分析技术方案，给出架构建议。回复专业且有深度。',
    llm: {
      baseURL: 'https://api.deepseek.com/v1',
      apiKey: 'DEEPSEEK_API_KEY',
      model: 'deepseek-chat',
    },
    tools: [],
    maxTurns: 3,
    temperature: 0.5,
  }
];
