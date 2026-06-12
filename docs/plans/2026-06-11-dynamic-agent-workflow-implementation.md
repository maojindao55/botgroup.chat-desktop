# Dynamic Agent Workflow 详细实施计划

> 面向执行 agent：这是一份开发实施计划，不是产品概念文档。按任务编号推进，每个任务都要提交可验证的代码和测试。目标是干净重构，不保留旧 Agent 策略模式作为主路径。

## 总目标

把 Agent 群聊从固定策略模型：

```text
AgentGroup.strategy -> executeAgentStrategy -> runSequential/runDebate/...
```

重构为动态 workflow 模型：

```text
user message -> planner -> AgentWorkflowPlan -> plan card -> runner -> phase executor -> final summary
```

最终用户不再选择 `sequential/router/discussion/react/pipeline/debate/mapreduce/supervisor`。用户只创建群、选择成员、设置权限，然后发送任务。系统自动生成协作计划并执行。

## 全局原则

- 不做复杂历史兼容。开发期允许清理本地旧 Agent 群数据。
- 不保留旧 8 种 `AgentStrategy` 作为 UI 或执行主路径。
- 旧代码可被抽取复用，但不能继续以 `executeAgentStrategy(group.strategy)` 方式存在。
- 第一版不引入任意 JS workflow 脚本，只使用受控 JSON DSL。
- 写 workspace 的计划必须可解释、可审批、可取消。
- 并行写同一个 workspace 第一版禁止；只读并行允许。
- 其他 agent 开发时不要修改无关文件，尤其不要碰已有的 `src-tauri/Cargo.lock` 变更，除非任务明确要求。

## 目标架构

新增核心模块：

```text
src/config/agentWorkflow.ts         # DSL 类型、默认值、纯函数
src/engine/agentRuntime.ts          # 单个 CLI/LLM agent 执行
src/engine/agentWorkflowPlanner.ts  # 规则 planner，后续可接 LLM planner
src/engine/agentWorkflowRunner.ts   # workflow phase 执行器
```

替换/收敛模块：

```text
src/engine/agentEngine.ts                       # 删除或变成薄 re-export，不能再有 strategy switch
src/pages/chat/components/AgentChatUI.tsx       # 调用 planner/runner，展示 plan card 和 phase 状态
src/pages/chat/components/AgentGroupSettings.tsx# 删除策略网格，改为 workflow 默认偏好
src/pages/chat/components/CreateGroupWizard.tsx # 删除 Agent 策略模板配置
src/config/groups.ts                            # 重写 AgentGroup 类型
src/config/groupProduct.ts                      # 删除 agentWorkflowTemplates，新增 workflow intent/effort 文案
src/config/chatSessions.ts                      # 持久化 workflow run 元数据
src/config/aiMembers.ts                         # 增加 capabilities
```

## 目标类型

### AgentGroup

在 `src/config/groups.ts` 中把 Agent 群重构为：

```ts
export type AgentWorkflowEffort = 'fast' | 'standard' | 'deep';

export interface AgentWorkflowDefaults {
  effort: AgentWorkflowEffort;
  maxPhases: number;
  maxParallelAgents: number;
  alwaysShowPlan: boolean;
}

export interface AgentGroup {
  id: string;
  type: 'agent';
  name: string;
  description: string;
  memberIds: string[];
  workspacePath?: string;
  timeout?: number;
  approvalMode?: 'auto' | 'ask';
  showStderr?: boolean;
  workflowDefaults: AgentWorkflowDefaults;
}
```

删除字段：

- `agents`
- `strategy`
- `coordinatorPrompt`
- `maxRounds`

### Agent capabilities

在 `src/config/aiMembers.ts` 中新增：

```ts
export type AgentCapability =
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

给 `AgentMember_v2` 和 `CLIMember` 增加：

```ts
capabilities?: AgentCapability[];
```

内置 CLI 成员可以先给默认能力：

- Codex: `implementation`, `testing`, `codebase-analysis`
- ClaudeCode: `codebase-analysis`, `code-review`, `debugging`
- OpenCode/Cursor/Qoder/Antigravity: `implementation`, `debugging`

### Workflow DSL

新建 `src/config/agentWorkflow.ts`：

```ts
import type { AgentCapability } from './aiMembers';

export type AgentWorkflowIntent =
  | 'quick'
  | 'discuss'
  | 'implement'
  | 'review'
  | 'multi_solution'
  | 'audit'
  | 'custom';

