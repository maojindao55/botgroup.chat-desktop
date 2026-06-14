# Agent 规则规划器模板库设计

## 目标

专家群的默认规划模式是 `rule`（`agentWorkflowPlannerSettings` 默认值），但当前规则规划器
（`planAgentWorkflow`）无论输入什么都只产出一个单阶段 `quick` 计划。结果：**开箱即用的专家群
= 单 agent 问答**，产品宣传的"会诊/方案产出/评审决策/接力修改/自动处理"以及 verifier 循环、
retry 机制只有用户手动到全局设置开启 LLM planner 才会触发，而 onboarding 不提示。

本设计让规则规划器能按用户消息**自动识别意图**并产出真实的多阶段协作计划，让默认体验就配得上
"专家群"。LLM planner 出错回退到规则规划器时，也从"单 agent"升级为"富模板"，整体体验提升。

## 范围

- 重写 `planAgentWorkflow`（规则规划器）：意图分类 → 能力降级 → 模板分派。
- 新增模板库 `agentWorkflowTemplates.ts`：6 个模板工厂，覆盖只读讨论/多方案/审计 + 写入实现/
  改完复审（含 verifier 循环）。
- 新增选人 helper `resolveAgentSelection`：把声明式选人策略解析成具体 `agentIds`；顺手替换
  runner 里 `auto = slice(0, count)` 的桩，集中化选人（修掉 `auto` 忽略约束的问题）。
- 复活闲置的 `intentHint` 字段：`AgentChatUI` 加每条消息瞬时的意图选择，透传给两条 planner
  路径。
- 复用现有：runner 执行逻辑、verifier 重试机制、output policy、计划卡审批 UI。**只换 planner
  的"产计划"环节 + 一个 composer 控件 + runner 的 `auto` 那一行。**

不在范围内：LLM planner 自身的规划质量改进（few-shot 等）、计划直接编辑、并发闸/部分失败重试
（独立的鲁棒性工作）。

## 关键决策（已对齐）

1. **模板覆盖范围**：全覆盖（含写入 + verifier 循环），对齐产品宣传。写入类模板
   `requiresApproval=true`，复用现有审批闸。
2. **意图决定方式**：自动识别（关键词分类）+ 手动覆盖（输入区快捷选择，复用闲置的
   `workflowIntentPresets`）。
3. **手动覆盖持久化**：每条消息瞬时。发送后重置回 `smart`。不改群数据模型。
4. **架构方案**：模板工厂函数（A）+ 共享选人 helper。模板直接产出 `AgentWorkflowPhase`，
   无中间声明式层。

## §1 意图识别（`classifyIntent`）

纯函数 `classifyIntent(message, ctx): { intent, reason }`，零依赖、可单测。输出
`AgentWorkflowIntent`（`quick | discuss | multi_solution | implement | review | audit`），
`custom` 留给 LLM planner。

**关键词表（中/英双语，按优先级从高到低，命中即定）：**

- `review`：复审 / 审查 / 改完.*审 / 修复.*复审 / review.*then / then.*review
- `implement`：实现 / 写(一个|个) / 修改 / 修复 / 重构 / 新增 / 开发 / implement / develop /
  fix / refactor / build / write / create
- `multi_solution`：多(种|个)方案 / 分别.*方案 / 备选 / 对比方案 / alternatives / options /
  multiple solutions / compare approaches
- `audit`：审计 / 排查 / 排错 / diagnose / investigate / audit / troubleshoot
- `discuss`：讨论 / 分析 / 怎么看 / 看法 / 意见 / 评估 / brainstorm / discuss / analyze /
  opinion / thoughts
- `quick`：兜底

**优先级依据**：`review` 最高（"实现并复审"应走 review 而非 implement）；`implement` 先于
`discuss`（"分析并修复"是写不是聊）；`multi_solution`/`audit` 互不重叠；`discuss` 最宽泛放
低；无命中 → `quick`。

**能力降级（`degrade(intent, ctx)`，在分派前应用）：**

| 期望 intent | 触发条件 | 降级为 |
|---|---|---|
| discuss / multi_solution / audit | 成员 < 2 | `quick` |
| implement | 无 workspace | `quick` |
| review | 无 workspace | `audit`（只读复审） |
| review | 凑不出独立复审者（≤1 成员） | `implement`（去掉 verifier） |
| smart/quick | effort = `fast` 或 成员 < 2 | `quick`（单 agent） |
| smart/quick | effort = `standard`/`deep` 且 ≥2 成员 | `discuss`（默认升级为多专家） |

每条降级产出一条 warning（计划卡可见原因）。

**手动覆盖**：composer 意图选择默认 `smart`（=走分类器）；用户选具体意图时作为 `intentHint`
透传，**跳过关键词分类**，但仍经过能力降级（防止"2 人选了多方案"这类不可能组合）。`smart`
preset 不传 intentHint（=自动）；其余 preset 传对应 `AgentWorkflowIntent`。

## §2 模板清单

