# Agent 规则规划器模板库 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让专家群的默认（rule）规划器按消息自动识别意图并产出真实的多阶段协作计划（含写入与 verifier 循环），而非永远单 agent 问答。

**Architecture:** 三个新纯函数模块——意图分类 `agentWorkflowIntent.ts`、选人 `agentWorkflowSelection.ts`、模板库 `agentWorkflowTemplates.ts`；重写 `planAgentWorkflow` 为「意图→降级→模板分派」；runner 的 `auto` 选人改用共享 helper；composer 增加瞬时意图选择并透传 `intentHint`。全部复用现有 runner/verifier/output-policy/计划卡。

**Tech Stack:** TypeScript（纯函数引擎层）、React（composer 控件）、`.mjs` 纯 node 断言测试（沿用 `importTsModule` 即时转译模式）。

设计依据：`docs/superpowers/specs/2026-06-14-agent-rule-planner-templates-design.md`。

**关键测试约定**：本仓库的 `.mjs` 测试用 `importTsModule(url, transform)` 读取 `.ts` 源码、即时转译为 data URL 导入；`@/` 别名和兄弟 `.ts` 运行时依赖必须用 `transform` 内联或桩掉。`import type {...}` 在转译时被擦除，无需处理。

**关键行为变更（需更新一个旧测试）**：现有 `agentWorkflowPlanner.test.mjs` 中「fallback never emits write phases」用例编码了旧桩行为（永远只读）。本特性让 rule 规划器对 implement 意图产出 write 阶段——这正是本特性的目的，该用例必须更新为期望 write + requiresApproval。其余旧用例（mention 聚焦、空成员、quick 兜底）保持通过。

---

## 文件结构

新增（引擎层纯函数，零运行时外部依赖，便于 `.mjs` 测试）：
- `src/engine/agentWorkflowSelection.ts` — `resolveAgentSelection(strategy, members, opts)`：声明式选人 → agentIds。
- `src/engine/agentWorkflowIntent.ts` — `classifyIntent(message)` + `degradeIntent(intent, ctx)`。
- `src/engine/agentWorkflowTemplates.ts` — 6 个模板工厂 + `templateBuilders` 映射 + `TemplateContext`。

修改：
- `src/engine/agentWorkflowPlanner.ts` — 重写 `planAgentWorkflow` 为分派；保留 mention 聚焦路径。
- `src/engine/agentWorkflowPlanner.llm.ts` — `buildUserPrompt` 追加 intentHint 行。
- `src/engine/agentWorkflowRunner.ts` — `selectAgentsForPhase` 的 `auto` 分支接 `resolveAgentSelection`。
- `src/pages/chat/components/AgentChatUI.tsx` — `selectedIntent` 状态、透传 `intentHint`、发送后重置、composer 意图按钮。
- `src/i18n/resources/{zh-CN,en-US}/chat.json` — 新增模板阶段 label/prompt 键（对称）。
- `package.json` — `test:product` 链加入 3 个新测试。

测试：
- 新增 `src/engine/agentWorkflowSelection.test.mjs`、`agentWorkflowIntent.test.mjs`、`agentWorkflowTemplates.test.mjs`。
- 扩展 `src/engine/agentWorkflowPlanner.test.mjs`（更新 write 用例 + 新增 intent 分派用例）。
- 扩展 `src/engine/agentWorkflowRunner.test.mjs`（auto 选人接 helper）。

---

## Task 1: 选人 helper `resolveAgentSelection`

**Files:**
- Create: `src/engine/agentWorkflowSelection.ts`
- Test: `src/engine/agentWorkflowSelection.test.mjs`

- [ ] **Step 1: 写失败测试 `src/engine/agentWorkflowSelection.test.mjs`**

```javascript
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function importTsModule(url) {
  const source = await readFile(url, 'utf8');
  const compiled = ts.transpileModule(`${source}\n// cache-bust:${Date.now()}`, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  });
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`;
  return import(moduleUrl);
}

const { resolveAgentSelection } = await importTsModule(
  new URL('./agentWorkflowSelection.ts', import.meta.url),
);

function m(id, role) {
  return { id, name: id.toUpperCase(), kind: 'agent', role };
}
const members = [m('a', 'implementer'), m('b', 'reviewer'), m('c', '后端工程师'), m('d', 'summarizer')];

// first
assert.deepEqual(resolveAgentSelection({ kind: 'first' }, members, { maxParallel: 3 }), ['a']);

// count capped by maxParallel
assert.deepEqual(resolveAgentSelection({ kind: 'count', n: 5 }, members, { maxParallel: 2 }), ['a', 'b']);

// count smaller than maxParallel
assert.deepEqual(resolveAgentSelection({ kind: 'count', n: 2 }, members, { maxParallel: 3 }), ['a', 'b']);

// all capped
assert.deepEqual(resolveAgentSelection({ kind: 'all' }, members, { maxParallel: 2 }), ['a', 'b']);

// byRole: reviewer (en)
assert.deepEqual(resolveAgentSelection({ kind: 'byRole', role: 'reviewer' }, members, { maxParallel: 3 }), ['b']);

// byRole: implementer matches zh role '后端工程师' (contains '工程')
assert.deepEqual(resolveAgentSelection({ kind: 'byRole', role: 'implementer' }, [m('c', '后端工程师'), m('b', 'reviewer')], { maxParallel: 3 }), ['c']);

// byRole: no match -> fallback first
assert.deepEqual(resolveAgentSelection({ kind: 'byRole', role: 'summarizer' }, [m('a', 'implementer'), m('b', 'reviewer')], { maxParallel: 3 }), ['a']);

// exclude removes ids then first
assert.deepEqual(resolveAgentSelection({ kind: 'first' }, members, { maxParallel: 3, exclude: ['a'] }), ['b']);

// byRole with exclude -> b excluded, no other reviewer, fallback first among non-excluded = a
assert.deepEqual(resolveAgentSelection({ kind: 'byRole', role: 'reviewer' }, members, { maxParallel: 3, exclude: ['b'] }), ['a']);

// empty pool -> []
assert.deepEqual(resolveAgentSelection({ kind: 'first' }, members, { maxParallel: 3, exclude: ['a', 'b', 'c', 'd'] }), []);

console.log('agentWorkflowSelection.test.mjs: ok');
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node src/engine/agentWorkflowSelection.test.mjs`
Expected: 失败（模块不存在 / `resolveAgentSelection` 未定义）。

- [ ] **Step 3: 实现 `src/engine/agentWorkflowSelection.ts`**

