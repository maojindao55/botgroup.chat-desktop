# CLI Agent 工作流体验设计

## 决策

如果这是一个没有历史包袱的新产品，主对象应该是 **开发任务**，而不是长期存在的 CLI 群聊。

产品应该像一个本地开发编排工作台：

```text
任务 -> 工作流 -> Agent 执行 -> 可审查结果
```

群聊可以保留为任务内部的表达形式：Agent 像群友一样发言、讨论、交付结果。但主导航、创建流程、运行视图和历史记录都应该围绕任务和工作流展开。

## 产品目标

1. 用户用一句明确需求就能启动开发任务，而不是先配置一个聊天室。
2. 任务运行前，用户能看懂谁会执行、按什么顺序执行、哪些阶段有写权限。
3. 任务运行中，用户能清楚看到当前阶段、Agent 状态、日志、workspace、worktree、diff 和阻塞点。
4. 用户可以安全停止、重试、重跑某个阶段、继续任务，或从旧任务创建一个新的隔离任务。
5. 用户可以创建可复用的自定义工作流，但第一版不需要写脚本。

## 非目标

- 第一版不暴露 JavaScript 工作流运行时。
- 不把固定开发群作为主要入口。
- 不自动合并竞赛模式下的 worktree 结果。
- 不把 CLI 日志藏在模糊的“AI 正在思考”状态后面。
- 不要求用户理解 `router`、`pipeline`、`race` 这类内部策略名。

## 核心心智

用户看到四类稳定对象：

| 对象 | 用户理解 | 示例 |
| --- | --- | --- |
| 任务 | 一次独立开发工作，有自己的上下文和执行历史 | “修复登录超时”、“review 当前 diff” |
| 工作流 | 可复用的编排配方 | “规划 -> 实现 -> 复审 -> 修正” |
| Agent | 带角色的本地 CLI 编码运行时 | Codex 实现者、Claude 复审者、OpenCode 修复者 |
| Workspace | 任务运行的本地项目目录 | `C:\Users\...\project` |

用户不应该为了开始一次开发工作而先学习“CLI 群”的概念。

## 信息架构

推荐顶层导航：

```text
开发
  任务
  工作流
  Agent
  Workspace
```

### 任务

任务列表是 CLI 开发区的默认首页。它展示正在推进的开发工作，而不是团队配置。

任务列表分组：

- 运行中
- 需要处理
- 最近完成
- 失败
- 已归档

每条任务展示：

- 标题
- 状态
- 工作流名称
- workspace 名称或路径
- 当前阶段
- 最近活跃时间
- Agent 头像或 adapter 标识

### 工作流

工作流是编排模板库。

建议分区：

- 推荐
- 我的工作流
- 最近使用
- 高级

默认内置工作流：

- 快速修复：选择一个最合适的 Agent 直接执行。
- 规划、实现、复审：规划者分析，实现者改代码，复审者检查。
- 排查、修复、复审：实现者定位并修复，复审者通过或打回。
- 隔离竞赛：多个 Agent 在独立 worktree 中并行实现，用户选择结果。
- 只读讨论：多个 Agent 分析风险和方案，不修改原 workspace。

### Agent

Agent 是运行时和角色配置库。

每个 Agent profile 应展示：

- 显示名称
- adapter：Codex、Claude Code、OpenCode、Cursor Agent、Qoder、generic
- 命令可用性和登录状态
- 默认角色
- 审批模式
- 自定义参数
- 环境变量
- CLI 会话复用默认策略

### Workspace

Workspace 是项目注册表。

每个 workspace 应展示：

- 路径
- git 状态
- 默认工作流
- 允许使用的 Agent
- 最近任务
- worktree 清理工具

## 主路径

### 新建任务

创建流程的第一屏只问一个问题：

```text
你想让开发团队完成什么？
```

然后进入一个紧凑流程：

1. 确认 workspace。
2. 选择工作流。
3. 预览执行计划。
4. 运行。

工作流选择可以智能默认：

- 小改动、明确修复：快速修复。
- 新功能或重构：规划、实现、复审。
- 用户描述的是 bug 现象：排查、修复、复审。
- 用户要求多方案或对比：隔离竞赛。
- 用户问“应该怎么做”或“帮我评估方案”：只读讨论。

### 执行预览

运行前要展示一个用户能信任的预览：

```text
工作流：规划、实现、复审
Workspace：botgroup.chat-desktop

1. 规划      Claude Code   只读
2. 实现      Codex         可写
3. 复审      Claude Code   只读
4. 修正      Codex         复审不通过时执行，最多 2 轮
```

可操作项：

- 更换工作流
- 替换 Agent
- 修改权限模式
- 编辑阶段提示词
- 运行

这个预览就是 Claude Code Dynamic Workflow 中“运行前展示编排计划”的产品化版本。

## 任务运行页

任务详情页不应该只是普通聊天记录。它应该是一个带会话能力的执行驾驶舱。

推荐布局：