export type AgentWorkflowRiskLevel = 'low' | 'medium' | 'high';
export type AgentWorkflowPhaseMode = 'readOnly' | 'write' | 'review';
export type AgentWorkflowSchedule = 'single' | 'parallel' | 'sequential';
export type AgentWorkflowOutputPolicy = 'summary' | 'full' | 'findings' | 'diff';

export type AgentWorkflowSelection =
  | { type: 'auto'; count?: number; capabilities?: AgentCapability[] }
  | { type: 'specific'; agentIds: string[] };

export interface AgentWorkflowRetryPolicy {
  maxAttempts: number;
  feedbackFromPhaseId?: string;
}

export interface AgentWorkflowPhase {
  id: string;
  label: string;
  mode: AgentWorkflowPhaseMode;
  schedule: AgentWorkflowSchedule;
  agentSelection: AgentWorkflowSelection;
  prompt: string;
  dependsOn?: string[];
  outputPolicy?: AgentWorkflowOutputPolicy;
  onFailure?: 'stop' | 'continue' | 'ask';
  retry?: AgentWorkflowRetryPolicy;
}

export interface AgentWorkflowPlan {
  version: 1;
  title: string;
  intent: AgentWorkflowIntent;
  riskLevel: AgentWorkflowRiskLevel;
  requiresApproval: boolean;
  explanation: string;
  phases: AgentWorkflowPhase[];
}

export type AgentWorkflowRunStatus = 'planned' | 'running' | 'completed' | 'failed' | 'cancelled';
export type AgentWorkflowPhaseStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'cancelled';

export interface AgentWorkflowAgentOutput {
  agentId: string;
  agentName: string;
  content: string;
  isError?: boolean;
  agentTaskId?: string;
  adapter?: string;
}

export interface AgentWorkflowPhaseState {
  phaseId: string;
  status: AgentWorkflowPhaseStatus;
  selectedAgentIds: string[];
  outputs: AgentWorkflowAgentOutput[];
  summary?: string;
  error?: string;
  startedAt?: number;
  endedAt?: number;
}