6 个模板工厂 `(ctx) => AgentWorkflowPlan`。记法：
`阶段名 | mode | schedule | 选人 | dependsOn | outputPolicy | onFailure | retry`。
`requiresApproval` 仅 write 类为 true。

**T1 · quick（单专家直答）** — 保留现有行为，向后兼容
```
回答 | readOnly | single | first | — | full | continue
```

**T2 · discuss（多专家会诊 → 汇总）**
```
P1 会诊 | readOnly | parallel | count:min(成员数, maxParallel) | — | summary | continue
P2 汇总 | readOnly | single | byRole:summarizer ∨ (排除 P1 的 first) | [P1] | full | stop
```

**T3 · multi_solution（多方案 → 对比）**
```
P1 出方案 | readOnly | parallel | count:min(成员数, maxParallel, 3) | — | full | continue
P2 对比综合 | readOnly | single | byRole:summarizer ∨ first | [P1] | full | stop
```
与 T2 同形，差异：P1 `outputPolicy=full`（保留每套方案细节供对比）、P2 prompt 是"对比优劣"而非
"求共识"。

**T4 · implement（写入实现）**
```
实现 | write | single | byRole:implementer ∨ first | — | diff | stop
```
单实现者（runner 本就拒绝 parallel+write）。`outputPolicy=diff` 让改动可见。

**T5 · review（改完复审 + verifier 循环）** — 对齐 CLI 群 `diagnoseFixReviewWorkflow`
```
P1 实现 | write | single | byRole:implementer ∨ first | — | diff | stop | retry:{maxAttempts:2}
P2 复审 | verifier | single | byRole:reviewer ∨ (排除 P1 的 first) | [P1] | findings | stop
```
P2 为 verifier 判 P1 是否达标；FAIL 触发 runner `triggerUpstreamRetry` 重跑 P1（1 次重试 =
maxAttempts 2）。复审者排除实现者，杜绝自审。

**T6 · audit（只读审计 → 风险汇总）**
```
P1 审计 | readOnly | parallel | all (上限 maxParallel) | — | findings | continue
P2 风险汇总 | readOnly | single | byRole:summarizer ∨ first | [P1] | full | stop
```
与 T2 同形，差异：P1 `outputPolicy=findings`（抽取问题清单）、审计向 prompt。

**通用约束：**
- 所有 `count`/`all` 经选人 helper 解析后写死成 `{type:'specific', agentIds}`，落盘计划是具体的、
  可复现的。
- `maxParallel` 来自 `group.workflowDefaults.maxParallelAgents`；阶段数受 `maxPhases` 上限
  （模板最多 2 阶段，远低于上限）。
- 失败语义：只读阶段 `onFailure=continue`（局部失败不阻塞汇总）；write/verifier 关键阶段
  `onFailure=stop`。
- 阶段 id 用稳定 slug（`consult`/`synthesize`/`implement`/`review`…），便于日志与 phase label
  回显。

## §3 选人 helper（`resolveAgentSelection`）

纯函数，把声明式策略解析成 `agentIds[]`。模板工厂用它产出 specific 计划；runner 的 `auto` 路径
也改用它，集中化选人。

**接口：**
```ts
type SelectionStrategy =
  | { kind: 'first' }
  | { kind: 'count'; n: number }
  | { kind: 'all' }
  | { kind: 'byRole'; role: 'implementer' | 'reviewer' | 'summarizer'; fallback?: 'first' };

resolveAgentSelection(
  strategy: SelectionStrategy,
  members: AIMember[],
  opts: { maxParallel: number; exclude?: string[] }
): string[]
```

**解析顺序**：先剔 `exclude` → 按 strategy 过滤/取数 → 截到 `maxParallel` → 返回（不报错，池不
够给现有的）。

**`byRole` 语义键 → 中/英子串映射**（模板用语义键，helper 负责本地化匹配；`member.role`
小写后含任一子串即命中，命中不足走 `fallback`）：

- `implementer` → implement/develop/engineer/write · 实现/开发/工程/编码/编写
- `reviewer` → review/audit/test · 审/复审/审查/评审/测试
- `summarizer` → summar/synthes/conclude/coordinator · 汇总/综合/总结/归纳/协调

**模板用法**：T5 复审者 = `byRole:reviewer` + `exclude:[P1 实现者]`；T2 汇总者 =
`byRole:summarizer` + `exclude:[P1 参与者]`；T1/T4 = `byRole:implementer ∨ first`。

**runner `auto` 修复**：`selectAgentsForPhase`（`agentWorkflowRunner.ts:127`）把
`members.slice(0, count)` 改为 `resolveAgentSelection({kind:'count', n:count}, members,
{maxParallel})`。规则模板的 specific 计划不走这条路径，但 LLM planner 产出的 `auto` 阶段因此
也走统一截断，行为一致。

**边界**：成员池为空 → 返回 `[]`（上层产 emptyPlan + 警告）；`exclude` 扣空池 → `[]`（如唯一
成员既当实现者又只能当复审者 → T5 由 §1 降级为 implement）。

## §4 接线

