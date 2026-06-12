# AI 群员库优化设计（A-完整 + S3 + B-fork）

> 在 `2026-05-22-ai-member-library-design.md` 已落地的统一抽象基础上，进一步解决 **数据模型正确性 (A)** 与 **UX 可用性 (B)** 两类沉积痛点。
>
> 本设计已通过 brainstorming 流程在三个分叉上做出选择：
> - **A 覆盖面：A-完整** —— Provider 抽象 + apiKeyRef 语义统一 + Secrets 落地加密 vault
> - **Secrets 存储后端：S3** —— SQLite `secrets` 表 + AES-GCM 加密 + 本地 `master.key`（不依赖 OS keyring）
> - **builtin 编辑语义：B-fork** —— builtin 严格只读，"编辑" 等价于克隆为 user 实体

## 一、现状盘点（修正版）

### A 类痛点

| 项 | 现状 | 影响 |
|---|---|---|
| Personality magic string | 历史包袱，曾用于运行时分支 | 库改造后 `/api/chat` 已直接读 `customPrompt`，**实际只剩调度器分类用途**——是 display/分类字段，但命名/位置仍误导 |
| API Key 字段含义混乱 | LLM 用 `modelConfig.apiKey` 指 env 名，Agent `llm.apiKey` 既可能是 env 名也可能是真 key，`/api/agent/chat:970` 用 `apiKey.includes('KEY')` 启发式判断 | 用户填错=静默不工作；安全审计困难 |
| 真 secret 落地 | **全部明文存 `localStorage.API_KEY_*`** | renderer 进程 / 调试器 / XSS 都能读到；磁盘也是明文 |
| Provider 散在 | 每个 LLM 成员只有 `model`，反查 `modelConfigs[]`；Agent 成员 inline `{ baseURL, apiKey, model }` | 5 个 Agent 共用一家服务要改 5 遍 baseURL；自托管端点无处挂 |
| Prompt 模板 | 硬编码 `#groupName#` 占位符 | 加新占位符要全局改；语法非标准 |

### B 类痛点

| 项 | 现状 |
|---|---|
| builtin 可编辑、覆盖即不可还原 | `aiMemberStore.upsert` 无防御；`request.ts:271` 仅在空库时 seed，**新加 builtin 永远进不去** |
| 缺"另存为/克隆" | 微调一个 builtin 必须直接改原版 |
| 没"测试连接" | 配完不知能不能跑，只能发消息试 |
| 标签 freeform | `'聊天'` / `'对话'` / `'信息总结'` 已经乱了，找成员靠肉眼 |
| MemberPicker 信息密度低 | 不展示 model / adapter / 可用性，选起来盲选 |
| 头像只支持 URL | 没图库、没上传 |

## 二、Secrets Vault（S3）

### 2.1 总体约束

| 约束 | 取舍 |
|---|---|
| 加密算法 | AES-256-GCM (`aes-gcm` crate, RustCrypto)；AAD = secret name，防 swap 攻击 |
| Master key 来源 | 首次启动 CSPRNG 生成 32 字节 → 落 `${app_data_dir}/master.key`（Unix 0600 / Windows ACL 限当前用户读）；**不依赖 OS keyring** |
| Master key 备份/恢复 | **v1 不做**——本地丢了等价于 key 丢了。文档明确告知。后续可加用户密码包裹 |
| 谁能解密 | **只有 Rust 端**——前端永远拿不到明文 |

### 2.2 SQLite schema

