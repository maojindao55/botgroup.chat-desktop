# AI 群员库（AI Member Library）抽象设计方案

> 目标：把当前 LLM 角色 / Agent / CLI Agent 三类「群员」抽象成一个统一管理功能，建群时直接从「AI 群员库」选成员，而不是在建群向导里现场配置。

## 一、现状盘点

三类群员的形态完全不统一：

| 群类型 | 群成员引用方式 | 成员定义来源 | 跨群复用 | 是否持久化 |
|---|---|---|---|---|
| `AIGroup`    | `members: string[]`（id 引用） | `src/config/aiCharacters.ts` 的 `generateAICharacters()` 硬编码 | 是 | 否（代码常量） |
| `CLIGroup`   | `members: string[]`（id 引用） | `src/config/aiCharacters.ts` 的 `cliAgents` 硬编码 | 是 | 部分（DB 有 `cli_agent_profiles` 但前端未接） |
| `AgentGroup` | `agents: AgentMember[]`（**整对象内联**） | 内联在群对象里 | **否** | 否（随群一起 `localStorage` 落地） |

三类群员的真实差异其实只在「运行时」：
- **LLM**：调云端聊天补全
- **Agent**：调云端 LLM + 工具调用 + 多轮思考
- **CLI Agent**：调用本地命令行二进制

因此设计上完全可以收敛成「一个有 `kind` 字段的成员对象」+「一个统一的成员库」。

## 二、统一数据模型

新建 `src/config/aiMembers.ts`：

```ts
interface AIMemberBase {
  id: string;                   // 全局唯一，建议前缀: llm-* / agent-* / cli-*
  name: string;
  avatar?: string;
  description?: string;
  tags?: string[];
  source: 'builtin' | 'user';   // 内置预设 vs 用户自建
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
```

调度器（`personality === 'sheduler'`）**不入库**，保留在 `aiCharacters.ts` 作为运行时常量，避免用户误选。

## 三、群结构改造：全部改为 id 引用

```ts
// 之前
export interface AgentGroup { ...; agents: AgentMember[]; }

// 之后
export interface AIGroup    { ...; memberIds: string[]; }   // 原 members 字段重命名
export interface CLIGroup   { ...; memberIds: string[]; }
export interface AgentGroup { ...; memberIds: string[]; }   // 不再内联 agent
```

优势：
1. Agent 可跨群复用（同一个「产品经理 Agent」加入多个群）
2. 改一处生效全局（API Key、Prompt）
3. 三类群的「成员列表 / @提及 / 头像 / 标签」可共用一套渲染
4. 成员、群可分别导入导出

## 四、持久化层

SQLite 新增一张通用表：

```sql
CREATE TABLE IF NOT EXISTS ai_members (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('llm','agent','cli')),
  name        TEXT NOT NULL,
  avatar      TEXT,
  description TEXT,
  tags        TEXT,                              -- JSON 数组
  source      TEXT NOT NULL DEFAULT 'user',      -- builtin | user
  config      TEXT NOT NULL,                     -- JSON: 各 kind 差异字段
  enabled     INTEGER NOT NULL DEFAULT 1,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ai_members_kind ON ai_members(kind);
```

为什么单表 + JSON：三类 kind 共享字段（name/avatar/tags/source/enabled）占多数；差异字段访问频率低，前端读出后按 `kind` 解析为对应 TS 类型即可。代价是不能在 SQL 层过滤 `config` 内字段，目前无此需求。

Rust 侧新增 IPC：

| Command | 说明 |
|---|---|
| `list_ai_members(kind?)` | 列出成员，可按 kind 过滤 |
| `get_ai_member(id)` | 取详情 |
| `upsert_ai_member(member)` | 新建或更新 |
| `delete_ai_member(id)` | 删除（先校验是否被群引用） |
| `seed_builtin_ai_members()` | 首次启动注入预设（幂等） |

**API Key 安全**：`agent.llm.apiKey` 不直接明文落 `config`，独立存到 `secrets` 表或 Tauri keyring，`config` 里只存引用名。可分阶段做；第一版可沿用现状（存 env var 名）。

## 五、UI 设计

### 5.1 新增「AI 群员库」管理页

侧边栏底部新增入口，点开是全屏抽屉：

```
┌── AI 群员库 ─────────────────────────────────────┐
│  Tabs:  [全部] [LLM] [Agent] [CLI Agent] [+ 新建] │
│  搜索 / 标签筛选                                  │
│  ─────────────────────────────────────────────── │
│  [头像] 千问           LLM   qwen-plus            │
│        ☐ 聊天 ☐ 信息总结      预设 | 编辑 | 删除   │
│  ─────────────────────────────────────────────── │
│  [头像] 产品经理       Agent  deepseek-chat       │
│        ☐ 需求 ☐ 评审          自建 | 编辑 | 删除   │
│  ─────────────────────────────────────────────── │
│  [头像] Codex          CLI    adapter: codex      │
│        ☐ 编码 ☐ 调试          预设 | 编辑 | 删除   │
└──────────────────────────────────────────────────┘
```

新建 / 编辑表单按 `kind` 切换：复用现有 `AIGroupSettings / CLIGroupSettings / AgentGroupSettings` 的字段控件。

### 5.2 建群向导改造

`CreateGroupWizard.tsx` 第三步「成员」改为**统一的成员选择器**，按当前 `groupType` 自动过滤库内 `kind`：

