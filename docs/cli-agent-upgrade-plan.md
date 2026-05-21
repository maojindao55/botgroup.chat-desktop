# CLI Agent 升级落地方案

## 背景

当前桌面端已经具备把本地 Coding CLI 当作群聊成员调用的基础能力：

- 前端配置了 CLI 群、CLI Agent 和执行策略类型。
- `request.ts` 将 `/api/cli/run` 转成 Tauri IPC，并把 Tauri event 包装为 SSE 风格流。
- Rust 侧 `cli.rs` 可以启动 `codex / claude / opencode / aider / gemini / generic`，并支持输出流、安装检测、取消进程。
- `cliEngine.ts` 已实现 `sequential / router / race / pipeline` 策略，但主聊天 UI 还没有接入。

Multica 的主要启发不是“多支持几个 CLI”，而是把 Agent 执行从一次聊天请求升级为有状态的本地任务系统：runtime 可观测、任务可追踪、失败可重试、Agent 配置可沉淀、技能可复用。

本方案按“最少系统复杂度、最大产品增益”拆成四个阶段，保持本地优先，不引入云端 server。

## 目标

1. CLI 群的执行策略真实生效，而不是只停留在设置面板。
2. 每次 CLI 执行都有本地任务记录，支持状态、日志、重试、取消、历史查看。
3. 用户能清楚看到本机可用的 CLI runtime、版本、路径、最近运行状态和登录问题。
4. CLI Agent 从硬编码角色升级为可编辑 Profile，支持自定义参数、环境变量、并发和技能包。
5. 保持数据本地化：SQLite 保存配置和任务元数据，大段日志可写文件，避免前端状态丢失。

## 非目标

- 不做完整项目管理系统，不引入 issue/project/workspace 多租户。
- 不做云端 daemon 或远程 runtime。
- 不复制 Multica 的 OAuth、WebSocket hub、PostgreSQL 架构。
- 不在第一阶段实现跨 App 重启后的后台继续执行。桌面 App 退出时仍终止子进程。

## 当前代码落点

| 模块 | 现状 | 升级方向 |
| --- | --- | --- |
| `src/pages/chat/components/ChatUI.tsx` | CLI 群发送消息时逐个调用 `/api/cli/run` | 改为调用 `executeCLIStrategy`，统一策略执行和消息更新 |
| `src/engine/cliEngine.ts` | 已有四种策略，但未接入 UI | 增加 task 创建、状态更新、取消、超时参数 |
| `src/utils/request.ts` | 包装 `/api/cli/run` 和 `/api/cli/check` | 增加 `/api/cli/tasks/*`、runtime 列表、任务日志读取 |
| `src-tauri/src/cli.rs` | spawn CLI、流式输出、kill、check | 增加任务状态持久化、日志落盘、超时、并发限制 |
| `src-tauri/src/db.rs` | 初始化本地 SQLite | 增加 CLI runtime、agent profile、task、skill 表 |
| `src/pages/chat/components/CLIGroupSettings.tsx` | workspace、策略、安装状态设置 | 扩展 runtime 健康、Agent Profile、任务历史入口 |

## 阶段 1：让 CLI 策略真实生效

### 交付

- CLI 群发送消息走 `executeCLIStrategy`。
- 设置中的 `strategy / timeout / approvalMode / showStderr` 进入执行链路。
- `race` 模式并行输出时，UI 能按 Agent 独立消息气泡流式更新。
- `pipeline` 模式明确显示阶段标签：生成、审查、测试、优化。

### 实施要点

1. 在 `ChatUI.tsx` 中拆出 CLI 群专用发送逻辑：
   - AI 群保留现有 `/api/chat` 调用。
   - CLI 群过滤 muted members 后，调用 `executeCLIStrategy(group, agents, prompt, workspacePath, callbacks)`。

2. 用 callback 驱动消息 UI：
   - `onAgentStart` 创建该 Agent 的空消息气泡。
   - `onToken` 追加 token。
   - `onAgentEnd` 折叠 `<details open>` 为 `<details>`。
   - `onError` 标记错误消息。

3. `executeCLIStrategy` 增加运行参数：