```sql
CREATE TABLE IF NOT EXISTS secrets (
  name        TEXT PRIMARY KEY,
  ciphertext  BLOB NOT NULL,
  nonce       BLOB NOT NULL,             -- 12 字节，每条独立随机
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

命名空间约定：

| 前缀 | 用途 | 例 |
|---|---|---|
| `provider:<id>` | Provider 级 key | `provider:deepseek` |
| `member:<id>:<slot>` | 成员私有 key（v2 才用） | 留口子，本次不实现 |

### 2.3 IPC 接口

```rust
#[tauri::command] fn secret_set(name: String, value: String) -> Result<()>;
#[tauri::command] fn secret_has(name: String) -> Result<bool>;     // 只判存在
#[tauri::command] fn secret_delete(name: String) -> Result<()>;
#[tauri::command] fn secret_list_names() -> Result<Vec<String>>;   // 只返回名字
```

**注意没有 `secret_get` IPC**：前端永远不读明文。Rust 端内部模块（如 `llm_proxy.rs`）通过 `vault::get(name)` 内部函数读取明文，不暴露为 Tauri command。

### 2.4 关键架构变化：LLM/Agent proxy 移到 Rust

这是 S3 真正成立的前提，绕不开。

**现状**：`request.ts:846-963` 与 `965-1052` 在前端 fetch，前端从 `localStorage.API_KEY_*` 取明文拼 `Authorization: Bearer <key>`——renderer 任何代码 / 调试器 / XSS 都能拿到所有 key。

**改造**：

```rust
#[tauri::command]
async fn llm_chat_stream(
    provider_id: String,
    model: String,
    messages: Vec<Message>,
    temperature: Option<f64>,
    tools: Option<Vec<Tool>>,
    session_id: String,             // 流式 event 通道
) -> Result<()>;
```

前端把 `fetch(baseURL + '/chat/completions', { Authorization: Bearer key })` 改成 `invoke('llm_chat_stream', { providerId, model, ... })` + listen `llm://${session_id}`。

**收益**：
- 密钥永远不出 Rust 边界
- "Ollama 自定义 URL" 这类 special case 收敛到 Rust 配置
- `clientScheduleAI()` 走同一通道，不读 localStorage

**代价**：
- 多写一个 Rust 端 OpenAI 兼容 client（`reqwest` + SSE 解析）
- `/api/chat` `/api/agent/chat` 两条路径都要改 wiring

### 2.5 取舍说明

- **AES-GCM vs ChaCha20-Poly1305**：桌面平台 AES-GCM 普遍有硬件加速；合规材料对得上
- **不存到 OS keyring 做 master**：这是 S3 的定义边界——纯 SQLite + 本地文件 master
- **不提供 `secret_get`**：一旦提供，"安全" 立刻退化为 "renderer 进程可读"，等价于 localStorage 加点 obfuscation
- **必须把 proxy 也挪过去**：不挪的话 A-完整 名不副实，应直接降级为 A-中等

## 三、Provider 抽象 + 成员模型清理

### 3.1 Provider 实体

```ts
interface Provider {
  id: string;            // 'qwen' / 'deepseek' / 'ollama-local' / 'user-anthropic-...'
  name: string;
  baseURL: string;
  apiKeyRef: string;     // vault 中 secret name：'provider:qwen'，是引用不是值
  models: string[];      // ['qwen-plus', 'qwen-turbo', ...]
  source: 'builtin' | 'user';
  enabled?: boolean;
  iconUrl?: string;
  description?: string;
}
```

#### Provider 表

```sql
CREATE TABLE IF NOT EXISTS providers (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  base_url    TEXT NOT NULL,
  api_key_ref TEXT NOT NULL,
  models      TEXT NOT NULL,             -- JSON 数组
  source      TEXT NOT NULL DEFAULT 'user',
  icon_url    TEXT,
  description TEXT,
  enabled     INTEGER NOT NULL DEFAULT 1,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### IPC

```rust
list_providers() -> Vec<Provider>
get_provider(id) -> Option<Provider>
upsert_provider(p: Provider)
delete_provider(id)               // 先校验是否被任何 ai_member 引用
seed_builtin_providers(ps)        // 增量、幂等
```

Builtin providers 由 `modelConfigs[]` seed：qwen / deepseek / hunyuan / doubao / glm / kimi / baidu / ernie / ollama 等。B-fork 语义同样适用——用户改 builtin provider 弹"创建副本"。

### 3.2 LLM 成员清理

```ts
// 之前
interface LLMMember {
  kind: 'llm';
  personality: string;       // magic string，行为耦合
  model: ModelType;          // 隐式查 modelConfigs 拿 baseURL/apiKey
  customPrompt?: string;
  stages?: ...;
}

// 之后
interface LLMMember {
  kind: 'llm';
  providerId: string;        // 引用 providers 表
  model: string;             // 必须在 provider.models 内
  customPrompt?: string;     // 支持 {{groupName}} {{aiName}}
  stages?: ...;
  schedulerTag?: string;     // 原 personality，仅供 clientScheduleAI 分类用，不影响运行
}
```

- `personality` → 改名 `schedulerTag`，标注"仅用于消息调度分类，不影响运行"
- 编辑器里默认折叠到"高级"区
- 用户新建 LLM 成员默认无 `schedulerTag`，调度器走 tags fallback

### 3.3 Agent 成员清理

```ts
// 之前
interface AgentMember_v2 {
  kind: 'agent';
  role: string;
  systemPrompt: string;
  llm: { baseURL: string; apiKey: string; model: string };   // ⚠️ inline + 含义混乱
  tools: AgentTool[];
  maxTurns: number;
  temperature: number;
}