```
选择成员（已选 N 个）           [+ 新建 XX 成员 →]
─────────────────────────────────────────────────
☑ [头像] 千问        qwen-plus    聊天 / 信息总结
☐ [头像] DeepSeek    deepseek-v3  编码 / 数学
☐ [头像] 智谱        glm-4-air    深度推理
```

- AI 群  → `kind='llm'`
- CLI 群 → `kind='cli'`
- Agent 群 → `kind='agent'`

建群向导里不再出现「填一堆 API Key、System Prompt」的现场配置流程。

### 5.3 群设置改造

`AIGroupSettings / CLIGroupSettings / AgentGroupSettings` 共用 `<MemberPicker kind=... />` 组件管理成员；Agent 的 LLM/Tools/Prompt 表单收敛到成员库的编辑页。群设置只保留群级配置（strategy / coordinatorPrompt / maxRounds / workspace 等）。

## 六、状态管理

新增 `src/store/aiMemberStore.ts`（Zustand）：

```ts
interface AIMemberStore {
  members: Record<string, AIMember>;
  loading: boolean;
  load: () => Promise<void>;                       // invoke('list_ai_members')
  upsert: (m: AIMember) => Promise<void>;
  remove: (id: string) => Promise<void>;
  list: (kind?: AIMemberKind) => AIMember[];
  get: (id: string) => AIMember | undefined;
  findReferencingGroups: (id: string) => Group[];  // 删除前的引用检查
}
```

## 七、迁移与兼容性

启动时一次性迁移：

1. **DB schema 升级**：`init_db_schemas` 增加 `ai_members` 表，schema_version +1。
2. **Seed builtin**（幂等，按 id 跳过）：
   - `generateAICharacters('', '')` 过滤掉 `personality === 'sheduler'` → `kind='llm', source='builtin'`
   - `cliAgents` 数组 → `kind='cli', source='builtin'`
3. **存量群迁移**（读 `localStorage.custom_groups` + `defaultGroups`）：
   - `AIGroup.members`  → `memberIds`（保留兼容读取一次旧字段）
   - `CLIGroup.members` → `memberIds`
   - `AgentGroup.agents[]` → 每条生成 id 后写入 `ai_members(kind='agent', source='user')`，群本体替换为 `memberIds`
4. **取数处适配**：`ChatUI / AgentChatUI / engine/agentEngine.ts` 从 `group.agents` 改成 `memberIds.map(id => memberStore.get(id))`。
5. **类型过渡**：旧 `AICharacter / CLIAgent` 保留为「读模型」（由 `AIMember` 派生），减少一次性大改面。

## 八、文件结构变动

```
src/config/
  aiMembers.ts                    ← 新：AIMember 类型 + builtin seed
  aiCharacters.ts                 ← 简化为读模型 + 兼容导出
  groups.ts                       ← members → memberIds
src/store/
  aiMemberStore.ts                ← 新
src/pages/chat/components/
  AIMemberLibrary.tsx             ← 新：成员库管理抽屉
  AIMemberEditor.tsx              ← 新：按 kind 切表单
  MemberPicker.tsx                ← 新：建群/群设置共用选择器
  CreateGroupWizard.tsx           ← 改：第三步用 MemberPicker
  AgentGroupSettings.tsx          ← 改：去掉 agent 内联编辑
  AIGroupSettings.tsx             ← 改：用 MemberPicker
  CLIGroupSettings.tsx            ← 改：用 MemberPicker
src-tauri/src/
  db.rs                           ← 加 ai_members 表 + CRUD
  lib.rs                          ← 暴露 IPC commands
```

## 九、实施分阶段

| 阶段 | 内容 | 风险 |
|---|---|---|
| **P1 数据层** | `ai_members` 表 + Rust CRUD + Zustand store + seed builtin | 低 |
| **P2 UI 库** | 「AI 群员库」管理页（只读 → 增删改） | 低 |
| **P3 建群** | 建群向导第三步改用 `MemberPicker`（AI / CLI 群先切换；语义本就一致） | 低 |
| **P4 Agent 群迁移** | `AgentGroup.agents → memberIds` 一次性迁移；改造 `AgentGroupSettings / agentEngine.ts` | 中 |
| **P5 高级能力** | 成员导入/导出 JSON、API Key 入 keyring、@提及联想走库 | 中 |

每个阶段可独立合并、不破坏现状；P4 完成即可彻底移除内联 `AgentMember` 形态。

## 十、关键设计权衡

- **单表 + JSON config vs 三张表 join**：选前者。三类 kind 共享字段占多数，差异字段访问频率低，单表 + JSON 让 list 查询零 join；目前不存在按差异字段过滤的 SQL 需求。
- **builtin 与 user 同表 + `source` 字段 vs 两张表**：选前者。用户可以「另存为」内置预设进行微调，UI 上只是个标签区分；同表方便编辑/克隆。
- **复用 `cli_agent_profiles` vs 新表**：选新表。该表字段已扁平化（adapter / binary / extra_args / ...）和 LLM/Agent 字段不兼容；强行扩列会得到很稀疏的表，`ai_members.config` JSON 更适合做 union 容器。`cli_agent_profiles` 可作为存量数据迁移源后弃用。
- **`sheduler` 调度器不入库**：它是 `ChatUI` 标签调度的内部角色，不应被用户选入群；保留在 `generateAICharacters()` 作为运行时常量。
- **AgentGroup.agents 一次性迁移而非长期双写**：双写会让 `agentEngine.ts` 永远要兼顾两种取数路径，复杂度滚雪球。迁移逻辑在启动时跑一次即可。