```typescript
import type { AIMember } from '@/config/aiMembers';

export type SelectionRole = 'implementer' | 'reviewer' | 'summarizer';

export type SelectionStrategy =
  | { kind: 'first' }
  | { kind: 'count'; n: number }
  | { kind: 'all' }
  | { kind: 'byRole'; role: SelectionRole; fallback?: 'first' };

const ROLE_KEYWORDS: Record<SelectionRole, string[]> = {
  implementer: ['implement', 'develop', 'engineer', 'write', '实现', '开发', '工程', '编码', '编写'],
  reviewer: ['review', 'audit', 'test', '审', '复审', '审查', '评审', '测试'],
  summarizer: ['summar', 'synthes', 'conclude', 'coordinator', '汇总', '综合', '总结', '归纳', '协调'],
};

/**
 * 把声明式选人策略解析成具体 agentIds。
 * 解析顺序：剔除 exclude → 按 strategy 取数 → 截到 maxParallel。
 * byRole 用于单专家槽位（实现者/复审者/汇总者），返回首个命中；无命中走 fallback first。
 * 不报错；池不足则返回现有的。
 */
export function resolveAgentSelection(
  strategy: SelectionStrategy,
  members: AIMember[],
  opts: { maxParallel: number; exclude?: string[] },
): string[] {
  const exclude = new Set(opts.exclude || []);
  const pool = (members || []).filter(m => m && m.id && !exclude.has(m.id));
  const cap = Math.max(1, opts.maxParallel || 1);

  if (strategy.kind === 'first') {
    return pool.slice(0, 1).map(m => m.id);
  }
  if (strategy.kind === 'count') {
    const n = Math.max(1, Math.floor(strategy.n) || 1);
    return pool.slice(0, Math.min(n, cap)).map(m => m.id);
  }
  if (strategy.kind === 'all') {
    return pool.slice(0, cap).map(m => m.id);
  }

  // byRole：单专家槽位，返回首个命中
  const keywords = ROLE_KEYWORDS[strategy.role] || [];
  const matched = pool.filter(m => {
    const role = String((m as { role?: string }).role || '').toLowerCase();
    return keywords.some(kw => role.includes(kw));
  });
  if (matched.length > 0) return [matched[0].id];
  if (strategy.fallback === undefined || strategy.fallback === 'first') {
    return pool.slice(0, 1).map(m => m.id);
  }
  return [];
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node src/engine/agentWorkflowSelection.test.mjs`
Expected: `agentWorkflowSelection.test.mjs: ok`

- [ ] **Step 5: typecheck**

Run: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"`
Expected: 与基线一致（不引入新错误；本文件零运行时外部依赖，`import type` 被擦除）。

- [ ] **Step 6: 提交**

```bash
git add src/engine/agentWorkflowSelection.ts src/engine/agentWorkflowSelection.test.mjs
git commit -m "feat(agent-workflow): add resolveAgentSelection helper"
```

---

## Task 2: 意图分类 `classifyIntent` + `degradeIntent`

**Files:**
- Create: `src/engine/agentWorkflowIntent.ts`
- Test: `src/engine/agentWorkflowIntent.test.mjs`

- [ ] **Step 1: 写失败测试 `src/engine/agentWorkflowIntent.test.mjs`**

```javascript
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function importTsModule(url) {
  const source = await readFile(url, 'utf8');
  const compiled = ts.transpileModule(`${source}\n// cache-bust:${Date.now()}`, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  });
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`;
  return import(moduleUrl);
}

const { classifyIntent, degradeIntent } = await importTsModule(
  new URL('./agentWorkflowIntent.ts', import.meta.url),
);

// 中文关键词
assert.equal(classifyIntent('帮我修复这个 bug'), 'implement');
assert.equal(classifyIntent('大家讨论一下这个方案'), 'discuss');
assert.equal(classifyIntent('给几种方案对比一下'), 'multi_solution');
assert.equal(classifyIntent('帮我排查这个报错'), 'audit');
assert.equal(classifyIntent('实现完帮我复审一下'), 'review');
assert.equal(classifyIntent('你好'), 'quick');

// 英文关键词
assert.equal(classifyIntent('please implement a login page'), 'implement');
assert.equal(classifyIntent("let's discuss the architecture"), 'discuss');
assert.equal(classifyIntent('give me a few alternatives'), 'multi_solution');
assert.equal(classifyIntent('investigate the crash'), 'audit');
assert.equal(classifyIntent('fix it then review'), 'review');

// 优先级：分析并修复 -> implement（implement 压 discuss）
assert.equal(classifyIntent('分析一下并修复这个问题'), 'implement');
// 优先级：实现并复审 -> review（review 压 implement）
assert.equal(classifyIntent('实现这个功能然后复审'), 'review');

// 兜底
assert.equal(classifyIntent(''), 'quick');
assert.equal(classifyIntent('   '), 'quick');

// degrade
const ws = { memberCount: 3, workspaceReady: true };
assert.equal(degradeIntent('discuss', { ...ws, memberCount: 1 }).intent, 'quick');
assert.equal(degradeIntent('multi_solution', { ...ws, memberCount: 1 }).intent, 'quick');
assert.equal(degradeIntent('audit', { ...ws, memberCount: 1 }).intent, 'quick');
assert.equal(degradeIntent('implement', { workspaceReady: false, memberCount: 2 }).intent, 'quick');
assert.equal(degradeIntent('review', { workspaceReady: false, memberCount: 2 }).intent, 'audit');
assert.equal(degradeIntent('review', { workspaceReady: true, memberCount: 1 }).intent, 'implement');
assert.equal(degradeIntent('discuss', ws).intent, 'discuss');
assert.equal(degradeIntent('discuss', ws).reason, undefined);

console.log('agentWorkflowIntent.test.mjs: ok');
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node src/engine/agentWorkflowIntent.test.mjs`
Expected: 失败（模块未定义）。

- [ ] **Step 3: 实现 `src/engine/agentWorkflowIntent.ts`**

```typescript
import type { AgentWorkflowIntent } from '@/config/agentWorkflow';

interface KeywordSet {
  intent: AgentWorkflowIntent;
  patterns: RegExp[];
}

// 按优先级从高到低；命中即定。
const KEYWORDS: KeywordSet[] = [
  { intent: 'review', patterns: [/复审|审查|改完.*审|修复.*复审|review.*then|then.*review/i] },
  {
    intent: 'implement',
    patterns: [/实现|修改|修复|重构|新增|开发|编写|写代码|写一个|写个|implement|develop|fix|refactor|build|write|create/i],
  },
  {
    intent: 'multi_solution',
    patterns: [/多(?:种|个)方案|分别.*方案|备选|对比方案|alternatives|options|multiple solutions|compare approaches/i],
  },
  { intent: 'audit', patterns: [/审计|排查|排错|diagnose|investigate|audit|troubleshoot/i] },
  { intent: 'discuss', patterns: [/讨论|分析|怎么看|看法|意见|评估|brainstorm|discuss|analyze|opinion|thoughts/i] },
];

/** 关键词意图分类。无命中返回 'quick'。纯函数、零依赖。 */
export function classifyIntent(message: string): AgentWorkflowIntent {
  const text = message || '';
  for (const { intent, patterns } of KEYWORDS) {
    if (patterns.some(re => re.test(text))) return intent;
  }
  return 'quick';
}

export interface DegradeContext {
  memberCount: number;
  workspaceReady: boolean;
}

export interface DegradeResult {
  intent: AgentWorkflowIntent;
  reason?: string;
}

/** 能力降级：成员不足 / 无 workspace 时把不可能的 intent 降到可行形态。 */
export function degradeIntent(intent: AgentWorkflowIntent, ctx: DegradeContext): DegradeResult {
  const needsMany = intent === 'discuss' || intent === 'multi_solution' || intent === 'audit';
  if (needsMany && ctx.memberCount < 2) {
    return { intent: 'quick', reason: 'not enough members for collaboration' };
  }
  if (intent === 'implement' && !ctx.workspaceReady) {
    return { intent: 'quick', reason: 'no workspace; implement downgraded to quick' };
  }
  if (intent === 'review' && !ctx.workspaceReady) {
    return { intent: 'audit', reason: 'no workspace; review downgraded to read-only audit' };
  }
  if (intent === 'review' && ctx.memberCount < 2) {
    return { intent: 'implement', reason: 'cannot pick a distinct reviewer; dropping verifier' };
  }
  return { intent };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node src/engine/agentWorkflowIntent.test.mjs`
