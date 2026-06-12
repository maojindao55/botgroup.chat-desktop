# Agent 群聊动态协作方案

> 修订原则：不考虑历史包袱，按 clean refactor 处理。旧的 8 种 `AgentStrategy` 不再作为产品入口或执行主路径保留，直接重构为动态 workflow 架构。

## 背景

当前 Agent 群聊把底层策略直接暴露给用户：`sequential`、`router`、`discussion`、`react`、`pipeline`、`debate`、`mapreduce`、`supervisor`。这些策略对工程实现有意义，但对用户来说心智负担过高。用户真正想表达的是：

- 快速处理一个小问题
- 先讨论方案，不要动 workspace
- 多个 Agent 各给一个方案用于比较
- 改完代码后再让另一个 Agent 复审
- 大范围扫描、拆分、交叉验证

Claude Code 的 dynamic workflows 值得借鉴的点不是“再加一种模式”，而是把编排从用户选择转为运行时动态生成：用户描述任务，系统生成可审阅、可执行、可复用的协作计划。我们采用这个方向，但先用受控 DSL 落地，避免一开始引入任意脚本执行的安全和调试成本。

## 目标

1. 默认只保留一个主要入口：`智能协作`。
2. 从 UI、群配置和执行入口移除现有 8 种策略。
3. 每次运行前生成一张“协作计划卡片”，让用户确认会做什么、谁参与、是否写文件。
4. 执行计划用结构化 JSON 表达，作为 Agent 群唯一编排协议。
5. 成员配置从“选择流程”改为“声明能力”：擅长领域、可用工具、权限、成本/速度偏好。
6. `agentEngine` 从 strategy switch 重构为 `planner -> runner -> phase executor`。

## 非目标

- 不直接照搬 Claude dynamic workflows 的 JavaScript workflow 脚本。
- 不在第一阶段支持上百个 Agent 并发。
- 不保留旧策略的产品入口、设置项和主执行分支。
- 不为旧 Agent 群数据做复杂兼容；开发阶段可接受重建测试群。
- 不要求用户理解 MapReduce、Supervisor、ReAct 等术语。

## 产品模型

### 默认视图

Agent 群聊设置只显示：

- 群名称 / 描述
- 成员
- 工作目录
- 默认协作强度：`快速` / `标准` / `深入`
- 写入权限：`先询问` / `允许自动编辑`

高级设置只保留调试和成本相关项：

- 最大阶段数
- 最大并发 Agent 数
- 是否总是展示计划卡
- 是否显示原始 workflow JSON

### 输入区快捷意图

输入框上方或发送按钮旁保留少量自然语言选项：

- `智能协作`，默认
- `只读讨论`
- `多方案对比`
- `改完复审`
- `隔离执行`

这些不是底层策略名，而是给 planner 的约束。用户不选时，planner 自行判断。

### 运行前计划卡片

发送任务后，系统先生成计划卡片：

```text
协作计划

任务类型：代码修改 + 复审
阶段：
1. Codex 阅读相关文件并制定修改方案，只读
2. Codex 按方案修改代码并运行验证
3. Claude Code 只读复审改动，指出阻塞问题
4. 如复审不通过，Codex 修正一次

影响：
- 会修改 workspace
- 不创建 worktree
- 最多 4 个阶段

操作：运行 / 修改计划 / 取消
```

小任务可以默认跳过计划卡，但需要可配置。建议规则：

- 只读任务：可直接运行
- 写 workspace：默认展示计划卡
- 多 Agent 并行或 worktree：必须展示计划卡

## 执行计划 DSL

第一版用 JSON，不用脚本。这个 DSL 替代 `AgentStrategy`，成为 Agent 群唯一执行模型。

### 群配置模型

```ts
type AgentGroupV2 = {
  id: string;
  type: 'agent';
  name: string;
  description: string;
  memberIds: string[];
  workspacePath?: string;
  approvalMode: 'auto' | 'ask';
  timeout: number;
  showStderr: boolean;
  workflowDefaults: {
    effort: 'fast' | 'standard' | 'deep';
    maxPhases: number;
    maxParallelAgents: number;
    alwaysShowPlan: boolean;
  };
};
```