// 之后
interface AgentMember_v2 {
  kind: 'agent';
  role: string;
  systemPrompt: string;
  providerId: string;
  model: string;
  tools: AgentTool[];
  maxTurns: number;
  temperature: number;
}
```

- 去掉 `llm.baseURL` / `llm.apiKey` / `llm.model`
- 编辑器"大模型连接配置" 三字段 → 两个下拉（Provider / Model）
- apiKey 不再在成员编辑器出现，只在 Provider 管理页统一管理

### 3.4 CLI 成员

**无改动**。CLI 各自走自己的 `codex login` / `claude login`，不入 vault。

### 3.5 Prompt 模板

```ts
// 之前
'你是一个名叫"千问"的硅基生命体，你当前在一个叫"#groupName#" 的聊天群里'

// 之后（向前兼容两种语法）
'你是一个名叫"{{aiName}}"的硅基生命体，你当前在一个叫"{{groupName}}" 的聊天群里'
'#groupName#'   // 兼容别名，运行时替换为 {{groupName}}
```

可用占位符（编辑器顶端提示）：

| 占位符 | 含义 |
|---|---|
| `{{groupName}}` | 群名 |
| `{{aiName}}` | 该成员名 |
| `{{date}}` / `{{time}}` | 当前日期/时间 |
| `{{userName}}` | 用户昵称 |

模板替换函数集中到 `src/utils/prompt.ts`，统一应用于 `customPrompt` / `systemPrompt` / `stages[].prompt`。

### 3.6 取舍说明

- **Provider 独立表 vs 塞进 `ai_members`**：provider 是 N 个 member 共享的资源；当成一种 "kind" 强行塞，引用语义要靠 JSON 嵌套维护，更乱
- **Agent 不保留 inline fallback**：保留等于让脆弱启发式继续活着，违背 A-完整 初衷
- **`schedulerTag` 不直接删**：删了等于动 `clientScheduleAI` 行为；保留为可选，0 用户改动也能跑
- **模板换 `{{}}` 而非全留 `#%#`**：标准化便于扩展；不强制迁移，旧 prompt 不动也能跑

## 四、UX 改造（B-fork 及周边）

### 4.1 B-fork：builtin 严格只读

#### 库 UI（`AIMemberLibrary.tsx`）

| 当前 | 改后 |
|---|---|
| builtin 显示"编辑"按钮，保存即覆盖 | builtin 显示**"克隆并编辑"按钮**（Copy 图标）；点击 → 深拷贝、新 id `${origId}-copy-${ts}`、`source: 'user'`、name 后缀 " (副本)"、进编辑器 |
| builtin 不可删除 | 维持 |
| 自建成员"编辑"按钮 | 维持原行为 |
| 无"还原默认" | 不需要——builtin 永远 = 代码里 `builtinAIMembers`，零 drift |

#### Store 防御（`aiMemberStore.ts`）

```ts
upsert: async (member) => {
  const existing = get().members[member.id];
  // 任何已是 builtin 的实体禁止被改写——
  // 即便调用方把 source 改成 'user' 也拒绝（防"假装克隆"的不当迁移）
  if (existing?.source === 'builtin') {
    throw new Error('Cannot modify builtin member. Use clone() instead.');
  }
  // 进一步：禁止"新建一个 source: builtin 的实体"——builtin 只能由 seed 路径写入
  if (!existing && member.source === 'builtin') {
    throw new Error('Cannot upsert a builtin-source member from UI path.');
  }
  // ... 原逻辑
}

clone: async (id: string) => AIMember,   // 新增显式 API
```

Rust 端 `upsert_ai_member` 同样做 `source` 校验作为兜底（即使前端绕过，DB 层也防住）。

#### Builtin seed 升级

`request.ts:271` 当前是 `dbMembers.length === 0` 才 seed，加新 builtin 永远进不去。改成按 id 增量：