```ts
export interface CLIRunOptions {
  timeoutMs: number;
  approvalMode: 'auto' | 'ask';
  showStderr: boolean;
}
```

4. `race` 第一版先展示全部结果，不自动选最优。后续可增加 LLM 裁判或用户选择。

### 验收

- 切换四种策略后，同一条消息的执行顺序和并发行为符合策略描述。
- 禁言的 CLI Agent 不参与执行。
- `timeout` 设置不是 UI 假字段。
- CLI 群不再绕过 `src/engine/cliEngine.ts`。

## 阶段 2：本地 Task 状态机和执行历史

### 交付

- 每次 CLI Agent 执行都产生一条 task 记录。
- 支持任务状态：`queued / running / completed / failed / cancelled / timeout`。
- 每个 task 保存 sessionId、agent、adapter、cwd、prompt 摘要、开始/结束时间、exitCode、错误信息、日志路径。
- 聊天消息可关联 task，用户能打开历史、查看输出、重试失败任务、取消运行中任务。

### SQLite 表设计

```sql
CREATE TABLE IF NOT EXISTS cli_tasks (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  adapter TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'completed', 'failed', 'cancelled', 'timeout')),
  cwd TEXT,
  prompt TEXT NOT NULL,
  prompt_summary TEXT,
  session_id TEXT,
  pid INTEGER,
  exit_code INTEGER,
  error_message TEXT,
  log_path TEXT,
  started_at TIMESTAMP,
  ended_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cli_tasks_group_created ON cli_tasks(group_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cli_tasks_status ON cli_tasks(status);
CREATE INDEX IF NOT EXISTS idx_cli_tasks_agent ON cli_tasks(agent_id, created_at DESC);
```

可选扩展：

```sql
CREATE TABLE IF NOT EXISTS cli_task_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  content TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (task_id) REFERENCES cli_tasks(id)
);
```

第一版建议不把所有 token 写 SQLite，避免频繁写库。大段输出写到日志文件：

```text
app_data_dir/
  cli-logs/
    {task_id}.jsonl
```

每行结构：

```json
{"ts":"2026-05-21T10:00:00Z","type":"stdout","content":"..."}
```

### Tauri IPC

新增命令：

```rust
cli_task_create(args) -> CliTask
cli_task_update_status(args) -> CliTask
cli_task_list(group_id, limit, before) -> Vec<CliTask>
cli_task_get(task_id) -> CliTask
cli_task_read_log(task_id, since_line) -> CliTaskLogPage
cli_task_retry(task_id) -> CliTask
cli_task_cancel(task_id) -> bool
```

实际执行可以先由 `cli_run` 内部自动创建 task，前端只传 `groupId / agentId / agentName`。这样前端不会出现“任务创建成功但进程没启动”的双写不一致。

### 状态流转

```text
queued -> running -> completed
queued -> running -> failed
queued -> running -> timeout
queued -> running -> cancelled
```

失败分类：

- `spawn_failed`：二进制不存在、权限不足、cwd 不存在。
- `auth_error`：登录过期、token 无效。
- `agent_error`：CLI 非 0 退出。
- `timeout`：超过用户配置超时。
- `cancelled`：用户主动取消。

### UI

- 聊天气泡底部显示状态：执行中、成功、失败、已取消、超时。
- 失败气泡提供“重试”按钮。
- 运行中气泡提供“停止”按钮。
- CLI 设置面板增加“执行历史”区块，按时间列出最近 50 条。

### 验收

- App 页面刷新后，最近任务历史仍可查看。
- 失败任务可重试，重试产生新 task，不覆盖旧记录。
- 取消运行中任务后，子进程退出，task 状态为 `cancelled`。
- 日志文件存在，能从 UI 打开查看。

## 阶段 3：Runtime 健康面板

### 交付

- 展示本机所有支持的 CLI runtime。
- 每个 runtime 显示：provider、installed、path、version、lastCheckAt、lastRunAt、lastError。
- 对 Codex/Claude 等常见登录失效提供可操作提示。
- 支持手动刷新 runtime 状态。

### 表设计

