# CLI 执行策略重构落地方案

## 背景

当前 CLI 群已经具备 `sequential / router / race / pipeline` 四种策略，任务状态、日志、runtime 健康面板也已经开始落地。但策略边界仍然不够清晰：

- `sequential` 和 `race` 都像是“多个 Agent 执行同一个任务”，只差串行/并行。
- `pipeline` 失败后是否继续执行没有配置口径，用户容易误解“为什么第二个失败没有触发第三个”。
- `race` 在同一个 workspace 并行执行有覆盖和冲突风险，更适合默认使用隔离 worktree。
- 需要新增“讨论模式”，但它不应该和可写执行模式混在一起。
- 当前 `strategy` 一个字段同时承载了选择 Agent、协作关系、调度方式、隔离方式和失败策略，后续继续加模式会越来越难维护。

本方案目标是把“模式名称”重构成可组合的执行计划 `CLIExecutionPlan`，再用预设模式兼容现有 UI。这样既保留用户能理解的模式按钮，也让内部实现有清晰边界。

## 目标

1. 明确 CLI 群各执行模式的产品语义和工程边界。
2. 新增 `discussion` 讨论模式，默认只读，不直接修改 workspace。
3. 将 `race` 改造为默认隔离执行，优先使用 git worktree。
4. 将 `pipeline` 的失败行为显式配置化，默认失败继续还是中断由策略字段决定。
5. 把 `cliEngine.ts` 从按模式硬编码分支，重构为“选择 Agent -> 准备环境 -> 构造提示 -> 调度执行 -> 汇总结果”的 pipeline。
6. 保持现有 `CLIStrategy` 配置向后兼容，旧群配置无需迁移即可继续运行。

## 非目标

- 不在本次实现自动合并 worktree 代码。
- 不做 LLM 裁判自动选最优结果，只保留结果对比和后续扩展点。
- 不引入后台 daemon，不解决 App 退出后任务继续执行。
- 不重构普通 AI 群和 Agent 群，只处理 CLI 群。
- 不把所有历史输出写入 SQLite，日志仍走现有 jsonl 文件。

## 模式边界

| 模式 | 核心语义 | 调度 | 默认隔离 | 上下文传递 | 失败处理 | 典型场景 |
| --- | --- | --- | --- | --- | --- | --- |
| `router` | 先选最合适 Agent，再执行 | 单个或少数 Agent | same workspace | 原始用户需求 | 选中 Agent 失败即结束 | 快速分派给最擅长的 CLI |
| `sequential` | 多个 Agent 独立处理同一任务，按顺序节流 | 串行 | same workspace | 默认只给原始需求 | 默认继续 | 省资源、避免并发抢占、做多工具对比 |
| `pipeline` | 多阶段接力，后者基于前者输出继续 | 串行 | same workspace | 原始需求 + 上一阶段输出 | 可配置 | 生成 -> 审查 -> 测试 -> 修正 |
| `race` | 多个 Agent 并行竞争同一任务 | 并行 | worktree per agent | 原始用户需求 | 互不影响 | 对比多个 CLI 的解决方案 |
| `discussion` | 多 Agent 只读讨论方案和风险 | 分轮并行 | read-only same workspace | 讨论 transcript | 默认继续 | 需求澄清、方案评审、执行前讨论 |

关键区别：

- `sequential` 不是“流水线”。它的默认语义是多个 Agent 对同一任务分别执行，只是为了资源和安全选择串行调度。
- `pipeline` 才是接力模式，后续 Agent 必须看到上一阶段产出。
- `race` 是并行竞争，默认不应该共享同一个可写目录。
- `discussion` 是协作分析，不是代码执行，默认禁止写入。

## 新执行计划模型

新增内部类型，不要求第一版持久化所有字段，但执行入口必须基于这个结构运行。