```ts
const existingIds = new Set(dbMembers.map(m => m.id));
const missing = builtinAIMembers.filter(b => !existingIds.has(b.id));
if (missing.length > 0) {
  await invoke('seed_builtin_ai_members', { members: missing.map(mapToRust) });
}
```

Provider 同等待遇。

### 4.2 测试连接（两级）

#### Provider 级 ping（最有用）

Provider 编辑器加按钮"测试连接"：

```rust
#[tauri::command]
async fn provider_test(provider_id: String) -> Result<ProviderTestResult>;
// 内部：取 baseURL + secret，发最小 chat completion ("hi" 1 token)
// 返回 { ok, latencyMs, modelEcho?, errorClass }
```

错误分类：

| 结果 | UI 显示 |
|---|---|
| ok | ✅ 200ms · deepseek-chat 可达 |
| auth | ❌ 密钥无效（HTTP 401） |
| network | ❌ 连接超时，检查 baseURL |
| 5xx | ⚠️ 服务端 502，稍后重试 |
| 4xx | ⚠️ 请求格式错误（HTTP {code}） |

#### 成员级 dry-run

LLM/Agent 成员编辑器底部加"试运行一句"按钮。Modal：

- 输入框预填"你好，做个自我介绍"
- 用当前编辑中（未保存）的表单值跑一次完整 `llm_chat_stream`
- 流式展示回复，末尾显示 "耗时 1.2s · 输入 102 tokens · 输出 56 tokens（估算）"

#### CLI 成员

复用 `/api/cli/check`：编辑器底部显示 "已检测到 codex v0.5.2 @ /usr/local/bin/codex" 或 "⚠️ 未在 PATH 中找到 `codex`"。

### 4.3 标签整顿

#### 系统标签集

`src/config/tagTaxonomy.ts`：

```ts
export const SYSTEM_TAGS = {
  用途: ['聊天', '信息总结', '新闻报道', '广告文案', '需求分析', '产品设计'],
  能力: ['编码', '调试', '重构', '深度推理', '数学', '分析数据', '系统设计'],
  风格: ['娱乐', '文字游戏', '学生', '协作'],
} as const;

export const TAG_SYNONYMS: Record<string, string> = {
  '对话': '聊天',
  '编程': '编码',
  '分析': '分析数据',
  // ...
};

export function normalizeTags(tags: string[]): string[];
```

#### 编辑器标签控件

```
[ 标签 ]
─── 推荐 ────────────────────────────────
用途：  [聊天] [信息总结] [新闻报道] ...
能力：  [编码] [调试] [深度推理] ...
风格：  [娱乐] [文字游戏] ...
─── 自定义 ─────────────────────────────
[ 输入自定义标签... ]
```

落 db 时**不区分 system/user**，全合并到 `tags: string[]`——结构不变，纯 UI 引导。

#### 一次性归一化

迁移脚本对 builtin + 现有 user 成员的 `tags` 做同义词合并 + 去重；只跑一次（绑 schema_version）。

### 4.4 MemberPicker 信息密度

```
[头像] 千问            ⚙ qwen-plus               [聊天][信息总结]
       通义千问大模型助手   provider: qwen ✓
```

| Kind | 元信息 |
|---|---|
| LLM | `model` + `provider`；provider 无 key 时 badge 变灰 + ⚠️ |
| Agent | `provider · model` + `🛠 ${enabledTools} tools` |
| CLI | `adapter` + 检测状态（✓ 已安装 / ⚠️ 未找到）|

实现：扩展现有 `optionRender`，多加一行 meta。

### 4.5 头像选择器

现状只有 `<Input placeholder="头像链接..." />`。改成三种来源（Popover/Tabs 切换）：

1. **内置图库**：网格列出 `public/img/*.{png,jpg,jpeg,webp,svg,gif}`（构建时静态枚举），点选填入路径
2. **上传本地图**：Tauri 调 `rfd::FileDialog`（已在依赖）→ Rust 复制到 `${app_data}/avatars/${uuid}.{ext}` → 注册 `avatar://` custom protocol 直接给前端 `<img src>` 用
3. **填 URL**：保留作为高级选项

Rust 端：注册 `avatar://` custom protocol；不再需要 `avatar_resolve` IPC。

### 4.6 编辑器其它小修