Expected: `agentWorkflowIntent.test.mjs: ok`

- [ ] **Step 5: typecheck**

Run: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"`
Expected: 基线一致（`import type` 被擦除，无新错误）。

- [ ] **Step 6: 提交**

```bash
git add src/engine/agentWorkflowIntent.ts src/engine/agentWorkflowIntent.test.mjs
git commit -m "feat(agent-workflow): add intent classifier and degrade rules"
```

---

## Task 3: 模板库 `agentWorkflowTemplates.ts`

**Files:**
- Create: `src/engine/agentWorkflowTemplates.ts`
- Test: `src/engine/agentWorkflowTemplates.test.mjs`

**测试 transform 说明**：模板导入 `resolveAgentSelection`（运行时）与 `import type` 配置类型（转译擦除）。测试 transform 把 `agentWorkflowSelection.ts` 源码内联进模板源码（去掉双方的 import 语句），再转译。

- [ ] **Step 1: 写失败测试 `src/engine/agentWorkflowTemplates.test.mjs`**

```javascript
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function importTsModule(url, transform = s => s) {
  const source = transform(await readFile(url, 'utf8'));
  const compiled = ts.transpileModule(`${source}\n// cache-bust:${Date.now()}`, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  });
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`;
  return import(moduleUrl);
}

// 内联 selection helper：读两个文件，去掉 import 行后拼接
const selectionSrc = await readFile(new URL('./agentWorkflowSelection.ts', import.meta.url), 'utf8');
const selectionBody = selectionSrc
  .replace(/import type \{[^}]*\} from '@\/config\/aiMembers';\n/, '');

const { templateBuilders } = await importTsModule(
  new URL('./agentWorkflowTemplates.ts', import.meta.url),
  (src) => src
    .replace(/import \{ resolveAgentSelection \} from '\.\/agentWorkflowSelection';\n/, '')
    .replace(/import type \{[^}]*\} from '@\/config\/agentWorkflow';\n/, '')
    + '\n' + selectionBody,
);

function mem(id, role) { return { id, name: id.toUpperCase(), kind: 'agent', role }; }
const three = [mem('a', 'implementer'), mem('b', 'reviewer'), mem('c', 'analyst')];
const ctx = (overrides = {}) => ({
  members: three, workspaceReady: true, maxParallel: 3, maxPhases: 5, locale: 'zh', t: undefined,
  ...overrides,
});

// T1 quick：单阶段 readOnly single
{
  const plan = templateBuilders.quick(ctx({ members: [mem('a', 'x')] }));
  assert.equal(plan.phases.length, 1);
  assert.equal(plan.phases[0].mode, 'readOnly');
  assert.equal(plan.phases[0].schedule, 'single');
  assert.equal(plan.requiresApproval, false);
  assert.deepEqual(plan.phases[0].agentSelection.agentIds, ['a']);
}

// T2 discuss：P1 parallel consult -> P2 synthesize, P2 dependsOn P1
{
  const plan = templateBuilders.discuss(ctx());
  assert.equal(plan.phases.length, 2);
  assert.equal(plan.phases[0].schedule, 'parallel');
  assert.equal(plan.phases[0].mode, 'readOnly');
  assert.deepEqual(plan.phases[1].dependsOn, [plan.phases[0].id]);
  // 汇总者排除 P1 参与者
  const consultIds = plan.phases[0].agentSelection.agentIds;
  assert.ok(!consultIds.includes(plan.phases[1].agentSelection.agentIds[0]));
  assert.equal(plan.requiresApproval, false);
}

// T3 multi_solution：P1 outputPolicy full
{
  const plan = templateBuilders.multi_solution(ctx());
  assert.equal(plan.phases.length, 2);
  assert.equal(plan.phases[0].schedule, 'parallel');
  assert.equal(plan.phases[0].outputPolicy, 'full');
  assert.deepEqual(plan.phases[1].dependsOn, [plan.phases[0].id]);
}

// T4 implement：单 write 阶段，requiresApproval true，outputPolicy diff
{
  const plan = templateBuilders.implement(ctx());
  assert.equal(plan.phases.length, 1);
  assert.equal(plan.phases[0].mode, 'write');
  assert.equal(plan.phases[0].schedule, 'single');
  assert.equal(plan.phases[0].outputPolicy, 'diff');
  assert.equal(plan.requiresApproval, true);
}

// T5 review：P1 write + retry, P2 verifier dependsOn P1
{
  const plan = templateBuilders.review(ctx());
  assert.equal(plan.phases.length, 2);
  assert.equal(plan.phases[0].mode, 'write');
  assert.equal(plan.phases[0].retry.maxAttempts, 2);
  assert.equal(plan.phases[1].mode, 'verifier');
  assert.deepEqual(plan.phases[1].dependsOn, [plan.phases[0].id]);
  assert.equal(plan.requiresApproval, true);
  // 复审者排除实现者
  assert.ok(plan.phases[0].agentSelection.agentIds[0] !== plan.phases[1].agentSelection.agentIds[0]);
}

// T6 audit：P1 parallel findings -> P2 synthesize
{
  const plan = templateBuilders.audit(ctx());
  assert.equal(plan.phases.length, 2);
  assert.equal(plan.phases[0].schedule, 'parallel');
  assert.equal(plan.phases[0].outputPolicy, 'findings');
  assert.deepEqual(plan.phases[1].dependsOn, [plan.phases[0].id]);
}

// count 截到 maxParallel
{
  const plan = templateBuilders.discuss(ctx({ maxParallel: 2 }));
  assert.ok(plan.phases[0].agentSelection.agentIds.length <= 2);
}

console.log('agentWorkflowTemplates.test.mjs: ok');
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node src/engine/agentWorkflowTemplates.test.mjs`
Expected: 失败（模块未定义）。