```ts
export type CLISelectionMode = 'all' | 'router' | 'manual';
export type CLICollaborationMode = 'independent' | 'pipeline' | 'discussion';
export type CLIScheduleMode = 'sequential' | 'parallel' | 'staged';
export type CLIIsolationMode = 'sameWorkspace' | 'readOnly' | 'worktreePerAgent' | 'copyPerAgent';
export type CLIFailurePolicy = 'continue' | 'stopOnFailure' | 'stopOnCancelled';

export interface CLIExecutionPlan {
  preset: CLIStrategy;
  selection: CLISelectionMode;
  collaboration: CLICollaborationMode;
  schedule: CLIScheduleMode;
  isolation: CLIIsolationMode;
  failurePolicy: CLIFailurePolicy;
  maxRounds?: number;
  resultPolicy?: 'all' | 'firstSuccess' | 'fastest' | 'manualPick';
}
```

预设映射：

| `CLIStrategy` | `CLIExecutionPlan` |
| --- | --- |
| `router` | `selection: router`, `collaboration: independent`, `schedule: sequential`, `isolation: sameWorkspace`, `failurePolicy: stopOnFailure` |
| `sequential` | `selection: all`, `collaboration: independent`, `schedule: sequential`, `isolation: sameWorkspace`, `failurePolicy: continue` |
| `pipeline` | `selection: all`, `collaboration: pipeline`, `schedule: sequential`, `isolation: sameWorkspace`, `failurePolicy: continue` |
| `race` | `selection: all`, `collaboration: independent`, `schedule: parallel`, `isolation: worktreePerAgent`, `failurePolicy: continue`, `resultPolicy: all` |
| `discussion` | `selection: all`, `collaboration: discussion`, `schedule: staged`, `isolation: readOnly`, `failurePolicy: continue`, `maxRounds: 2` |

说明：

- `pipeline` 第一版建议默认 `continue`，因为用户期望“第二个失败第三个仍然可以诊断失败原因”。后续 UI 可提供“失败即停止”开关。
- `cancelled` 应总是停止后续阶段，避免用户点停止后继续启动新 Agent。
- `race` 如果 worktree 创建失败，应提示用户并降级为 `sameWorkspace` 需要二次确认；不要静默降级。

## 代码落点

| 文件 | 需要修改 |
| --- | --- |
| `src/config/groups.ts` | `CLIStrategy` 增加 `discussion`，`CLIGroup` 增加可选执行配置字段 |
| `src/engine/cliEngine.ts` | 拆分策略引擎，新增 `CLIExecutionPlan`、worktree 准备、discussion 执行 |
| `src/pages/chat/components/CLIGroupSettings.tsx` | 策略按钮增加讨论模式，补充模式描述和可选高级配置 |
| `src/pages/chat/components/CreateGroupWizard.tsx` | CLI 群创建时支持选择新策略 |
| `src/pages/chat/components/ChatUI.tsx` | 处理 discussion/race 的状态展示和取消语义 |
| `src/utils/request.ts` | 如需新增 worktree IPC，增加 `/api/cli/worktree/*` 包装 |
| `src-tauri/src/cli.rs` | 新增 worktree 创建/清理 IPC，必要时支持 read-only 执行参数 |
| `src-tauri/src/lib.rs` | 注册新增 IPC |

## 引擎拆分设计

将 `executeCLIStrategy` 拆成以下内部步骤：

```ts
export async function executeCLIStrategy(
  group: CLIGroup,
  agents: CLIAgent[],
  prompt: string,
  cwd: string,
  callbacks: CLIStreamCallback,
  options?: CLIRunOptions,
): Promise<CLIRunResult[]> {
  const plan = resolveExecutionPlan(group, options);
  const selectedAgents = selectAgents(plan, agents, prompt, group);
  const contexts = await prepareExecutionContexts(plan, selectedAgents, cwd);

  try {
    return await runSchedule(plan, selectedAgents, contexts, prompt, options, callbacks);
  } finally {
    await finalizeExecutionContexts(plan, contexts);
  }
}
```

建议拆分函数：

- `resolveExecutionPlan(group, options)`：把旧 `group.strategy` 映射为内部计划。
- `selectAgents(plan, agents, prompt, group)`：处理 router 和 muted 后的 Agent 选择。
- `prepareExecutionContexts(plan, agents, cwd)`：为每个 Agent 准备 cwd、隔离信息、只读提示。
- `buildPromptForAgent(plan, input)`：根据协作模式构造提示词。
- `runSchedule(plan, agents, contexts, prompt, options, callbacks)`：只关心串行、并行、分轮调度。
- `shouldContinueAfterResult(plan, result)`：统一失败、中断、取消逻辑。
- `finalizeExecutionContexts(plan, contexts)`：清理临时 copy，保留或提示 worktree。