```text
顶部
  任务标题 / 状态 / workspace / 工作流 / 停止按钮

主体
  左侧或上方：阶段时间线
  中间：选中阶段输出和任务会话
  右侧：上下文面板

底部
  继续输入 / 重跑选中阶段 / 点名某个 Agent
```

### 阶段时间线

时间线是用户理解任务状态的锚点。

每个阶段卡片展示：

- 阶段名称
- 分配的 Agent
- 模式：可写或只读
- 状态：待运行、运行中、已完成、失败、已取消、已跳过
- 耗时
- 重试次数
- 输出摘要

示例：

```text
已完成   规划      Claude Code   1m 12s
运行中   实现      Codex         3m 04s
待运行   复审      Claude Code
待运行   修正      Codex         条件执行
```

### 阶段输出

每个阶段要把信号和噪音分开：

- 摘要
- 修改的文件
- 执行的命令
- 验证结果
- 完整日志
- 原始 CLI 输出

大段日志默认折叠。错误、登录过期、失败命令和最终结论要保持可见。

### 上下文面板

右侧面板回答“这次运行在哪里执行、碰了什么”。

建议 tab：

- 概览：工作流、Agent、权限、时间
- Workspace：cwd、git 分支、dirty 状态
- 改动：diff 摘要、变更文件
- 日志：按 Agent 查看 task log
- Worktree：路径、base SHA、清理动作

## 自定义工作流 Builder

第一版应该是可视化和自然语言 Builder，而不是脚本编辑器。

### 自然语言入口

用户可以直接描述想要的编排：

```text
先让 Claude 做方案，再让 Codex 实现，最后让 Claude 复审。
如果复审不通过，就让 Codex 修一次。
```

系统把它转换成结构化工作流草稿，再让用户确认。

### 可视化编辑器

编辑器只暴露一个小而安全的 DSL：

| 字段 | 含义 |
| --- | --- |
| 阶段名称 | 用户看到的步骤名 |
| Agent | 哪个 CLI profile 执行 |
| 模式 | `write` 或 `readOnly` |
| 提示词 | 当前阶段指令 |
| 输入 | 原始需求、上一阶段输出、指定 artifact |
| 下一步 | 下一个阶段、结束、或条件分支 |
| 循环限制 | review/revise 最大轮次 |

复审阶段可以使用决策契约：

```text
REVIEW_DECISION: approved
REVIEW_DECISION: revise
```

这样既允许模型判断，又保持运行时可预测。

### 高级模式

高级模式后续再暴露图编排能力：

- 并行阶段
- 汇总阶段
- 按结构化输出分支
- 人工确认关卡
- 阶段 artifact
- 从指定阶段重跑

在具备沙箱、权限模型、成本限制和可调试运行历史之前，不要暴露原始 JavaScript。

## 工作流运行模型

运行时应该在编排层保持确定性，在单个 Agent 调用内部保留灵活性。

推荐内部模型：

```ts
interface WorkflowDefinition {
  id: string;
  name: string;
  description?: string;
  version: number;
  stages: WorkflowStage[];
  limits: WorkflowLimits;
}

interface WorkflowStage {
  id: string;
  label: string;
  agentId: string;
  mode: 'write' | 'readOnly';
  prompt: string;
  inputPolicy: 'original' | 'previous' | 'originalAndPrevious' | 'artifact';
  next?: string | 'done';
  decision?: WorkflowDecision;
}

interface WorkflowDecision {
  approved: string | 'done';
  revise: string | 'done';
}

interface WorkflowLimits {
  maxLoops: number;
  maxStageRuns: number;
  maxConcurrentAgents: number;
  timeoutMs: number;
}
```

每次执行创建一个 workflow run：

```text
workflow_run
  workflow snapshot
  task id
  status
  started_at
  ended_at

workflow_stage_run
  workflow_run_id
  stage id
  agent task id
  status
  input summary
  output summary
  artifact refs
```

每个 stage run 可以继续复用现有 CLI task 和日志机制。

## 安全模型

Coding Agent 会修改文件和执行命令，所以安全必须可见。

### 权限模式

阶段级模式：

- 只读：分析、检查、复审。条件允许时应运行在 copy 或真正只读上下文中。
- 可写：允许修改文件并运行验证。

任务级审批：

- 自动：按计划运行，不逐阶段询问。
- 运行前询问：执行前确认计划。
- 写入前询问：只读阶段自动执行，可写阶段需要确认。

### Worktree 规则

竞争或并行写入工作流默认使用 worktree 隔离。

规则：

- 原 workspace 有未提交改动时，阻止隔离竞赛，或让用户选择其他模式。
- 不自动 stash。
- 不自动 commit。
- 不自动 merge。
- 保留 worktree 路径，直到用户手动清理。

### 停止和重试

停止意味着：

- 取消当前运行中的 CLI 进程
- 阻止后续阶段启动
- 将未运行阶段标记为 skipped 或 cancelled

重试选项：

- 重试失败阶段
- 从选中阶段重新运行
- 用一条新指令继续任务
- 从当前任务创建一个新的隔离任务