- [ ] **Step 3: 实现 `src/engine/agentWorkflowTemplates.ts`**

```typescript
import type { AIMember } from '@/config/aiMembers';
import type {
  AgentWorkflowIntent,
  AgentWorkflowPhase,
  AgentWorkflowPlan,
} from '@/config/agentWorkflow';
import { resolveAgentSelection, type SelectionRole, type SelectionStrategy } from './agentWorkflowSelection';

export interface TemplateContext {
  members: AIMember[];
  workspaceReady: boolean;
  maxParallel: number;
  maxPhases: number;
  locale?: string;
  t?: (key: string, options?: Record<string, unknown>) => string;
}

const PREFIX = 'chat:agentWorkflow.planner';

function tr(ctx: TemplateContext, key: string, opts?: Record<string, unknown>): string {
  if (ctx.t) {
    const v = ctx.t(key, opts);
    if (typeof v === 'string' && v !== key) return v;
  }
  return key;
}

function specific(agentIds: string[]): AgentWorkflowPhase['agentSelection'] {
  return { type: 'specific', agentIds };
}

function pick(ctx: TemplateContext, strategy: SelectionStrategy, exclude?: string[]): string[] {
  return resolveAgentSelection(strategy, ctx.members, { maxParallel: ctx.maxParallel, exclude });
}

// ---- T1 quick ----
function buildQuick(ctx: TemplateContext): AgentWorkflowPlan {
  const agentIds = pick(ctx, { kind: 'first' });
  return {
    version: 1,
    title: tr(ctx, `${PREFIX}.intents.quick.title`),
    intent: 'quick',
    riskLevel: 'low',
    requiresApproval: false,
    explanation: tr(ctx, `${PREFIX}.intents.quick.explanation`),
    phases: [
      {
        id: 'answer',
        label: tr(ctx, `${PREFIX}.phases.answer.label`),
        mode: 'readOnly',
        schedule: 'single',
        agentSelection: specific(agentIds),
        prompt: tr(ctx, `${PREFIX}.phases.answer.prompt`),
        outputPolicy: 'full',
        onFailure: 'continue',
      },
    ],
  };
}

function synthesizePhase(ctx: TemplateContext, dependsOn: string, exclude?: string[]): AgentWorkflowPhase {
  const synthIds = pick(ctx, { kind: 'byRole', role: 'summarizer' as SelectionRole }, exclude);
  return {
    id: 'synthesize',
    label: tr(ctx, `${PREFIX}.phases.synthesize.label`),
    mode: 'readOnly',
    schedule: 'single',
    agentSelection: specific(synthIds),
    prompt: tr(ctx, `${PREFIX}.phases.synthesize.prompt`),
    dependsOn: [dependsOn],
    outputPolicy: 'full',
    onFailure: 'stop',
  };
}

// ---- T2 discuss ----
function buildDiscuss(ctx: TemplateContext): AgentWorkflowPlan {
  const consultIds = pick(ctx, { kind: 'count', n: ctx.members.length });
  return {
    version: 1,
    title: tr(ctx, `${PREFIX}.intents.discuss.title`),
    intent: 'discuss',
    riskLevel: 'low',
    requiresApproval: false,
    explanation: tr(ctx, `${PREFIX}.intents.discuss.explanation`),
    phases: [
      {
        id: 'consult',
        label: tr(ctx, `${PREFIX}.phases.consult.label`),
        mode: 'readOnly',
        schedule: 'parallel',
        agentSelection: specific(consultIds),
        prompt: tr(ctx, `${PREFIX}.phases.consult.prompt`),
        outputPolicy: 'summary',
        onFailure: 'continue',
      },
      synthesizePhase(ctx, 'consult', consultIds),
    ],
  };
}

// ---- T3 multi_solution ----
function buildMultiSolution(ctx: TemplateContext): AgentWorkflowPlan {
  const n = Math.min(ctx.members.length, ctx.maxParallel, 3);
  const proposeIds = pick(ctx, { kind: 'count', n });
  return {
    version: 1,
    title: tr(ctx, `${PREFIX}.intents.multi_solution.title`),
    intent: 'multi_solution',
    riskLevel: 'low',
    requiresApproval: false,
    explanation: tr(ctx, `${PREFIX}.intents.multi_solution.explanation`),
    phases: [
      {
        id: 'propose',
        label: tr(ctx, `${PREFIX}.phases.propose.label`),
        mode: 'readOnly',
        schedule: 'parallel',
        agentSelection: specific(proposeIds),
        prompt: tr(ctx, `${PREFIX}.phases.propose.prompt`),
        outputPolicy: 'full',
        onFailure: 'continue',
      },
      {
        id: 'compare',
        label: tr(ctx, `${PREFIX}.phases.compare.label`),
        mode: 'readOnly',
        schedule: 'single',
        agentSelection: specific(pick(ctx, { kind: 'byRole', role: 'summarizer' as SelectionRole })),
        prompt: tr(ctx, `${PREFIX}.phases.compare.prompt`),
        dependsOn: ['propose'],
        outputPolicy: 'full',
        onFailure: 'stop',
      },
    ],
  };
}

// ---- T4 implement ----
function buildImplement(ctx: TemplateContext): AgentWorkflowPlan {
  const implIds = pick(ctx, { kind: 'byRole', role: 'implementer' as SelectionRole });
  return {
    version: 1,
    title: tr(ctx, `${PREFIX}.intents.implement.title`),
    intent: 'implement',
    riskLevel: 'medium',
    requiresApproval: true,
    explanation: tr(ctx, `${PREFIX}.intents.implement.explanation`),
    phases: [
      {
        id: 'implement',
        label: tr(ctx, `${PREFIX}.phases.implement.label`),
        mode: 'write',
        schedule: 'single',
        agentSelection: specific(implIds),
        prompt: tr(ctx, `${PREFIX}.phases.implement.prompt`),
        outputPolicy: 'diff',
        onFailure: 'stop',
      },
    ],
  };
}

// ---- T5 review (implement -> verifier loop) ----
function buildReview(ctx: TemplateContext): AgentWorkflowPlan {
  const implIds = pick(ctx, { kind: 'byRole', role: 'implementer' as SelectionRole });
  const reviewerIds = pick(ctx, { kind: 'byRole', role: 'reviewer' as SelectionRole }, implIds);
  return {
    version: 1,
    title: tr(ctx, `${PREFIX}.intents.review.title`),
    intent: 'review',
    riskLevel: 'medium',
    requiresApproval: true,
    explanation: tr(ctx, `${PREFIX}.intents.review.explanation`),
    phases: [
      {
        id: 'implement',
        label: tr(ctx, `${PREFIX}.phases.implement.label`),
        mode: 'write',
        schedule: 'single',
        agentSelection: specific(implIds),
        prompt: tr(ctx, `${PREFIX}.phases.implement.prompt`),
        outputPolicy: 'diff',
        onFailure: 'stop',
        retry: { maxAttempts: 2 },
      },
      {
        id: 'verify',
        label: tr(ctx, `${PREFIX}.phases.verify.label`),
        mode: 'verifier',
        schedule: 'single',
        agentSelection: specific(reviewerIds),
        prompt: tr(ctx, `${PREFIX}.phases.verify.prompt`),
        dependsOn: ['implement'],
        outputPolicy: 'findings',
        onFailure: 'stop',
      },
    ],
  };
}

// ---- T6 audit ----
function buildAudit(ctx: TemplateContext): AgentWorkflowPlan {
  const auditIds = pick(ctx, { kind: 'all' });
  return {
    version: 1,
    title: tr(ctx, `${PREFIX}.intents.audit.title`),
    intent: 'audit',
    riskLevel: 'low',
    requiresApproval: false,
    explanation: tr(ctx, `${PREFIX}.intents.audit.explanation`),
    phases: [
      {
        id: 'audit',
        label: tr(ctx, `${PREFIX}.phases.audit.label`),
        mode: 'readOnly',
        schedule: 'parallel',
        agentSelection: specific(auditIds),
        prompt: tr(ctx, `${PREFIX}.phases.audit.prompt`),
        outputPolicy: 'findings',
        onFailure: 'continue',
      },
      synthesizePhase(ctx, 'audit'),
    ],
  };
}

export const templateBuilders: Record<AgentWorkflowIntent, (ctx: TemplateContext) => AgentWorkflowPlan> = {
  quick: buildQuick,
  discuss: buildDiscuss,
  multi_solution: buildMultiSolution,
  implement: buildImplement,
  review: buildReview,
  audit: buildAudit,
};
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node src/engine/agentWorkflowTemplates.test.mjs`
Expected: `agentWorkflowTemplates.test.mjs: ok`