## 失败策略

新增统一判断，避免每个模式自己写 `break`：

```ts
function shouldContinueAfterResult(plan: CLIExecutionPlan, result: CLIRunResult): boolean {
  if (result.status === 'cancelled' || result.exitCode === -2) return false;
  if (plan.failurePolicy === 'continue') return true;
  if (plan.failurePolicy === 'stopOnCancelled') return true;
  if (plan.failurePolicy === 'stopOnFailure') {
    return !result.isError && result.exitCode === 0;
  }
  return true;
}
```

需要同步增强 `CLIRunResult`：

```ts
export interface CLIRunResult {
  taskId: string;
  agentId: string;
  agentName: string;
  content: string;
  status?: 'completed' | 'failed' | 'cancelled' | 'timeout';
  exitCode?: number;
  durationMs?: number;
  isError?: boolean;
}
```

当前 pipeline 中遇到任意非 0 退出就 `break` 的逻辑应删除，改走 `shouldContinueAfterResult`。

## Discussion 模式方案

第一版做 2 轮讨论，不引入自动裁判：

1. Round 1：所有 Agent 并行接收原始需求，只允许分析和提出方案。
2. Round 2：所有 Agent 接收原始需求 + Round 1 摘要/transcript，输出补充意见、分歧、风险、推荐行动。
3. UI 展示每个 Agent 的两轮输出，不自动修改文件。

Discussion 提示词约束：

```text
你正在参与 CLI Agent 讨论模式。
本模式只用于分析、评审和提出执行建议。
不要修改文件，不要运行会改变 workspace 状态的命令。
如果需要执行修改，请明确列出建议的后续执行步骤。
```

Round 2 提示词追加：

```text
以下是上一轮讨论记录：

---
{transcript}
---

请基于其他 Agent 的意见补充你的最终判断：
1. 你同意哪些结论？
2. 你不同意哪些结论，原因是什么？
3. 最大风险是什么？
4. 推荐下一步怎么执行？
```

实现要求：

- `discussion` 使用 `schedule: staged`，每一轮内部并行。
- `maxRounds` 默认 2，第一版可以不暴露 UI，仅写死在 plan。
- 默认 `isolation: readOnly`，但 CLI 本身未必有真正只读沙箱，所以必须在 prompt 中强约束，并在 UI 标注“讨论模式不会主动要求修改文件”。
- 失败 Agent 不阻塞其他 Agent；最终结果里保留失败气泡。

## Race Worktree 方案

第一版使用 git worktree 隔离，不做自动合并。

### 行为

1. 用户选择 `race`。
2. 执行前检测 `cwd` 是否是 git repo。
3. 为每个 Agent 创建 worktree：

```text
{app_data_dir}/cli-worktrees/{group_id}/{run_id}/{agent_id}
```

4. 每个 Agent 在自己的 worktree 里执行。
5. UI 在任务结果中展示 worktree 路径。
6. 执行结束后默认保留 worktree，用户可手动打开、对比、删除。

### Dirty workspace 处理

`git worktree add` 默认基于当前 `HEAD`，不会带上未提交和未跟踪改动。执行前必须检测：

```bash
git status --porcelain
```

如果有 dirty changes：

- 第一版：阻止 `race` 并提示“当前 workspace 有未提交改动，worktree 不会包含这些改动。请提交、清理或改用顺序执行”。
- 不要自动 `stash`。
- 不要自动提交。
- 不要静默复制目录。

### Tauri IPC 建议

```rust
#[tauri::command]
async fn cli_worktree_prepare(args: CliWorktreePrepareArgs) -> Result<Vec<CliWorktree>, String>;

#[tauri::command]
async fn cli_worktree_cleanup(args: CliWorktreeCleanupArgs) -> Result<(), String>;
```