## UX 文案

主界面使用用户能理解的工作流名称，不暴露内部策略名。

推荐映射：

| 内部概念 | 用户文案 |
| --- | --- |
| router | 快速修复 |
| pipeline | 接力开发 |
| review custom workflow | 规划、实现、复审 |
| race | 隔离竞赛 |
| discussion | 只读讨论 |
| task session policy | 每个任务隔离上下文 |
| worktree per agent | 每个 Agent 使用独立 workspace |

动作文案使用动词：

- 运行工作流
- 停止任务
- 重试阶段
- 从这里重跑
- 保存为工作流
- 对比结果
- 采用这个结果
- 清理 worktree

避免让用户思考工程实现：

- 避免“CLI 群”。
- 主界面避免“策略”。
- 非高级区域避免“执行计划”。
- 避免“DAG”。

## MVP 范围

### Phase 1：Task-first 外壳

先交付产品形态：

- CLI 开发区默认展示任务列表。
- 新建任务从 prompt、workspace、workflow 开始。
- 任务详情展示阶段时间线。
- 底层继续复用现有 CLI 执行路径。
- 内置工作流覆盖快速修复、规划/实现/复审、排查/修复/复审、隔离竞赛。

暂不做完整自定义工作流编辑器。

### Phase 2：工作流模板

交付可复用工作流：

- 工作流库。
- 将当前运行保存为工作流。
- 编辑阶段提示词、Agent 分配、权限模式、最大循环次数。
- 运行前预览。
- 每个任务保存 workflow snapshot。

### Phase 3：自定义 Workflow Builder

交付用户自定义编排：

- 自然语言生成工作流草稿。
- 可视化阶段编辑器。
- 条件 review/revise 循环。
- 人工确认关卡。
- 重跑指定阶段。

### Phase 4：高级编排

交付更复杂模式：

- 并行阶段
- reduce/summarize 阶段
- race 结果对比
- 阶段 artifact 传递
- 结构化决策输出

### Phase 5：必要时再做脚本运行时

只有当声明式 Builder 不够用时，才考虑脚本运行时。

脚本运行时前置要求：

- 沙箱解释器
- 脚本不能直接访问文件系统
- 只开放 `runAgent`、`readArtifact`、`setArtifact` 等受控 API
- 最大并发限制
- 最大运行时间
- kill/resume 语义
- 完整运行审计日志

## 数据模型草案

```ts
type DevelopmentTaskStatus =
  | 'draft'
  | 'queued'
  | 'running'
  | 'needsAttention'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'archived';

interface DevelopmentTask {
  id: string;
  title: string;
  prompt: string;
  status: DevelopmentTaskStatus;
  workspaceId: string;
  workflowId: string;
  workflowSnapshot: WorkflowDefinition;
  stageRuns: WorkflowStageRun[];
  createdAt: string;
  updatedAt: string;
}

interface WorkflowStageRun {
  id: string;
  taskId: string;
  stageId: string;
  agentId: string;
  agentTaskId?: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'skipped';
  mode: 'write' | 'readOnly';
  startedAt?: string;
  endedAt?: string;
  outputSummary?: string;
  errorMessage?: string;
}
```

## 实现备注

新的产品形态仍然可以复用当前执行组件：

- 单次 CLI 执行仍然是本地进程运行。
- 阶段执行可以继续调用现有 CLI run path。
- 任务日志可以继续写 JSONL 文件。
- worktree 准备继续放在后端。
- 工作流定义和任务时间线可以先放前端持久化，稳定后再迁到 SQLite。

关键产品变化不是重写 runner，而是通过任务和工作流概念把 runner 变得可见、可理解、可恢复。

## 验收标准

体验做对时，应满足：

1. 新用户不理解“群”也能创建开发任务。
2. 任务运行前，用户能看到准确的阶段、Agent 和只读/可写模式。
3. 任务运行中，用户知道现在正在跑什么、下一步会跑什么。
4. 任务完成后，用户能检查变更文件、日志、最终摘要和 worktree 路径。
5. 失败任务仍然有用：用户可以重试阶段、继续任务，或从它创建新任务。
6. 用户可以把一次成功编排保存成工作流模板。
7. 自定义工作流可以表达复审/修正循环，而不需要暴露脚本代码。

## 待确认问题

- 自然语言生成工作流时，应该调用本地 CLI Agent，还是直接调用 LLM provider？
- 只读阶段是否默认运行在临时 copy 中，即使速度更慢？
- 任务消息是否继续保持聊天形态，还是让阶段摘要成为主产物？
- 工作流模板默认应该按 workspace 隔离，还是全局可用？
- 第一版需要把多少 workflow run 历史从前端持久化迁到 SQLite？

## 推荐结论

围绕 task-first workbench 构建新产品：

```text
任务是目的地。
工作流是可复用产品面。
Agent 是可配置工人。
聊天是转录记录，不是应用模型。
```

这样普通用户容易理解，同时也为后续演进到 Claude Code Dynamic Workflow 这类动态编排保留空间。