- [ ] **Step 5: typecheck**

Run: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"`
Expected: 基线一致（无新错误）。

- [ ] **Step 6: 提交**

```bash
git add src/engine/agentWorkflowTemplates.ts src/engine/agentWorkflowTemplates.test.mjs
git commit -m "feat(agent-workflow): add 6 rule-planner workflow templates"
```

---

## Task 4: 重写 `planAgentWorkflow` 为意图分派

**Files:**
- Modify: `src/engine/agentWorkflowPlanner.ts`
- Modify (extend): `src/engine/agentWorkflowPlanner.test.mjs`

**说明**：保留 mention 聚焦路径（旧 `@点名` 行为，所有 mention 相关旧用例继续通过）；非 mention 输入走 `intentHint ?? classifyIntent → degrade → template`。更新「never writes」用例为期望 write + requiresApproval（这是本特性目的）。

- [ ] **Step 1: 扩展测试 `src/engine/agentWorkflowPlanner.test.mjs`**

先更新 `importTsModule` 的 transform 以内联新依赖。把现有的：

```javascript
const { planAgentWorkflow, planAgentWorkflowSmart } = await importTsModule(
  new URL('./agentWorkflowPlanner.ts', import.meta.url),
  source => source.replace(
    "import {\n  createDefaultAgentWorkflowDefaults,\n  type AgentWorkflowPlan,\n  type AgentWorkflowIntent,\n} from '@/config/agentWorkflow';",
    `const createDefaultAgentWorkflowDefaults = () => ({ effort: 'standard', maxPhases: 5, maxParallelAgents: 3, alwaysShowPlan: false });`,
  ),
);
```

替换为（内联 intent + templates + selection，并保留 config 桩）：

```javascript
const selectionSrc = await readFile(new URL('./agentWorkflowSelection.ts', import.meta.url), 'utf8');
const selectionBody = selectionSrc.replace(/import type \{[^}]*\} from '@\/config\/aiMembers';\n/, '');
const intentSrc = await readFile(new URL('./agentWorkflowIntent.ts', import.meta.url), 'utf8');
const intentBody = intentSrc.replace(/import type \{[^}]*\} from '@\/config\/agentWorkflow';\n/, '');
const templatesSrc = await readFile(new URL('./agentWorkflowTemplates.ts', import.meta.url), 'utf8');
const templatesBody = templatesSrc
  .replace(/import type \{[^}]*\} from '@\/config\/aiMembers';\n/, '')
  .replace(/import type \{[^}]*\} from '@\/config\/agentWorkflow';\n/, '')
  .replace(/import \{ resolveAgentSelection,[^}]*\} from '\.\/agentWorkflowSelection';\n/, '')
  .replace(/import \{ resolveAgentSelection \} from '\.\/agentWorkflowSelection';\n/, '');

const { planAgentWorkflow, planAgentWorkflowSmart } = await importTsModule(
  new URL('./agentWorkflowPlanner.ts', import.meta.url),
  source => source
    .replace(
      "import {\n  createDefaultAgentWorkflowDefaults,\n  type AgentWorkflowPlan,\n  type AgentWorkflowIntent,\n} from '@/config/agentWorkflow';",
      `const createDefaultAgentWorkflowDefaults = () => ({ effort: 'standard', maxPhases: 5, maxParallelAgents: 3, alwaysShowPlan: false });`,
    )
    .replace(/import \{ classifyIntent, degradeIntent \} from '\.\/agentWorkflowIntent';\n/, '')
    .replace(/import \{ templateBuilders[^}]*\} from '\.\/agentWorkflowTemplates';\n/, '')
    .replace(/import \{[^}]*\} from '\.\/agentWorkflowSelection';\n/, '')
    + '\n' + selectionBody + '\n' + intentBody + '\n' + templatesBody,
);
```

然后**更新**「fallback never emits write phases」用例（从期望只读改为期望 write）：

```javascript
// ---------- implement intent with workspace -> write phase, requires approval ----------
{
  const members = [llm('a', 'A')];
  const { plan } = planAgentWorkflow({
    group: group(), members,
    userMessage: 'please implement a dark mode toggle and fix the login bug',
    workspaceReady: true,
  });
  assert.equal(plan.phases.length, 1);
  assert.equal(plan.phases[0].mode, 'write');
  assert.equal(plan.requiresApproval, true);
}
```

**新增** intent 分派用例（追加到 `console.log` 前）：