删除：

- `strategy`
- `coordinatorPrompt`
- `maxRounds`
- `agents` 兼容字段

```ts
type AgentWorkflowPlan = {
  version: 1;
  title: string;
  intent:
    | 'quick'
    | 'discuss'
    | 'implement'
    | 'review'
    | 'multi_solution'
    | 'audit'
    | 'custom';
  riskLevel: 'low' | 'medium' | 'high';
  requiresApproval: boolean;
  explanation: string;
  phases: AgentWorkflowPhase[];
};

type AgentWorkflowPhase = {
  id: string;
  label: string;
  mode: 'readOnly' | 'write' | 'review';
  schedule: 'single' | 'parallel' | 'sequential';
  agentSelection:
    | { type: 'auto'; count?: number; capabilities?: string[] }
    | { type: 'specific'; agentIds: string[] };
  prompt: string;
  dependsOn?: string[];
  outputPolicy?: 'summary' | 'full' | 'findings' | 'diff';
  onFailure?: 'stop' | 'continue' | 'ask';
  retry?: {
    maxAttempts: number;
    feedbackFromPhaseId?: string;
  };
};
```

示例：改完复审。

```json
{
  "version": 1,
  "title": "实现并复审导出 CSV 功能",
  "intent": "implement",
  "riskLevel": "medium",
  "requiresApproval": true,
  "explanation": "任务需要修改代码且有回归风险，因此采用先分析、再实现、最后只读复审的流程。",
  "phases": [
    {
      "id": "plan",
      "label": "分析与计划",
      "mode": "readOnly",
      "schedule": "single",
      "agentSelection": { "type": "auto", "capabilities": ["codebase-analysis"] },
      "prompt": "分析需求、定位相关文件、给出最小实现计划。",
      "outputPolicy": "summary"
    },
    {
      "id": "implement",
      "label": "实现与验证",
      "mode": "write",
      "schedule": "single",
      "agentSelection": { "type": "auto", "capabilities": ["implementation"] },
      "dependsOn": ["plan"],
      "prompt": "按上一阶段计划实现，并运行必要验证。",
      "outputPolicy": "diff",
      "onFailure": "ask"
    },
    {
      "id": "review",
      "label": "复审",
      "mode": "review",
      "schedule": "single",
      "agentSelection": { "type": "auto", "capabilities": ["code-review"] },
      "dependsOn": ["implement"],
      "prompt": "只读复审改动，重点关注行为回归、测试缺口和风险。",
      "outputPolicy": "findings"
    }
  ]
}
```

## Planner 设计

新增 `src/engine/agentWorkflowPlanner.ts`，职责是把用户消息、群成员、快捷意图、workspace 状态转成执行计划。

输入：

- 用户消息
- 最近会话历史摘要
- 附件路径摘要
- 群成员能力描述
- workspace 是否配置
- 当前 git 状态
- 用户选择的快捷意图

输出：

- 结构化 `AgentWorkflowPlan`
- 面向用户的计划说明
- 是否需要审批

Planner 可以分两阶段落地：

1. 规则 planner：稳定、可测试。根据关键词和权限约束生成计划。
2. LLM planner：复杂任务调用协调模型生成计划，再用 schema 校验和规则修正。

clean refactor 仍建议先做规则 planner，因为它能快速替代旧策略并建立测试基线。LLM planner 第二阶段接入，但它只能输出 DSL，不能直接执行命令或绕过安全约束。

## 执行器设计

新增 `src/engine/agentWorkflowRunner.ts`，按 phase 执行计划。它替代 `executeAgentStrategy` 成为 Agent 群唯一执行入口。

执行规则：

- `readOnly` 阶段使用只读 prompt，必要时使用临时只读副本。
- `write` 阶段必须有 workspace，且受 approval mode 约束。
- `review` 阶段默认只读，不允许修改文件。
- `parallel` 阶段使用 `Promise.allSettled` 收集结果。
- 每个 phase 只把必要摘要传给后续 phase，避免把所有原始输出塞入上下文。
- phase 输出保存在结构化状态中，用于 UI 展示、恢复和保存模板。