export interface AgentWorkflowRun {
  id: string;
  plan: AgentWorkflowPlan;
  status: AgentWorkflowRunStatus;
  phaseStates: Record<string, AgentWorkflowPhaseState>;
  createdAt: number;
  updatedAt: number;
}
```

同文件提供纯函数：

- `createDefaultAgentWorkflowDefaults()`
- `newAgentWorkflowRunId()`
- `newAgentWorkflowRun(plan)`
- `validateAgentWorkflowPlan(plan, availableAgentIds, options)`
- `summarizeWorkflowPlan(plan)`
- `planRequiresWorkspaceWrite(plan)`
- `getWorkflowPlanApprovalReason(plan)`

## PR 拆分

### PR 1：类型与产品文案重构

目标：移除 Agent 群固定策略配置，建立新的 workflow 类型和默认值。

文件范围：

- `src/config/groups.ts`
- `src/config/agentWorkflow.ts`
- `src/config/agentWorkflow.test.mjs`
- `src/config/aiMembers.ts`
- `src/config/groupProduct.ts`
- `src/config/groupProduct.test.mjs`
- `src/i18n/resources/zh-CN/product.json`
- `src/i18n/resources/en-US/product.json`
- `package.json`

实施步骤：

1. 新建 `src/config/agentWorkflow.ts`，写入 DSL 类型和纯函数。
2. 新建 `src/config/agentWorkflow.test.mjs`，用现有 `typescript.transpileModule` 风格测试纯函数。
3. 修改 `src/config/groups.ts`：
   - 删除 `AgentStrategy`。
   - 重写 `AgentGroup`。
   - 保留 `AIGroup` 和 `CLIGroup` 不动。
4. 修改 `src/config/aiMembers.ts`：
   - 新增 `AgentCapability`。
   - 给 CLI/Agent 成员增加 `capabilities?: AgentCapability[]`。
   - 给内置 CLI 成员补默认能力。
5. 修改 `src/config/groupProduct.ts`：
   - 删除 `AgentWorkflowTemplate` 和 `agentWorkflowTemplates`。
   - 新增 `agentWorkflowEfforts`：快速、标准、深入。
   - 新增 `workflowIntentPresets`：智能协作、只读讨论、多方案对比、改完复审、隔离执行。
6. 更新产品测试，断言不再出现旧策略模板。
7. 在 `package.json` 的 `test:product` 加入 `node src/config/agentWorkflow.test.mjs`。

验收：

- `rg "AgentStrategy|agentWorkflowTemplates|coordinatorPrompt|maxRounds" src/config src/engine src/pages` 只允许出现在待后续 PR 修改的旧文件中，不应出现在新类型/文案测试中。
- `npm run test:product` 通过。

建议测试点：

- 默认 workflow defaults 值正确。
- `validateAgentWorkflowPlan` 能拒绝重复 phase id、未知 dependency、未知 agent id、空 phase。
- `planRequiresWorkspaceWrite` 能识别 `write` phase。
- `summarizeWorkflowPlan` 输出可展示摘要。

### PR 2：创建群和设置面板改造

目标：用户创建/编辑 Agent 群时不再看到旧协作模式。

文件范围：

- `src/pages/chat/components/CreateGroupWizard.tsx`
- `src/pages/chat/components/AgentGroupSettings.tsx`
- `src/i18n/resources/zh-CN/wizard.json`
- `src/i18n/resources/en-US/wizard.json`
- `src/i18n/resources/zh-CN/settings.json`
- `src/i18n/resources/en-US/settings.json`
- `src/i18n/resources/zh-CN/product.json`
- `src/i18n/resources/en-US/product.json`

实施步骤：

1. `CreateGroupWizard.tsx`：
   - 删除 `AgentStrategy` import 和相关 state：`strategy/coordinatorPrompt/maxRounds/agentTemplateId`。
   - 删除 `agentWorkflowTemplates` UI。
   - Agent config 改为：
     - workspace path
     - approval mode
     - timeout
     - effort: `fast | standard | deep`
     - maxPhases
     - maxParallelAgents
     - alwaysShowPlan
   - 创建 AgentGroup 时写入 `workflowDefaults`。
2. `AgentGroupSettings.tsx`：
   - 删除策略按钮网格、模板按钮、coordinator prompt、max rounds。
   - 保留基本信息、成员、工作目录、权限。
   - 增加 workflow defaults 编辑区。
   - 成员列表展示 `capabilities` tag。
3. i18n：
   - 删除或不再使用旧策略键。
   - 新增 effort、max phase、max parallel、always show plan 文案。

验收：

- 新建 Agent 群时 UI 不出现“ReAct / MapReduce / Supervisor / 辩论 / 流水线”等底层术语。
- 创建出来的 AgentGroup 有 `workflowDefaults`，没有 `strategy/coordinatorPrompt/maxRounds`。
- `npm run test:i18n` 通过。
- `npm run build` 至少通过 TypeScript 阶段。

手工检查：

- 新建专家/Agent 群，选择 CLI 成员，配置 workspace，能保存。
- 设置面板能打开、修改 defaults、添加/移除成员。

### PR 3：抽取单 Agent runtime

目标：把旧 `agentEngine.ts` 里可复用的“单 Agent 执行”抽出来，作为 workflow runner 的底层能力。

文件范围：

- `src/engine/agentRuntime.ts`
- `src/engine/agentRuntime.test.mjs`
- `src/engine/agentEngine.ts`
- `src/engine/agentEngine.test.mjs`
- `package.json`

实施步骤：

1. 新建 `src/engine/agentRuntime.ts`。
2. 从 `agentEngine.ts` 移入并整理：
   - `AgentMessage`
   - `AgentRunResult`
   - `StreamCallback`，可重命名为 `AgentRuntimeCallback`
   - `callAgentLLM`
   - `runSingleAgent`
   - `runSingleCLIAgent`
   - `getGroupAgents`
   - `normalizeAgentMember`
   - CLI workspace 检查
3. `agentRuntime` 不知道 workflow phase，只做单成员执行。
4. 删除 `Blackboard` import 和未使用代码。
5. 旧 `agentEngine.ts` 暂时可以保留但标记 deprecated，或变成从 runtime re-export，直到 PR 5 删除主调用。
6. 新增 `agentRuntime.test.mjs`：
   - CLI 成员执行会调用 `callCLIAgent`。
   - 没有 workspace 时 CLI 执行报错。
   - tool session lookup 能注入。
   - LLM 成员会调用 `/api/agent/chat`。

验收：

- `node src/engine/agentRuntime.test.mjs` 通过。
- `npm run test:cli` 里旧 `agentEngine.test.mjs` 可以暂时改为 runtime 测试或移除。
- `rg "Blackboard" src/engine` 不再有无用 import。

注意：

- 这一 PR 不做 planner/runner。
- 保持 CLI 日志 meta：`agentTaskId`、`adapter` 仍通过 callback 上报。

### PR 4：规则 Planner

目标：实现 deterministic planner，先不用 LLM。

文件范围：

- `src/engine/agentWorkflowPlanner.ts`
- `src/engine/agentWorkflowPlanner.test.mjs`
- `src/utils/mentionAutocomplete.ts` 或复用现有 mention 解析工具
- `package.json`

Planner API：

```ts
export interface AgentWorkflowPlannerInput {
  group: AgentGroup;
  members: AIMember[];
  userMessage: string;
  history: string;
  attachmentSummary?: string;
  intentHint?: AgentWorkflowIntent;
  mentionedAgentIds?: string[];
  workspaceReady: boolean;
}