```javascript
// ---------- discuss keyword + 3 members -> 2-phase consult/synthesize ----------
{
  const members = [llm('a', 'A'), llm('b', 'B'), llm('c', 'C')];
  const { plan } = planAgentWorkflow({
    group: group(), members, userMessage: '大家讨论一下这个方案', workspaceReady: false,
  });
  assert.equal(plan.intent, 'discuss');
  assert.equal(plan.phases.length, 2);
  assert.equal(plan.phases[0].schedule, 'parallel');
  assert.deepEqual(plan.phases[1].dependsOn, [plan.phases[0].id]);
}

// ---------- intentHint override bypasses classification ----------
{
  const members = [llm('a', 'A'), llm('b', 'B'), llm('c', 'C')];
  const { plan } = planAgentWorkflow({
    group: group(), members, userMessage: '你好', workspaceReady: true, intentHint: 'implement',
  });
  assert.equal(plan.intent, 'implement');
  assert.equal(plan.phases[0].mode, 'write');
  assert.equal(plan.requiresApproval, true);
}

// ---------- discuss keyword with 1 member -> degraded to quick ----------
{
  const members = [llm('a', 'A')];
  const { plan, warnings } = planAgentWorkflow({
    group: group(), members, userMessage: '讨论一下吧', workspaceReady: false,
  });
  assert.equal(plan.intent, 'quick');
  assert.equal(plan.phases.length, 1);
  assert.ok(warnings.length > 0);
}
```

保留其余现有用例（mention 聚焦、空成员、quick 兜底、smart 无 llm 回退）不变。

- [ ] **Step 2: 运行测试确认失败**

Run: `node src/engine/agentWorkflowPlanner.test.mjs`
Expected: 失败（新分派逻辑尚未实现）。

- [ ] **Step 3: 重写 `src/engine/agentWorkflowPlanner.ts` 的 `planAgentWorkflow`**

在文件顶部新增 import（保留现有 import）：

```typescript
import { classifyIntent, degradeIntent } from './agentWorkflowIntent';
import { templateBuilders, type TemplateContext } from './agentWorkflowTemplates';
```

用以下实现**整体替换**现有 `planAgentWorkflow` 函数（`planAgentWorkflowSmart` 保持不变）：

```typescript
export function planAgentWorkflow(input: AgentWorkflowPlannerInput): AgentWorkflowPlannerResult {
  const { group, members, mentionedAgentIds, t, intentHint, userMessage } = input;
  const _t = makeTranslator(t);
  const defaults = {
    ...createDefaultAgentWorkflowDefaults(),
    ...(group.workflowDefaults || {}),
  };
  const maxParallel = Math.max(1, defaults.maxParallelAgents || 1);
  const maxPhases = Math.max(1, defaults.maxPhases || 1);
  const workspaceReady = !!input.workspaceReady;

  const emptyTitle = _t('chat:agentWorkflow.planner.emptyTitle');
  const emptyExplanation = _t('chat:agentWorkflow.planner.emptyExplanation');
  const noMembersWarning = _t('chat:agentWorkflow.planner.warnings.noMembers');

  // mention 聚焦路径：保留旧 @点名 行为（指定成员的单/并行的 quick 形态计划）
  const wantsMention = !!mentionedAgentIds && mentionedAgentIds.length > 0;
  if (wantsMention) {
    const effective = members.filter(m => mentionedAgentIds.includes(m.id));
    if (effective.length === 0) {
      return { plan: emptyPlan(emptyTitle, emptyExplanation), warnings: [noMembersWarning] };
    }
    const selected = effective.slice(0, Math.min(maxParallel, effective.length)).map(m => m.id);
    return {
      plan: {
        version: 1,
        title: _t('chat:agentWorkflow.planner.intents.quick.title'),
        intent: 'quick',
        riskLevel: 'low',
        requiresApproval: false,
        explanation: _t('chat:agentWorkflow.planner.intents.quick.explanation'),
        phases: [
          {
            id: 'p1-answer',
            label: _t('chat:agentWorkflow.planner.phases.answer.label'),
            mode: 'readOnly',
            schedule: selected.length > 1 ? 'parallel' : 'single',
            agentSelection: { type: 'specific', agentIds: selected },
            prompt: _t('chat:agentWorkflow.planner.phases.answer.prompt'),
            outputPolicy: 'full',
            onFailure: 'continue',
          },
        ],
      },
      warnings: [],
    };
  }

  if (!members || members.length === 0) {
    return { plan: emptyPlan(emptyTitle, emptyExplanation), warnings: [noMembersWarning] };
  }

  // 意图分派：手动覆盖优先，否则关键词分类；再经能力降级；最后落到模板
  const rawIntent = intentHint ?? classifyIntent(userMessage || '');
  const degraded = degradeIntent(rawIntent, { memberCount: members.length, workspaceReady });
  const warnings = degraded.reason ? [degraded.reason!] : [];

  const templateCtx: TemplateContext = {
    members,
    workspaceReady,
    maxParallel,
    maxPhases,
    locale: input.locale,
    t: _t,
  };

  const builder = templateBuilders[degraded.intent] || templateBuilders.quick;
  const plan = builder(templateCtx);
  return { plan, warnings };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node src/engine/agentWorkflowPlanner.test.mjs`
Expected: `agentWorkflowPlanner.test.mjs: ok`（含所有保留的旧用例 + 新增用例）。

- [ ] **Step 5: typecheck**

Run: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"`
Expected: 基线一致。

- [ ] **Step 6: 提交**

```bash
git add src/engine/agentWorkflowPlanner.ts src/engine/agentWorkflowPlanner.test.mjs
git commit -m "feat(agent-workflow): dispatch rule planner by intent to templates"
```

---

## Task 5: runner `auto` 选人接 helper

**Files:**
- Modify: `src/engine/agentWorkflowRunner.ts:127-142`（`selectAgentsForPhase`）
- Modify (extend): `src/engine/agentWorkflowRunner.test.mjs`

- [ ] **Step 1: 在 `agentWorkflowRunner.test.mjs` 末尾追加用例**

先查看现有 import 方式（该测试同样用 `importTsModule` + transform 桩掉 `@/` 依赖）。在现有断言后追加一个验证 `auto` 选人受 `maxParallelAgents` 截断的用例（若已有等价用例则跳过此步）：

```javascript
// auto selection respects maxParallelAgents cap via helper
{
  // 构造一个含 auto/count 选择的 phase，验证 runner 解析后不超过 maxParallel
  // （具体构造依现有测试 fixture；若现有测试已覆盖 auto+cap，此步可省略）
}
```

若现有测试已覆盖 `auto` + `count` 截断，本步改为：确认现有用例仍通过即可（见 Step 4）。

- [ ] **Step 2: 运行测试确认现状**

Run: `node src/engine/agentWorkflowRunner.test.mjs`
Expected: 通过（基线），记录当前 auto 相关断言。

- [ ] **Step 3: 修改 `src/engine/agentWorkflowRunner.ts` 的 `selectAgentsForPhase`**

把：
```typescript
function selectAgentsForPhase(
  phase: AgentWorkflowPhase,
  members: AIMember[],
): AIMember[] {
  if (phase.agentSelection.type === 'specific') {
    const ids = phase.agentSelection.agentIds;
    return ids
      .map(id => members.find(m => m.id === id))
      .filter((m): m is AIMember => !!m);
  }
  // 'auto' ...
  const wanted = phase.agentSelection.count || 1;
  return members.slice(0, wanted);
}
```
改为（接 helper；`specific` 路径不变，`auto` 走 `resolveAgentSelection`）：