| 项 | 改动 |
|---|---|
| LLM "模型" 字段 | 拆成两段：先选 Provider → 再选 Model（联动） |
| LLM "性格设定/角色标识" | 改名"调度标签"，加 tooltip："仅供消息调度分类，可留空"；折叠到"高级" |
| Agent "API 地址 / 模型 / 密钥" 三件套 | 全删，换成"Provider 下拉 + Model 下拉" |
| 所有 prompt 字段顶端 | 加 `可用占位符：{{groupName}} {{aiName}} {{date}}` 一行小灰字提示 |
| Provider 编辑器（新页面） | name / baseURL / models[] / "测试连接" 按钮 / "管理密钥" 按钮 |

## 五、迁移、分阶段交付、风险

### 5.1 Schema migrations（按版本递增）

| 版本 | 内容 |
|---|---|
| 当前 | `ai_members` 已在 |
| +1 | 加 `secrets` 表；bootstrap `master.key` |
| +2 | 加 `providers` 表；增量 seed builtin providers |
| +3 | 跑一次性数据迁移（5.2）；写 marker `migration:ai_member_a_complete` 防重 |

### 5.2 一次性数据迁移

#### 分工与原子性

数据迁移**跨 renderer 边界**（localStorage 在 renderer、db 在 Rust），所以"单事务"只针对 DB 部分。完整流程分四步、由前端在 `/api/init` 路径上编排，类似当前迁移 custom_groups 的位置：

1. **前端收集** localStorage 中所有 `API_KEY_*`，连同其值 + ai_members 列表打包送给 Rust
2. **Rust 单 IPC `migrate_a_complete`** 内部开 SQLite 事务：
   - vault 写入所有 secrets
   - 改写 `ai_members.config`
   - tags 归一化
   - bump `schema_version`
   - 失败 → 整体回滚
3. Rust 返回成功状态后，**前端再清 localStorage**（删除 `API_KEY_*` 一组键）
4. 任何一步失败 → 前端保留 localStorage、Rust 回滚到迁移前 db 备份

#### Rust 端事务伪代码

```text
fn migrate_a_complete(input: MigrationInput) -> Result<()> {
  backup_db_to(`${app_data}/backups/pre-migration-${ts}.db`)
  backup_keys_to(`${app_data}/backups/keys-pre-migration.json`)     // 0600

  let tx = db.transaction()

  -- (a) localStorage -> vault
  for { raw_name, value } in input.local_storage_keys:
    normalized = canonicalize(raw_name)               // QWEN_API_KEY -> qwen
    vault.set(tx, `provider:${normalized}`, value)

  -- (b) ai_members.config 改造（去重共享 provider）
  let shared_user_providers: HashMap<(baseURL, apiKey), provider_id> = {}

  for m in tx.all_ai_members():
    if m.kind == 'llm':
      m.config.providerId  = lookupProviderByModel(m.config.model)
      m.config.schedulerTag = m.config.personality
      delete m.config.personality

    if m.kind == 'agent':
      if looks_like_real_key(m.config.llm.apiKey):
        // 同 baseURL+key 的多个 Agent 共享同一 user provider
        key = (m.config.llm.baseURL, m.config.llm.apiKey)
        providerId = shared_user_providers.entry(key).or_insert_with(|| {
          let pid = `user-${m.id}`
          vault.set(tx, `provider:${pid}`, m.config.llm.apiKey)
          tx.upsert_provider(Provider {
            id: pid,
            name: `自定义 (${m.config.llm.baseURL})`,
            baseURL: m.config.llm.baseURL,
            apiKeyRef: `provider:${pid}`,
            models: [m.config.llm.model],
            source: 'user',
          })
          pid
        })
        // 同一 provider 已存在但 model 不在列表里，追加
        tx.append_model_if_missing(providerId, m.config.llm.model)
      else:
        providerId = lookupProviderByEnvName(m.config.llm.apiKey)

      m.config.providerId = providerId
      m.config.model = m.config.llm.model
      delete m.config.llm

  -- (c) tags 归一化
  for m in tx.all_ai_members():
    m.tags = normalizeTags(m.tags)

  tx.set_schema_version(+3)
  tx.commit()
  Ok(())
}
```

#### 兜底文件

- `${app_data}/backups/pre-migration-${ts}.db` —— 整库快照，失败时手工恢复入口
- `${app_data}/backups/keys-pre-migration.json` （0600） —— 真 key 的 sanitized 副本，应对 `looks_like_real_key` 误判；30 天后由启动检查自动清理