export interface AgentWorkflowPlannerResult {
  plan: AgentWorkflowPlan;
  warnings: string[];
}

export function planAgentWorkflow(input: AgentWorkflowPlannerInput): AgentWorkflowPlannerResult;
```

规则要求：

1. `intentHint = discuss`：
   - 全部 readOnly。
   - parallel analyze phase。
   - synthesize phase。
2. `intentHint = multi_solution`：
   - parallel proposals。
   - review/synthesize phase。
   - 不写 workspace，除非后续显式隔离执行。
3. `intentHint = implement` 或检测到写入类关键词：
   - `plan(readOnly) -> implement(write) -> review(review)`。
   - `requiresApproval = true`。
   - 没有 workspace 时降级为 `discuss` 并给 warning。
4. `intentHint = review` 或检测到“review/审查/复审/检查当前改动”：
   - 单个或多个 review phase，mode = review/readOnly。
5. `intentHint = audit` 或检测到“大范围/全量/安全/性能/迁移”：
   - split/readOnly -> parallel audit -> synthesize。
   - 第一版不自动写。
6. 默认 quick：
   - 单 Agent。
   - 如果明显写入且 workspace ready，生成 plan -> implement。
   - 不明显写入则 readOnly quick answer。

Agent 选择规则：

1. 有 `mentionedAgentIds` 时，优先 specific。
2. phase 有 capabilities 时，匹配成员 capabilities。
3. 没匹配时按成员顺序 fallback。
4. `review` phase 不应默认选同一个 implementer；如果只有一个成员才允许复用。

验收：

- `node src/engine/agentWorkflowPlanner.test.mjs` 通过。
- 每个 intent 至少一个测试。
- 没有 workspace 的写任务会降级且带 warning。
- 并发数不超过 `group.workflowDefaults.maxParallelAgents`。

### PR 5：Workflow Runner

目标：执行 `AgentWorkflowPlan`，替代旧 strategy switch。

文件范围：

- `src/engine/agentWorkflowRunner.ts`
- `src/engine/agentWorkflowRunner.test.mjs`
- `src/engine/agentRuntime.ts`
- `package.json`

Runner API：

```ts
export interface AgentWorkflowRunnerCallbacks {
  onRunStart?: (run: AgentWorkflowRun) => void;
  onPlanUpdate?: (run: AgentWorkflowRun) => void;
  onPhaseStart?: (phase: AgentWorkflowPhase, state: AgentWorkflowPhaseState) => void;
  onPhaseEnd?: (phase: AgentWorkflowPhase, state: AgentWorkflowPhaseState) => void;
  onAgentStart: (agentId: string, agentName: string, meta?: { agentTaskId?: string; adapter?: string; phaseId?: string }) => void;
  onToken: (agentId: string, token: string, meta?: { phaseId?: string }) => void;
  onAgentEnd: (agentId: string, fullContent: string, meta?: { phaseId?: string }) => void;
  onError: (agentId: string, error: string, meta?: { phaseId?: string }) => void;
  onRunEnd?: (run: AgentWorkflowRun) => void;
}