```ts
export interface CliWorktree {
  agentId: string;
  path: string;
  branchName?: string;
  baseSha?: string;
}
```

第一版可以只实现 prepare，不自动 cleanup。删除 worktree 需要谨慎，后续单独做 UI。

## UI 调整

策略文案建议：

- `router`：智能选择最合适的 CLI Agent 执行。
- `sequential`：按顺序让多个 CLI Agent 独立处理同一任务。
- `pipeline`：按阶段接力执行，后者基于前者输出继续。
- `race`：并行创建隔离 worktree，让多个 CLI Agent 竞争方案。
- `discussion`：多 Agent 分轮讨论方案和风险，默认不修改文件。

设置面板新增说明：

- 当选择 `race`：显示“需要 git 仓库，且当前工作区不能有未提交改动”。
- 当选择 `pipeline`：显示“默认失败继续，取消会停止后续阶段”。
- 当选择 `discussion`：隐藏或弱化审批模式，提示该模式只做分析讨论。

聊天消息状态：

- `pipeline`：气泡标题包含阶段名，例如 `Claude Code · 审查/修改`。
- `discussion`：气泡标题包含轮次，例如 `Codex · Round 1`。
- `race`：气泡底部展示 worktree 路径和“打开路径/复制路径”入口。

## 数据结构兼容

第一版保持 `group.strategy` 仍为字符串，新增可选字段：

```ts
export type CLIStrategy =
  | 'sequential'
  | 'router'
  | 'race'
  | 'pipeline'
  | 'discussion';

export interface CLIGroup {
  // existing fields...
  strategy: CLIStrategy;
  executionPlan?: Partial<CLIExecutionPlan>;
}
```

兼容规则：

- 老数据没有 `executionPlan` 时，通过 `strategy` 映射默认 plan。
- UI 仍展示简单策略按钮。
- 高级设置后续再写入 `executionPlan`。
- 不在本次做一次性数据迁移。

## 分阶段执行任务

### Phase 1：类型和 plan 解析

交付：

- `CLIStrategy` 增加 `discussion`。
- 新增 `CLIExecutionPlan` 相关类型。
- 新增 `resolveExecutionPlan`。
- 旧四种策略行为通过 plan 映射保持兼容。

验收：

- `npm run build` 通过。
- 现有 `sequential / router / race / pipeline` 可正常进入执行。
- `discussion` 在 UI 可选择，但可以先复用 sequential 占位，不报错。

### Phase 2：引擎拆分和失败策略统一

交付：

- `cliEngine.ts` 拆分为选择、提示构造、调度、失败判断函数。
- 删除 pipeline 内部硬编码 `break`。
- `cancelled` 总是停止后续阶段。
- `failed / timeout` 在 pipeline 默认继续执行。

验收：

- Pipeline 中第二个 Agent exit 1 时，第三个 Agent 仍会启动，并能看到上一阶段失败输出。
- 用户点击停止后，不再启动后续 Agent。
- Sequential 中某个 Agent 失败不会影响后续 Agent。

### Phase 3：Discussion 模式

交付：

- 实现 `runDiscussionSchedule`。
- 支持 2 轮 staged 并行讨论。
- Round 2 能看到 Round 1 transcript。
- UI 展示策略按钮和文案。

验收：

- 选择 discussion 后，同一轮内多个 Agent 并行输出。
- Round 2 在 Round 1 全部结束后才开始。
- 讨论提示词明确要求不要修改文件。
- 某个 Agent 失败不会阻断其他 Agent 讨论。

### Phase 4：Race worktree 隔离

交付：

- 新增 worktree prepare IPC。
- `race` 执行前检测 git repo 和 dirty 状态。
- 每个 Agent 使用独立 worktree cwd。
- 结果中返回并展示 worktree path。

验收：

- 干净 git repo 中 race 会为每个 Agent 创建不同 worktree。
- dirty repo 中 race 会阻止执行并给出明确错误。
- Agent 执行不会直接修改原始 workspace。
- 构建和 Rust 测试通过。

### Phase 5：设置面板和文案收口

交付：