```typescript
import { resolveAgentSelection } from './agentWorkflowSelection';

function selectAgentsForPhase(
  phase: AgentWorkflowPhase,
  members: AIMember[],
  maxParallel: number,
): AIMember[] {
  if (phase.agentSelection.type === 'specific') {
    const ids = phase.agentSelection.agentIds;
    return ids
      .map(id => members.find(m => m.id === id))
      .filter((m): m is AIMember => !!m);
  }
  const wanted = phase.agentSelection.count || 1;
  const ids = resolveAgentSelection({ kind: 'count', n: wanted }, members, { maxParallel });
  const idSet = new Set(ids);
  return members.filter(m => idSet.has(m.id));
}
```

并更新调用处。在 `runAgentWorkflowPlan` 顶部（与 `groupContext` 构造附近）计算并复用：

```typescript
const maxParallel = Math.max(1, group.workflowDefaults?.maxParallelAgents ?? 5);
```

把 `const selected = selectAgentsForPhase(phase, members);` 改为
`const selected = selectAgentsForPhase(phase, members, maxParallel);`。

> 说明：`validateAgentWorkflowPlan` 已在规划层把 `auto`+`parallel` 的 count 截到上限，runner
> 此处接 helper 主要是让选人路径统一（与规则模板同源），并对未经验证的 plan 提供一致兜底。

- [ ] **Step 4: 运行测试确认通过**

Run: `node src/engine/agentWorkflowRunner.test.mjs`
Expected: `agentWorkflowRunner.test.mjs: ok`。

- [ ] **Step 5: typecheck**

Run: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"`
Expected: 基线一致。

- [ ] **Step 6: 提交**

```bash
git add src/engine/agentWorkflowRunner.ts src/engine/agentWorkflowRunner.test.mjs
git commit -m "refactor(agent-workflow): route runner auto-selection through helper"
```

---

## Task 6: LLM planner 接受 intentHint

**Files:**
- Modify: `src/engine/agentWorkflowPlanner.llm.ts`（`buildUserPrompt`）

**说明**：`AgentWorkflowPlannerInput.intentHint` 已在接口；LLM planner 让手动覆盖也影响其规划。

- [ ] **Step 1: 修改 `buildUserPrompt`**

在 `buildUserPrompt` 中，`mentionedAgentIds` 段之后、`User request` 段之前插入：

```typescript
  if (input.intentHint) {
    parts.push(`User selected collaboration mode: ${input.intentHint}. Plan accordingly.`);
    parts.push('');
  }
```

- [ ] **Step 2: 运行 LLM planner 相关测试**

Run: `node src/engine/agentWorkflowPlanner.llm.test.mjs`
Expected: `agentWorkflowPlanner.llm.test.mjs: ok`（该测试用 caller 桩，不实际调用 LLM；新增的 prompt 行不影响断言。若断言检查完整 prompt 文本，则相应更新期望）。

- [ ] **Step 3: typecheck**

Run: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"`
Expected: 基线一致。

- [ ] **Step 4: 提交**

```bash
git add src/engine/agentWorkflowPlanner.llm.ts
git commit -m "feat(agent-workflow): pass selected intent hint to LLM planner"
```

---

## Task 7: i18n 模板阶段文案

**Files:**
- Modify: `src/i18n/resources/zh-CN/chat.json`
- Modify: `src/i18n/resources/en-US/chat.json`

**说明**：在 `agentWorkflow.planner` 下新增 intents（discuss/multi_solution/implement/review/audit 的 title/explanation）与 phases（consult/synthesize/propose/compare/implement/verify/audit 的 label/prompt）。zh/en 严格对称（`resources.test.mjs` 校验键集合）。

- [ ] **Step 1: 在 `zh-CN/chat.json` 的 `agentWorkflow.planner` 对象内新增键**

在现有 `intents.quick` 与 `phases.answer` 旁，补齐：

```json
"intents": {
  "quick": { "title": "快速回答", "explanation": "由单个成员直接回答问题。" },
  "discuss": { "title": "专家会诊", "explanation": "多位专家并行分析，再由一位汇总综合。" },
  "multi_solution": { "title": "多方案对比", "explanation": "多位专家各自给出方案，再综合对比。" },
  "implement": { "title": "实现", "explanation": "由实现者完成代码改动（需审批）。" },
  "review": { "title": "改完复审", "explanation": "实现者完成改动后由复审者校验，未通过则重做。" },
  "audit": { "title": "只读审计", "explanation": "多位专家并行审计现状，再汇总风险。" }
},
"phases": {
  "answer": { "label": "回答", "prompt": "直接回答用户请求。除非明确要求，否则不要修改文件。" },
  "consult": { "label": "会诊", "prompt": "从你的职责角度分析该问题，给出你的专业意见。" },
  "synthesize": { "label": "汇总", "prompt": "综合上一阶段各位专家的意见，形成共识结论。" },
  "propose": { "label": "出方案", "prompt": "独立给出一套完整方案，不要参考他人。" },
  "compare": { "label": "对比综合", "prompt": "对比上一阶段各方案的优劣，给出推荐与取舍理由。" },
  "implement": { "label": "实现", "prompt": "完成最小必要改动并运行验证；输出根因、改动、验证结果与剩余风险。" },
  "verify": { "label": "复审", "prompt": "检查上一阶段改动是否达标、有无副作用、验证是否充分。达标输出 PASS，否则输出 FAIL 与具体问题清单。" },
  "audit": { "label": "审计", "prompt": "审计现状中的风险与问题，输出问题清单。" }
}
```

（替换现有 `agentWorkflow.planner` 内已存在的 `intents.quick` / `phases.answer`，避免重复键。）

- [ ] **Step 2: 在 `en-US/chat.json` 加严格对称的英文键**

```json
"intents": {
  "quick": { "title": "Quick answer", "explanation": "A single agent answers the question directly." },
  "discuss": { "title": "Expert consult", "explanation": "Multiple experts analyze in parallel, then one synthesizes." },
  "multi_solution": { "title": "Multiple solutions", "explanation": "Multiple experts each propose a solution, then compare." },
  "implement": { "title": "Implement", "explanation": "An implementer makes code changes (requires approval)." },
  "review": { "title": "Implement then review", "explanation": "Implementer changes, then a reviewer verifies; redo on fail." },
  "audit": { "title": "Read-only audit", "explanation": "Multiple experts audit the current state, then summarize risks." }
},
"phases": {
  "answer": { "label": "Answer", "prompt": "Answer the user request directly. Do not modify files unless explicitly required." },
  "consult": { "label": "Consult", "prompt": "Analyze the problem from your role's perspective and give your expert opinion." },
  "synthesize": { "label": "Synthesize", "prompt": "Synthesize the experts' opinions from the previous phase into a consensus." },
  "propose": { "label": "Propose", "prompt": "Independently propose a complete solution; do not reference others." },
  "compare": { "label": "Compare", "prompt": "Compare the pros and cons of the proposed solutions; give a recommendation with rationale." },
  "implement": { "label": "Implement", "prompt": "Make the minimal necessary changes and run validation; report root cause, changes, validation, residual risk." },
  "verify": { "label": "Review", "prompt": "Check whether the previous phase meets the bar, has side effects, and is adequately validated. Output PASS if it passes, otherwise FAIL with a concrete issue list." },
  "audit": { "label": "Audit", "prompt": "Audit risks and issues in the current state; output an issue list." }
}
```