**规则 planner 内部流程（重写 `planAgentWorkflow`）：**
```
effectiveIntent =
  input.intentHint ? input.intentHint                  // 手动覆盖（smart preset 不传），跳过分类
  : classifyIntent(userMessage, ctx)                   // 自动
effectiveIntent = degrade(effectiveIntent, ctx)        // 能力降级
plan = templateBuilders[effectiveIntent](ctx)          // 分派到 §2 模板
return { plan, warnings: degradationReasons }
```
模板 ctx = `{ members, workspaceReady, maxPhases, maxParallel, locale, t }`。

**`intentHint` 透传（复活闲置字段）：**
- `AgentChatUI` 加 `selectedIntent` 状态，默认 `'smart'`；`handleSendMessage` 映射成
  `AgentWorkflowIntent` 作为 `intentHint` 传入 rule 与 LLM 两条 planner 路径。
- **每条消息瞬时**：发送后 `selectedIntent` 重置回 `'smart'`。
- LLM planner 侧：`buildUserPrompt` 当 intentHint 非 smart 时追加一行
  `User selected collaboration mode: X`，让手动覆盖也影响 LLM 规划。

**输入区控件（复用 `workflowIntentPresets`）：**
composer 左侧加一个紧凑"意图按钮"：显示当前模式（默认 `智能` + sparkle 图标），点击弹出 5 个
preset（含描述）。选中即设 `selectedIntent`（瞬时）。

**降级矩阵**：见 §1 表格；每条降级产出 warning，计划卡可见。

**LLM planner 回退**：`planAgentWorkflowSmart` 失败回到 rule planner——现在回退到富模板而非单
agent，这是顺带的最大体验提升。

**不改的部分**：runner 执行逻辑、verifier 重试、output policy、计划卡 UI 都复用现有。

## §5 错误处理与边界

- 成员池为空：planner 产 emptyPlan + warning（现有逻辑保留）。
- `exclude` 把池子扣空：helper 返回 `[]`；T5 由 §1 降级为 implement（去掉 verifier）。
- 无 workspace：write 类模板不会被执行（分类器已降级到只读形态）；即便 LLM planner 产出 write
  阶段，现有 `applySafetyRewrite` 仍会兜底降级为 readOnly。
- 阶段上限：模板 ≤2 阶段；`count`/`all` 经 helper 截到 `maxParallel`。
- 向后兼容：现有"简单输入 → 单阶段 quick"的测试用例必须继续通过——T1 保留原形状，分类器对无
  关键词输入在 `fast`/单成员时仍给 quick。

## §6 测试策略

沿用项目 `.mjs` 纯 node 断言测试模式，全部纯函数、零网络/零 LLM。

**新增测试文件：**

1. `agentWorkflowIntent.test.mjs` — `classifyIntent`：中/英关键词命中、优先级、降级、smart 升级。
2. `agentWorkflowTemplates.test.mjs` — 6 个模板工厂：阶段数/mode/schedule/dependsOn 合法/
   outputPolicy；T5 的 verifier + retry + requiresApproval；T2/T3/T6 的 P2 dependsOn P1；
   count 截到 maxParallel；落盘为 specific、可复现。
3. `agentWorkflowSelection.test.mjs` — `resolveAgentSelection`：first/count/all/byRole/exclude/
   maxParallel；byRole 中英命中 + fallback；池空 → `[]`；复审者排除实现者。

**扩展现有测试：**

4. `agentWorkflowPlanner.test.mjs`：新增 intentHint 覆盖、自动分类分派用例；保留现有单阶段
   quick 断言。
5. `agentWorkflow.test.mjs`：每个模板工厂产出过一遍 `validateAgentWorkflowPlan`。

**接线**：新测试加入 `package.json` 的 `test:product`（沿用 `node A && node B && …` 链式）。

**不单测**：composer 意图按钮渲染、Tauri 审批流、端到端执行（runner 已有测试覆盖）。LLM
planner 路径保持其独立测试不动。

## 影响文件

- 新增：`src/engine/agentWorkflowIntent.ts`（分类器）、
  `src/engine/agentWorkflowTemplates.ts`（6 个模板工厂）、
  `src/engine/agentWorkflowSelection.ts`（选人 helper）。
- 改：`src/engine/agentWorkflowPlanner.ts`（重写 `planAgentWorkflow` 为分派）、
  `src/engine/agentWorkflowPlanner.llm.ts`（`buildUserPrompt` 加 intentHint 行）、
  `src/engine/agentWorkflowRunner.ts`（`selectAgentsForPhase` 接 helper）、
  `src/pages/chat/components/AgentChatUI.tsx`（`selectedIntent` 状态 + 透传 + composer 控件）。
- 测试：上述 3 个新 `.test.mjs` + 扩展 2 个现有；`package.json` test:product 链。
- i18n：composer 意图标签复用现有 `workflowIntentPresets` 文案；新增模板的阶段 label/prompt 走
  zh/en（`agentWorkflow.planner.phases.*` 键），保持对称。