- `CLIGroupSettings` 中五种策略文案清晰。
- `CreateGroupWizard` 支持新策略。
- 对 race/pipeline/discussion 的特殊行为给出简短说明。
- 如实现了 worktree path，任务历史可查看该路径。

验收：

- 用户能从 UI 理解五种模式差异。
- 切换策略后配置能持久生效。
- 没有 TypeScript 穷尽性遗漏。

## 建议分派给其他 Agent 的任务包

### Agent A：类型和引擎重构

负责文件：

- `src/config/groups.ts`
- `src/engine/cliEngine.ts`

任务：

- 增加 `discussion` 策略类型。
- 增加 `CLIExecutionPlan`。
- 实现 `resolveExecutionPlan`。
- 拆分 `executeCLIStrategy` 内部流程。
- 统一失败策略。

注意：

- 不要改 Tauri IPC。
- 不要改 UI 样式。
- 保持旧策略兼容。

### Agent B：Discussion UI 和执行

负责文件：

- `src/engine/cliEngine.ts`
- `src/pages/chat/components/CLIGroupSettings.tsx`
- `src/pages/chat/components/CreateGroupWizard.tsx`

任务：

- 实现 discussion 两轮 staged 执行。
- 增加 UI 策略按钮和说明。
- 给 discussion 输出加 round 标签。

注意：

- 讨论模式默认只读提示。
- 不要引入新的 LLM 总结器。

### Agent C：Race worktree

负责文件：

- `src-tauri/src/cli.rs`
- `src-tauri/src/lib.rs`
- `src/utils/request.ts`
- `src/engine/cliEngine.ts`

任务：

- 新增 worktree prepare IPC。
- 检测 git repo 和 dirty workspace。
- race 中为每个 Agent 分配独立 cwd。
- 将 worktree path 附加到执行结果。

注意：

- 不要自动清理 worktree。
- 不要自动 stash/commit。
- worktree 创建失败必须返回明确错误。

### Agent D：验证和回归

负责范围：

- 测试脚本和手动验收。

任务：

- 跑 `npm run build`。
- 跑 `cargo test`。
- 手动验证五种策略至少能进入正确调度分支。
- 验证 pipeline 失败继续、取消停止。
- 验证 dirty repo 下 race 被阻止。

## 验收清单

- [ ] `CLIStrategy` 包含 `discussion`，所有 switch 无遗漏。
- [ ] `resolveExecutionPlan` 覆盖五种预设模式。
- [ ] `pipeline` 失败默认继续，取消停止。
- [ ] `sequential` 失败默认继续。
- [ ] `discussion` 两轮执行，第二轮看到第一轮 transcript。
- [ ] `discussion` 提示词明确只讨论不改文件。
- [ ] `race` 默认使用 worktree per agent。
- [ ] `race` 在 dirty workspace 下阻止执行。
- [ ] `race` 不修改原始 workspace。
- [ ] UI 策略文案能区分 sequential、pipeline、race、discussion。
- [ ] `npm run build` 通过。
- [ ] `cargo test` 通过。

## 风险和处理

| 风险 | 影响 | 处理 |
| --- | --- | --- |
| CLI 不遵守 discussion 只读提示 | 仍可能修改文件 | 第一版明确风险；后续增加真正只读 copy 或权限沙箱 |
| worktree 不包含 dirty changes | Agent 结果和用户当前工作区不一致 | dirty 时阻止 race，不自动 stash |
| worktree 数量累积 | 占用磁盘 | 第一版保留路径，后续加清理 UI |
| 引擎重构影响现有策略 | CLI 群不可用 | Phase 1/2 保持旧策略验收，先不改 UI 大结构 |
| pipeline 失败继续导致后续输入质量差 | 后续 Agent 基于失败输出工作 | 在提示词中明确上一阶段失败状态，让后续 Agent 做诊断或恢复 |

## 推荐最终形态

用户看到的是五个简单模式：

- 智能路由
- 顺序执行
- 流水线
- 竞争模式
- 讨论模式

内部执行的是统一计划：

```text
selection + collaboration + schedule + isolation + failurePolicy
```

后续如果要加 `review`、`debate`、`mapreduce`，不要再直接堆新的硬编码分支，而是新增一个 preset 映射到同一套执行计划。