可以抽取并复用低层能力，但不保留旧策略 API：

- 从 `agentEngine.ts` 抽出 `runSingleAgent` / `runSingleCLIAgent` 到 `agentRuntime.ts`。
- 删除 `runSequential`、`runRouter`、`runDiscussion`、`runReAct`、`runPipeline`、`runDebate`、`runMapReduce`、`runSupervisor` 这些产品策略函数。
- `parallel`、`sequential`、`retry` 等调度语义统一在 runner 里实现。
- phase 间传递结构化输出，不再靠拼接一整段历史文本。

## 成员能力模型

Agent 成员增加可选能力字段：

```ts
type AgentCapability =
  | 'codebase-analysis'
  | 'implementation'
  | 'code-review'
  | 'testing'
  | 'debugging'
  | 'security'
  | 'performance'
  | 'documentation'
  | 'product'
  | 'research';
```

选择 Agent 时优先看：

1. 用户显式 @mention
2. phase 的 `capabilities`
3. 成员配置能力
4. 历史成功率和最近可用性
5. 成本/速度偏好

这比让用户手选协作模式更稳定：用户维护的是“谁擅长什么”，系统决定“怎么组织他们”。

## UI 改造

### AgentGroupSettings

调整为：

- 删除策略网格
- 模板区改为“默认协作偏好”，只保留 3 个选项：快速、标准、深入
- 成员列表展示能力 tag
- 工作目录和权限仍保留
- 高级区只展示执行上限和调试开关，不再出现 ReAct、MapReduce、Supervisor 等术语

### AgentChatUI

发送后流程改为：

1. 生成计划
2. 如需审批，插入计划卡片
3. 用户确认后执行
4. 执行中展示 phase 进度，而不是散落的策略消息
5. 每个 Agent 输出仍以气泡/日志形式可展开查看
6. 最终给出汇总消息

### 会话记录

消息模型增加 workflow run 元数据，并把它作为 Agent 群执行记录的核心结构：

```ts
type AgentWorkflowRun = {
  id: string;
  plan: AgentWorkflowPlan;
  status: 'planned' | 'running' | 'completed' | 'failed' | 'cancelled';
  phaseStates: Record<string, AgentWorkflowPhaseState>;
  createdAt: number;
  updatedAt: number;
};
```

开发阶段先存入现有 chat session，最终应进入统一会话持久化结构。因为不考虑旧数据兼容，可以直接扩展 `ChatSessionMessage`，不做旧版消息迁移逻辑。

## 删除与替换清单

| 旧项 | 处理方式 | 替代 |
| --- | --- | --- |
| `AgentStrategy` | 删除或仅保留为历史类型注释 | `AgentWorkflowPlan.intent` + `phases` |
| `AgentGroup.strategy` | 删除 | `workflowDefaults` |
| `AgentGroup.coordinatorPrompt` | 删除 | planner 系统提示与可保存 workflow |
| `AgentGroup.maxRounds` | 删除 | `workflowDefaults.maxPhases` |
| `AgentGroup.agents` 兼容字段 | 删除 | `memberIds` |
| `executeAgentStrategy` | 替换 | `planAndRunAgentWorkflow` |
| `AgentGroupSettings` 策略网格 | 删除 | 协作强度 + 调试开关 |
| 产品模板 `agentWorkflowTemplates` | 删除或改名 | `workflowIntentPresets` |

新的用户意图到默认计划映射：

| 用户意图 | 默认计划 |
| --- | --- |
| 快速处理 | 单 Agent 直接执行，必要时先读上下文 |
| 只读讨论 | 多 Agent 并行分析，然后一个 synthesize phase 汇总 |
| 方案产出 | research -> draft -> review -> finalize |
| 多方案对比 | 多 Agent 并行提案 -> 交叉审阅 -> 汇总建议 |
| 改完复审 | plan -> implement -> review -> revise once |
| 大范围审计 | split targets -> parallel audit -> verify findings -> report |
| 隔离执行 | plan -> worktree per agent -> compare result -> user pick |