```sql
CREATE TABLE IF NOT EXISTS cli_runtimes (
  adapter TEXT PRIMARY KEY,
  installed INTEGER NOT NULL DEFAULT 0,
  binary_path TEXT,
  version TEXT,
  last_check_at TIMESTAMP,
  last_run_at TIMESTAMP,
  last_error TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 实施要点

1. 复用现有 `cli_check(adapter)`，批量检测所有已知 adapter。
2. 启动 App 时异步刷新一次，不阻塞聊天初始化。
3. 每次 task 完成后更新 `last_run_at / last_error`。
4. Settings 中把安装状态从成员卡片扩展为 Runtime 表格。

### 支持矩阵

| Adapter | 默认命令 | 当前支持 | 建议补齐 |
| --- | --- | --- | --- |
| codex | `codex exec` | 已支持 JSON 解析 | session id 提取、语义超时 |
| claude | `claude -p` | 已支持 | 加 `--output-format stream-json` 后结构化解析 |
| opencode | `opencode run` | 已支持 | session resume 能力检测 |
| aider | `aider --message` | 已支持 | 输出清洗 |
| gemini | `gemini -p` | 已支持 | 登录错误识别 |
| cursor-agent | `cursor-agent` | 未支持 | 新增 adapter |
| copilot | `copilot` | 未支持 | 新增 adapter |
| kimi | `kimi` | 未支持 | 新增 adapter |

### 验收

- 未安装 CLI 时，设置面板能明确提示缺失命令。
- 登录过期时，气泡和 runtime 面板都能展示统一错误。
- 用户点击刷新后能看到最新版本和路径。

## 阶段 4：Agent Profile 和 Skill Pack

### 交付

- CLI Agent 不再只能来自硬编码数组，用户可创建、编辑、禁用本地 Agent Profile。
- 每个 Agent 可配置 provider、display name、avatar、tags、custom args、custom env、默认 cwd、并发限制。
- 支持给 Agent 绑定本地 Skill Pack。

### 表设计

```sql
CREATE TABLE IF NOT EXISTS cli_agent_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  adapter TEXT NOT NULL,
  avatar TEXT,
  tags TEXT,
  binary TEXT,
  extra_args TEXT,
  env TEXT,
  default_cwd TEXT,
  approval_mode TEXT DEFAULT 'auto',
  show_stderr INTEGER DEFAULT 1,
  max_concurrent_tasks INTEGER DEFAULT 1,
  enabled INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cli_skill_packs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  root_path TEXT NOT NULL,
  entry_file TEXT DEFAULT 'SKILL.md',
  enabled INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cli_agent_skill_packs (
  agent_id TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  PRIMARY KEY (agent_id, skill_id),
  FOREIGN KEY (agent_id) REFERENCES cli_agent_profiles(id),
  FOREIGN KEY (skill_id) REFERENCES cli_skill_packs(id)
);
```

JSON 字段约定：

- `tags`: `["编码","重构","调试"]`
- `extra_args`: `["--json","--sandbox","workspace-write"]`
- `env`: `{"FOO":"bar"}`

### Skill Pack 注入方式

第一版采用 prompt 注入，不改 workspace 文件：

```text
[可用技能]
技能：前端审查
路径：/path/to/skill
说明：
{SKILL.md 前 4000 字}