#### 启发式：`looks_like_real_key`

保守判断，**宁可误判为 env 名**（误判进 vault 比误判进真 key 库要好——`lookupProviderByEnvName` 找不到时会留 placeholder，用户可在 Provider 管理页修正）：

```
是真 key ⇔
  value 不全为 [A-Z0-9_]（env 名通常全大写下划线）
  AND value.length > 20
  AND NOT value.starts_with('API_KEY_')
```

#### 查找表来源

- `lookupProviderByModel(model)`：通过 PR3 seed 的 builtin providers 表反查 `model ∈ provider.models` 的 provider；命中多个时取 builtin 中 `id` 字母序最小
- `lookupProviderByEnvName(envName)`：通过 builtin provider 的 `apiKeyRef` 反查 `provider:${envName.toLowerCase().replace(/_api_key$/, '')}`；未命中时**不抛错**，写入 placeholder providerId `unmapped-${envName}` 并打 warn，等待用户在 Provider 管理页绑定

### 5.3 分阶段交付（5 个 PR）

| PR | 内容 | 风险 |
|---|---|---|
| **PR1** | Secrets vault 基础：`vault.rs` + `secrets` 表 + 4 个 IPC + `master.key` bootstrap | 低（纯增量，无 UI） |
| **PR2** | LLM/Agent proxy 移到 Rust：`llm_proxy.rs` + `llm_chat_stream`。**过渡期 IPC 接受双形态参数**：`{baseURL, apiKey, model}`（兼容老路径，apiKey 由前端从 localStorage 取并明文传入 IPC）或 `{providerId, model}`（PR4 之后才用）。前端 `/api/chat` `/api/agent/chat` 走 invoke。**此阶段安全性等价于现状**，只换执行位置，为后续 vault wiring 铺路 | 中（动热路径，需 SSE 测试） |
| **PR3** | Providers 表 + Provider 管理 UI + 测试连接 + builtin providers seed | 中（新 UI 面） |
| **PR4** | 一次性数据迁移 + 成员模型清理（providerId/model/schedulerTag）+ vault wiring；删 localStorage `API_KEY_*` 路径；apiKey 字段下线 | **高**（迁移失败 = 用户数据受损） |
| **PR5** | UX bundle：B-fork 克隆按钮、防御性 upsert、增量 builtin seed、标签整顿、Picker 元信息、头像选择器、dry-run modal、占位符提示 | 低-中（纯 UI，可 feature flag） |

顺序约束：**PR4 必须在 PR1 + PR2 + PR3 都合并并稳定后再上**。PR5 可与 PR3/PR4 并行，但功能上锁定 PR4 后的数据形态。

### 5.4 风险与缓解

| 风险 | 缓解 |
|---|---|
| `master.key` 损坏/丢失 | 启动 self-check：能解密任一 vault 条目证明 key 有效；失败时进入诊断模式，**不静默清空** |
| 迁移半成功 | 单事务 + db 备份；失败回滚到备份并提示用户 |
| 流式协议偏差（豆包/百度/Ollama 字段差异） | Rust 端 OpenAI client 留 `provider.quirks` 字段挂适配；兼容范围对齐现状 |
| 并发改 vault | SQLite WAL（如未开则启用），`secrets` 表 PK 防冲突，`master.key` `fs2` lock |
| 用户清除应用数据后所有 key 灰飞烟灭 | 文档明确说明；v2 加密码包裹 + 导出 |
| `looks_like_real_key` 误判 | 详细决策日志；用户可在 Provider 管理页手工修正；`keys-pre-migration.json` 兜底 |
| 迁移后存在"未映射 provider"（`unmapped-*` placeholder） | MemberPicker / 成员卡片用红色 badge 显示 "⚠️ 未绑定 Provider"；编辑器打开时强制下拉重新选 Provider；启动时若检测到任何 `unmapped-*` 引用，状态栏弹一次性提示"X 个成员需要绑定 Provider"，点击跳到 Provider 管理页 |
| 旧版前端打开新版 db | 旧版检测到 `schema_version > 自身最高识别` 时拒写、只读 + 提示升级 |

### 5.5 测试策略