- [ ] **Step 3: 验证 i18n 对称**

Run: `node src/i18n/resources.test.mjs`
Expected: `i18n resource symmetry OK`。

- [ ] **Step 4: 提交**

```bash
git add src/i18n/resources/zh-CN/chat.json src/i18n/resources/en-US/chat.json
git commit -m "i18n(agent-workflow): add rule-planner template phase labels and prompts"
```

---

## Task 8: composer 意图选择 + intentHint 透传

**Files:**
- Modify: `src/pages/chat/components/AgentChatUI.tsx`

**说明**：composer 左侧加紧凑意图按钮（复用 `workflowIntentPresets`），默认 `smart`；选中后映射为 `AgentWorkflowIntent` 透传给两条 planner 路径；发送后重置回 `smart`。

- [ ] **Step 1: 加 import 与状态**

在 `AgentChatUI.tsx` 顶部 import 区加：

```typescript
import { workflowIntentPresets } from '@/config/groupProduct';
```

在组件内（`inputMessage` 状态附近）加：

```typescript
const [selectedIntentId, setSelectedIntentId] = useState<typeof workflowIntentPresets[number]['id']>('smart');
```

- [ ] **Step 2: 在 `handleSendMessage` 内映射并透传 intentHint**

在 `handleSendMessage` 中，找到现有 `planAgentWorkflow({ ... })` 与 `planAgentWorkflowSmart({ ... })` 两处调用，给它们都加 `intentHint` 参数。在调用前计算：

```typescript
const intentPreset = workflowIntentPresets.find(p => p.id === selectedIntentId);
const intentHint = intentPreset && intentPreset.id !== 'smart' ? intentPreset.intent : undefined;
```

把 `intentHint` 加入两个 planner 调用的入参对象（与 `mentionedAgentIds` 同级）。

并在 `handleSendMessage` 末尾（两个 return 分支之后、函数结束前）重置：

```typescript
setSelectedIntentId('smart');
```

（注意：`handleSendMessage` 有多个早 return 分支；在捕获 `capturedInput` 之后立即重置最稳妥——在 `setInputMessage('')` 那一行旁加 `setSelectedIntentId('smart')`。）

- [ ] **Step 3: 在 composer 加意图按钮 UI**

在 `composeShell` 内、`Paperclip` 按钮之后、`MentionTextArea` 之前，加一个 `Dropdown`（antd）：

```tsx
import { Dropdown } from 'antd';
import { Sparkles, ChevronDown } from 'lucide-react';
```

（`Dropdown`、`Sparkles`、`ChevronDown` 加入现有 import。）

```tsx
<Dropdown
  trigger={['click']}
  menu={{
    items: workflowIntentPresets.map(p => ({
      key: p.id,
      label: (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 13, fontWeight: 500 }}>{p.label}</span>
          <span style={{ fontSize: 11, opacity: 0.6 }}>{p.description}</span>
        </div>
      ),
    })),
    selectedKeys: [selectedIntentId],
    onClick: ({ key }) => setSelectedIntentId(key as typeof selectedIntentId),
  }}
>
  <AntdButton type="text" style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
    <Sparkles size={15} color={selectedIntentId === 'smart' ? undefined : '#ff6600'} />
    <span style={{ fontSize: 12 }}>
      {workflowIntentPresets.find(p => p.id === selectedIntentId)?.label}
    </span>
    <ChevronDown size={13} />
  </AntdButton>
</Dropdown>
```

- [ ] **Step 4: typecheck + i18n**

Run: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"`
Expected: 基线一致（45）。
Run: `node src/i18n/resources.test.mjs`
Expected: OK。

- [ ] **Step 5: 提交**

```bash
git add src/pages/chat/components/AgentChatUI.tsx
git commit -m "feat(agent-chat): add transient intent picker in composer"
```

---

## Task 9: 接入 test:product 链 + 全量验证

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 把 3 个新测试加入 `test:product`**

在 `package.json` 的 `test:product` 脚本末尾追加（沿用 `&& node ...` 链）：

```
&& node src/engine/agentWorkflowSelection.test.mjs && node src/engine/agentWorkflowIntent.test.mjs && node src/engine/agentWorkflowTemplates.test.mjs
```

- [ ] **Step 2: 跑全量产品测试**

Run: `npm run test:product`
Expected: 全部 ok（含 `agentWorkflow.test.mjs`——它跑 `validateAgentWorkflowPlan`，不直接跑模板；若想让模板产出过 validator，可在此处加一行，但模板阶段已在 Task 3/4 间接覆盖）。

- [ ] **Step 3: 跑引擎测试链**

Run: `npm run test:cli`
Expected: 全部 ok（含 `agentWorkflowPlanner.test.mjs`、`agentWorkflowPlanner.llm.test.mjs`、`agentWorkflowRunner.test.mjs`）。

- [ ] **Step 4: typecheck 全量**

Run: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"`
Expected: 基线一致（无新错误）。

- [ ] **Step 5: 提交**

```bash
git add package.json
git commit -m "test(agent-workflow): wire new rule-planner tests into test:product"
```

---

## Self-Review（plan 写完后自检结果）

**1. Spec 覆盖**：§1 分类器/降级 → Task 2；§2 六模板 → Task 3；§3 选人 helper → Task 1；§4 分派/接线 → Task 4 + Task 8；§4 runner auto → Task 5；§4 LLM intentHint → Task 6；§1/§2 文案 → Task 7；§5 边界（空成员/无 ws/独立复审者）→ Task 2 降级 + Task 3；§6 测试 → Task 1/2/3 新增 + Task 4/5 扩展。全部覆盖。

**2. 占位符扫描**：Task 5 Step 1 标注「若现有测试已覆盖则跳过」——这是有条件的，不是占位符（现有 runner 测试确有 auto+count 用例）。Task 6 Step 2 标注「若断言检查完整 prompt 则更新期望」——同理条件化。其余步骤均含完整代码。

**3. 类型一致性**：`resolveAgentSelection`、`classifyIntent`、`degradeIntent`、`templateBuilders`、`TemplateContext` 在各 Task 间签名一致；`intentHint` 类型为 `AgentWorkflowIntent | undefined`（smart preset 不传），分派用 `intentHint ?? classifyIntent(...)`。

**4. 已知行为变更（已显式处理）**：「never writes」旧测试 → Task 4 Step 1 更新为期望 write。mention 聚焦、空成员、quick 兜底用例保持通过。