## 分阶段落地

### Phase 1：数据模型与入口重构

- 修改 `AgentGroup`，移除 `strategy/coordinatorPrompt/maxRounds/agents`。
- 新增 `AgentWorkflowPlan`、`AgentWorkflowRun`、`AgentCapability` 类型。
- 删除 Agent 群设置里的策略网格和模板按钮。
- `AgentChatUI` 发送入口改为调用 `planAndRunAgentWorkflow`。

验收：

- 新建 Agent 群时无需选择 8 种策略。
- 代码里 Agent 群主路径不再调用 `executeAgentStrategy`。
- UI 中不出现 ReAct、MapReduce、Supervisor 等底层术语。

### Phase 2：规则 Planner + Runner

- 新增 `agentWorkflowPlanner.ts`。
- 根据快捷意图和任务类型生成 `AgentWorkflowPlan`。
- 新增 `agentWorkflowRunner.ts`，支持 `single/sequential/parallel/retry`。
- 抽取 `agentRuntime.ts`，提供单 Agent CLI/LLM 执行能力。
- 删除旧策略函数或从主路径断开。

验收：

- “只读讨论”不会修改 workspace。
- “改完复审”能生成 plan -> implement -> review 三阶段。
- 计划卡显示阶段、成员、权限影响。
- phase 输出结构化记录，后续 phase 从 `phaseStates` 读取摘要。

### Phase 3：能力路由

- 成员增加 capabilities。
- Agent 选择从固定顺序改为能力匹配。
- 支持用户 @mention 覆盖自动选择。

验收：

- 配置 reviewer 能力后，复审阶段优先选 reviewer。
- 未配置能力时仍按当前成员顺序兜底。

### Phase 4：LLM Planner 与计划编辑

- 复杂任务允许 LLM 生成计划。
- 使用 JSON schema 校验。
- 计划必须经过规则安全修正：写入权限、并发上限、workspace 检查、只读约束。
- 计划卡支持“修改计划”：用户用自然语言补充约束，planner 重新生成 DSL。

验收：

- LLM 输出非法计划时自动回退规则 planner。
- 写文件计划必须显示审批。
- 不能选择不存在的 Agent。

### Phase 5：保存和复用

- 成功运行的计划可保存为“群规”。
- 保存后的计划支持参数化输入。
- 支持导出/导入项目级 workflow 模板。

验收：

- 用户可以把一次成功的“实现 + 复审”保存为模板。
- 下次输入同类任务时可一键复用。

## 风险与约束

- 成本：多 Agent 并行会线性增加 token 和 CLI 调用成本。计划卡必须提示预计阶段和参与人数。
- 文件冲突：并行写 workspace 风险高。第一版禁止多个 Agent 同时写同一 workspace，除非使用 worktree。
- Planner 误判：规则 planner 必须优先保守，写操作默认审批，LLM planner 输出必须 schema 校验。
- 可解释性：用户需要知道“为什么这么安排”。计划卡要展示原因，不只展示阶段。
- 执行中断：phase 状态需要可恢复到“重新运行当前阶段”或“从下一阶段继续”。
- 旧数据破坏：本方案接受开发阶段清理旧 Agent 群数据；如果发版需要迁移，再单独写迁移脚本。

## 推荐决策

建议采用“删除旧策略模型 + workflow DSL 统一编排 + 规则 planner 先行”的路线。

理由：

- 立刻降低用户心智负担。
- 代码模型更干净，不再维护两套策略语义。
- 后续扩展只需要增加 planner 和 phase 类型，不需要继续新增模式。
- 不引入任意脚本执行安全问题。
- 后续仍可演进到 Claude dynamic workflows 那样的可保存、可重跑编排。

第一版最值得优先实现的是 `AgentWorkflowPlan`、计划卡和 `agentWorkflowRunner`，而不是在旧 `AgentStrategy` 上加 `auto` 补丁。