| 层 | 内容 |
|---|---|
| Rust 单测 | `vault::roundtrip` / `vault::aad_mismatch_fails` / `master_key_perms` / `secret_list_no_value_leak` / `tag_normalize` |
| Rust 集成 | mock OpenAI server 验证 streaming、错误码分类、provider quirks |
| Frontend 单测 (vitest/mjs) | `mapFromRust`/`mapToRust` 新字段、prompt 模板替换、clone 行为、防御性 upsert 抛错 |
| Frontend 集成（mock invoke） | 库 UI 克隆流、编辑器 provider/model 联动、Picker 元信息 |
| E2E 主流 | (a) 新建 user LLM + Provider，加群发消息能跑；(b) 克隆 builtin 改 prompt 生效；(c) Provider 被引用不能删；(d) 一次性迁移走完后旧数据可读；(e) 干净安装 + 老数据库两种路径分别走 |

### 5.6 文件结构变动汇总

```
src/config/
  aiMembers.ts                    改：LLM/Agent 用 providerId+model；schedulerTag
  providers.ts                    新：Provider 类型 + builtinProviders seed
  tagTaxonomy.ts                  新：SYSTEM_TAGS + 同义词归一化
src/store/
  aiMemberStore.ts                改：upsert 防御 + clone API
  providerStore.ts                新
src/utils/
  prompt.ts                       新：{{groupName}} 等模板替换
  llmClient.ts                    新：封装 invoke('llm_chat_stream') + SSE
  request.ts                      改：/api/chat /api/agent/chat 走 llmClient；删 getLocalApiKey
src/pages/chat/components/
  AIMemberLibrary.tsx             改：克隆按钮 + Provider Tab 入口
  AIMemberEditor.tsx              改：provider/model 联动 / 占位符提示 / 标签引导 / 头像 / dry-run
  MemberPicker.tsx                改：kind 元信息 + 可用性指示
  ProviderLibrary.tsx             新：Provider 列表 + 编辑 + 测试连接
  ProviderEditor.tsx              新
  AvatarPicker.tsx                新
  DryRunModal.tsx                 新
src-tauri/src/
  db.rs                           改：secrets + providers 表 + 增量 seed + 一次性迁移
  vault.rs                        新：master key + AES-GCM + IPC
  llm_proxy.rs                    新：reqwest + SSE 转发 + provider quirks
  lib.rs                          改：注册新 IPC + 注册 avatar:// custom protocol
src-tauri/Cargo.toml              +aes-gcm, +rand_core, +reqwest{stream,json}, +fs2
```

## 六、明确不在本次范围（防 scope creep）

- ❌ master key 用户密码包裹 / 多用户 vault（v2）
- ❌ secret 导入导出 / vault 备份恢复 UI（v2）
- ❌ 成员级私有 secret（schema 留口子，v2 用）
- ❌ 使用统计 / 成本跟踪
- ❌ "允许覆盖 builtin / 还原默认" UI（B-fork 已排除）
- ❌ 跨 kind 混合群、@提及联想
- ❌ Provider marketplace / 一键导入云端预设

## 七、关键设计权衡（汇总）

| 权衡 | 决策 | 理由 |
|---|---|---|
| Secrets 存储后端 | S3：SQLite + AES-GCM + 本地 master.key | Linux OS keyring 不稳；纯 Rust 可测可控；不引入用户密码流 |
| 是否提供 `secret_get` | 否 | 提供即等价于 localStorage 加 obfuscation；要做就做透 |
| LLM proxy 是否挪到 Rust | 是 | A-完整 真正成立的唯一路径，否则秘钥仍在 renderer |
| Provider 独立表 vs JSON 嵌套 | 独立表 | provider 是共享资源，N:1 引用语义独立表更清晰 |
| Agent inline LLM 配置是否保留 | 不保留 | 保留 = 启发式判断继续活着，违背初衷 |
| `personality` 处理 | 改名 `schedulerTag` + 标注弱化用途 | 删除会动 `clientScheduleAI` 行为；改名零运行成本 |
| Prompt 模板语法 | 新增 `{{}}`，兼容旧 `#%#` | 标准化扩展性更好；不强制迁移 |
| builtin 编辑语义 | B-fork：严格只读 + 克隆 | 升级零冲突；导入导出友好；UI 心智干净 |
| Builtin seed 时机 | 增量按 id（非"空库才 seed"） | 修复"新 builtin 进不去" |
| 一次性迁移是否单事务 | 是，外加备份 | 失败可回滚；半成功最难处理 |