export async function runAgentWorkflowPlan(
  group: AgentGroup,
  members: AIMember[],
  plan: AgentWorkflowPlan,
  userMessage: string,
  history: string,
  callbacks: AgentWorkflowRunnerCallbacks,
  options?: AgentWorkflowRunnerOptions,
): Promise<AgentWorkflowRun>;
```

执行规则：

1. 开始时创建 `AgentWorkflowRun`。
2. 按 `dependsOn` 拓扑顺序执行 phase。
3. `single` 只选 1 个 agent。
4. `parallel` 可多 agent，但如果 `mode === write` 且没有隔离能力，直接拒绝。
5. `sequential` 按成员顺序执行，后者看到前者 summary。
6. phase context 由以下内容组成：
   - 原始用户消息
   - 最近历史
   - 依赖 phase 的 summary/output
   - 当前 phase prompt
7. phase 完成后生成 `summary`：
   - 第一版可用简单截断/拼接，不调用 LLM。
   - 后续可新增 summarize phase。
8. `onFailure`：
   - `stop`：结束 run failed。
   - `continue`：记录错误继续。
   - `ask`：第一版按 stop 处理，并在 UI 提示。
9. AbortSignal：
   - 中断当前 agent。
   - run 状态为 `cancelled`。

验收：

- `node src/engine/agentWorkflowRunner.test.mjs` 通过。
- 单 phase/single 执行成功。
- parallel readOnly 执行多个 agent。
- parallel write 被拒绝。
- phase 失败按 policy 处理。
- abort 能把 run 标记为 cancelled。

### PR 6：AgentChatUI 接入 Plan -> Run

目标：发送消息后生成计划、展示计划卡、确认后运行，并保存 workflow run 元数据。

文件范围：

- `src/pages/chat/components/AgentChatUI.tsx`
- `src/pages/chat/components/AgentWorkflowPlanCard.tsx`
- `src/pages/chat/components/AgentWorkflowTimeline.tsx`
- `src/config/chatSessions.ts`
- `src/store/chatSessionStore.ts`
- `src/i18n/resources/zh-CN/chat.json`
- `src/i18n/resources/en-US/chat.json`

实施步骤：

1. 新增 `AgentWorkflowPlanCard`：
   - 显示 title、explanation、riskLevel、requiresApproval、phase 列表。
   - 按 phase 展示 mode/schedule/agent selection。
   - 操作按钮：运行、取消。
   - “修改计划”先不做或禁用，Phase 4 再接。
2. 新增 `AgentWorkflowTimeline`：
   - 展示 phase 状态：pending/running/completed/failed/cancelled。
   - 每个 phase 可展开看 agent 输出。
3. 修改 `AgentChatUI.handleSendMessage`：
   - 先创建用户消息。
   - 调 `planAgentWorkflow`。
   - 如果 `plan.requiresApproval || group.workflowDefaults.alwaysShowPlan`，插入计划卡状态，等待用户点击运行。
   - 否则直接运行。
4. 修改 callbacks：
   - agent bubble 仍照常流式显示。
   - meta 增加 phaseId，用于归类。
5. tool session：
   - 保留当前按 `group.id + sessionId + agentId + workspace` 的 key。
6. 持久化：
   - `ChatSessionMessage` 增加 `workflowRun?: AgentWorkflowRun` 或单独消息类型字段。
   - `sanitizeMessageForStorage` 保留 workflow run 的轻量字段，禁止保存巨大输出时无限增长。

验收：

- 只读计划可直接运行或显示计划卡，取决于 `alwaysShowPlan`。
- 写入计划默认显示计划卡。
- 点击运行后能看到 phase 进度和 agent 输出。
- 取消生成/运行能停止当前请求。
- 刷新后历史消息不会因 workflowRun 字段解析失败。

注意：

- 不要一次性重写整个 `AgentChatUI` 样式。
- 保持附件逻辑：`composeMessageWithAttachments` 仍作为 planner 和 runner 的 userMessage 输入。

### PR 7：删除旧 agentEngine 策略路径

目标：真正完成 clean refactor，避免两套协作系统并存。

文件范围：

- `src/engine/agentEngine.ts`
- `src/engine/agentEngine.test.mjs`
- `src/engine/blackboard.ts`
- `package.json`
- 全仓 `rg` 找到的旧 strategy 调用点

实施步骤：

1. 删除或重写 `src/engine/agentEngine.ts`：
   - 推荐只保留 deprecated re-export，或者直接删除并修正 import。
   - 不能保留 `executeAgentStrategy` 主调用。
2. 删除 `agentEngine.test.mjs`，用 planner/runner/runtime tests 替代。
3. 删除 `blackboard.ts`，除非新的 runner 明确使用它。
4. 更新 `package.json test:cli`：
   - 移除 `agentEngine.test.mjs`。
   - 加入 `agentRuntime.test.mjs`、`agentWorkflowPlanner.test.mjs`、`agentWorkflowRunner.test.mjs`。
5. 全仓检查：
   - `rg "executeAgentStrategy|AgentStrategy|runSequential|runDebate|runMapReduce|coordinatorPrompt|maxRounds|agentWorkflowTemplates" src`
   - 除 CLI 群自己的 `maxReviewRounds` 之类无关字段外，Agent 群旧字段应清零。

验收：

- `npm run test:cli` 通过。
- `npm run test:product` 通过。
- `npm run test:i18n` 通过。
- `npm run build` 通过。

### PR 8：计划编辑与 LLM Planner

目标：接近 Claude dynamic workflow 的体验：用户可以让系统重新规划。

文件范围：

- `src/engine/agentWorkflowPlanner.ts`
- `src/engine/agentWorkflowPlanner.llm.ts`
- `src/pages/chat/components/AgentWorkflowPlanCard.tsx`
- `src/utils/resolveLlmCredentials.ts`
- `src/utils/llmClient.ts`

实施步骤：

1. 新增 LLM planner，但保留规则 planner fallback。
2. LLM planner 只允许输出 `AgentWorkflowPlan` JSON。
3. 输出后必须过 `validateAgentWorkflowPlan`。
4. 规则安全修正：
   - 写入必须 approval。
   - max phases 上限。
   - max parallel agents 上限。
   - 不存在 agent id 自动移除。
   - workspace 不存在则写入 phase 降级为 readOnly planning。
5. 计划卡增加“修改计划”：
   - 用户输入自然语言约束。
   - planner 基于原计划重新生成。

验收：

- LLM 输出非法 JSON 时 fallback。
- LLM 选择不存在 agent 时被修正。
- 用户输入“不要改文件”后，所有 phase 都是 readOnly/review。

### PR 9：保存和复用 Workflow

目标：把一次成功的动态计划保存为可复用群规。

文件范围：

- `src/config/agentWorkflow.ts`
- `src/config/groupStorage.ts`
- `src/pages/chat/components/AgentGroupSettings.tsx`
- `src/pages/chat/components/AgentWorkflowPlanCard.tsx`
- 新增 `src/store/agentWorkflowTemplateStore.ts` 或复用 localStorage helper

模型：

```ts
export interface SavedAgentWorkflowTemplate {
  id: string;
  name: string;
  description?: string;
  groupId?: string;
  plan: AgentWorkflowPlan;
  createdAt: number;
  updatedAt: number;
}
```

实施步骤：

1. 完成 run 后，在 plan card 或 final summary 上提供“保存为群规”。
2. 保存时允许用户命名。
3. 群设置里展示已保存群规。
4. 输入区快捷意图旁可以选择已保存群规。

验收：

- 成功 run 可保存。
- 新会话可选择保存的 workflow 执行。
- 删除群时清理 group scoped workflow templates。

## 推荐执行顺序

严格串行：

1. PR 1 类型与文案
2. PR 2 创建群和设置面板
3. PR 3 runtime 抽取
4. PR 4 planner
5. PR 5 runner
6. PR 6 UI 接入
7. PR 7 删除旧策略

可并行：

- PR 4 planner 和 PR 5 runner 可以在 PR 3 之后由两个 agent 并行做，但需要先约定 `AgentWorkflowPlan` 和 runner callback API。
- PR 8 LLM planner 和 PR 9 保存复用必须等 PR 6/7 稳定后再做。

## 每个 PR 的交付要求

每个开发 agent 完成任务后必须提供：

- 改动摘要。
- 关键文件列表。
- 已运行测试命令和结果。
- 未覆盖风险。
- 如果改 UI，提供手工验证步骤。

每个 PR 至少跑：

```bash
npm run test:product
npm run test:i18n
```

涉及 engine 的 PR 额外跑：

```bash
npm run test:cli
```

最后整合 PR 跑：

```bash
npm run build
npm run test:cli
npm run test:product
npm run test:i18n
```

## 最小可用版本切线

如果需要先快速产出可用版本，做到 PR 1-6 即可：

- 用户不再配置旧策略。
- 系统能生成规则计划。
- 计划卡可审批。
- runner 能执行 single/sequential/parallel readOnly 和普通 write。
- 旧策略代码尚未完全删除，但主路径不再调用。

正式 clean refactor 必须完成 PR 7。

## 最终验收清单

- 新建 Agent 群无固定协作模式选择。
- 发送写入类任务时出现计划卡。
- 发送只读讨论时不会要求 workspace 写入。
- 多 Agent 并行只读可以执行。
- 并行写同 workspace 被阻止。
- 复审阶段优先选择有 `code-review` capability 的成员。
- `rg "executeAgentStrategy|AgentStrategy|agentWorkflowTemplates" src` 无主路径残留。
- `npm run build` 通过。
- `npm run test:cli` 通过。
- `npm run test:product` 通过。
- `npm run test:i18n` 通过。