[用户任务]
...
```

第二版可支持“复制技能文件到临时目录”或“生成任务临时 AGENTS.md”，但需要更严格的清理策略。

### 安全规则

- 默认禁止覆盖系统关键环境变量：`PATH / HOME / USER / SHELL / TERM / CODEX_HOME`。
- env 值在 UI 中默认掩码显示。
- 自定义 binary 必须是绝对路径，或明确标注来自 PATH。
- `approvalMode=ask` 第一版可以先做“执行前确认弹窗”，不做逐命令审批。

### 验收

- 用户可创建一个新的 `generic` Agent 并成功运行。
- 用户可给 Codex Agent 增加自定义参数并在下一次执行生效。
- Skill Pack 被注入 prompt，Agent 输出能感知技能说明。
- 禁用 Agent 后不会出现在可选 CLI 群成员中。

## 推荐实施顺序

1. **第 1 周：策略接入**
   - 改 `ChatUI.tsx` 使用 `executeCLIStrategy`。
   - 补 callback 驱动的多 Agent 消息更新。
   - 修通四种策略。

2. **第 2 周：Task 表和日志**
   - 增加 `cli_tasks` 表。
   - `cli_run` 创建和更新 task。
   - 输出写 `cli-logs/{task_id}.jsonl`。
   - 增加 task list/get/read_log/cancel/retry IPC。

3. **第 3 周：执行历史 UI**
   - Settings 增加历史列表。
   - 聊天气泡增加状态、停止、重试。
   - 处理 timeout 和 auth error 分类。

4. **第 4 周：Runtime 面板**
   - 增加 `cli_runtimes` 表。
   - 批量检测 provider。
   - 展示 path/version/lastError。

5. **第 5 周：Agent Profile**
   - 增加 profile CRUD。
   - 默认 profile 从当前 `cliAgents` 迁移生成。
   - CLI 群成员读取 profile，而不是硬编码数组。

6. **第 6 周：Skill Pack**
   - 增加 skill CRUD 和绑定关系。
   - prompt 注入。
   - 增加基础 UI。

## 风险和处理

| 风险 | 影响 | 处理 |
| --- | --- | --- |
| 并行 `race` 同时改同一 workspace | 代码冲突、结果互相覆盖 | 第一版标注风险，默认不推荐自动写模式；后续为 race 使用隔离 worktree |
| 大量流式输出写 SQLite 影响性能 | UI 卡顿、DB 膨胀 | 大段日志写 jsonl 文件，SQLite 只存元数据 |
| CLI 输出格式差异大 | 解析不稳定 | 每个 adapter 单独 parser，未识别时按纯文本展示 |
| 登录错误识别不全 | 用户不知道如何恢复 | 建立 adapter-specific error patterns，并持续补充 |
| 自定义 env 泄露 | 安全风险 | UI 掩码、禁止关键变量、文档提示只放低权限密钥 |
| App 退出导致任务中断 | 长任务丢失 | 第一版明确限制；后续再做后台 daemon 或重启恢复 |

## 第一批开发任务清单

- [ ] 在 `ChatUI.tsx` 中拆出 `handleSendCLIMessage`。
- [ ] 将 CLI 群发送逻辑改为调用 `executeCLIStrategy`。
- [ ] 给 `cliEngine.ts` 增加 `CLIRunOptions`。
- [ ] 修复 `CLIGroupSettings` 中 `timeout / approvalMode / showStderr` 未传递到执行的问题。
- [ ] 增加 `cli_tasks` 表和索引。
- [ ] 扩展 `CliRunArgs`：`group_id / agent_id / agent_name / timeout_ms / show_stderr`。
- [ ] `cli_run` 内创建 task、更新 pid/status、完成时写 exit_code。
- [ ] 输出写入 `cli-logs/{task_id}.jsonl`。
- [ ] 增加 `cli_task_list / cli_task_get / cli_task_read_log / cli_task_retry` IPC。
- [ ] 设置面板增加最近任务列表。
- [ ] 聊天气泡增加停止和重试入口。

## 里程碑验收场景

1. 用户选择一个 workspace，切换 CLI 策略为 `pipeline`，发送“修复登录页样式问题”。三个 CLI Agent 按阶段执行，UI 分别显示输出。
2. Codex 登录过期时，任务状态变为 `failed`，错误分类为 `auth_error`，UI 提示 `codex login`。
3. 用户刷新页面后，仍能在 CLI 设置面板看到刚才失败的任务和日志。
4. 用户点击“重试”，系统创建新 task，并保留旧 task 历史。
5. 用户启动一个长任务后点击“停止”，Rust 子进程被 kill，任务状态为 `cancelled`。
6. 用户创建一个 generic Agent，指定 binary 和参数，加入 CLI 群后可被 router 策略选中。

## 后续增强

- 为每次任务自动创建隔离 git worktree，避免多个 Agent 同时改同一目录。
- 为 `race` 增加“最快完成”和“裁判评选”两种结果模式。
- 从 CLI 输出中提取 Codex/Claude session id，支持恢复执行。
- 增加任务导出：Markdown 报告、patch 摘要、测试结果摘要。
- 增加 Autopilot：按时间或文件变更触发本地 Agent 任务。
