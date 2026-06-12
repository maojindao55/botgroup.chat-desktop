# BotGroup Chat Product Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reframe the three existing BotGroup chat types as clearer group-chat products while preserving the `ai | agent | cli` data model and the core `botgroup.chat` experience.

**Architecture:** Keep the existing group types and engines in place. Add a small product taxonomy layer for user-facing names, templates, and mode mappings, then update the create wizard, settings panels, resource library, and chat labels to present every capability as a group-chat experience: role groups, expert groups, and development groups.

**Tech Stack:** React 19, TypeScript, Zustand, Ant Design, Lobe UI, Tauri IPC, existing Node-based `.mjs` tests.

---

## Scope

This plan intentionally does not replace `agentEngine.ts` with PI, does not rewrite `cliEngine.ts`, and does not migrate persisted group records. It changes the product language, creation flow, settings panels, and tests so the current implementation feels coherent:

- `type: 'ai'` becomes **角色群**: role/model group chat for conversation, brainstorming, and multi-model viewpoints.
- `type: 'agent'` becomes **专家群**: expert group chat for non-code tasks, decisions, and deliverables.
- `type: 'cli'` becomes **开发群**: coding CLI group chat where Codex, Claude Code, OpenCode, KimiCode, PI, and custom runtimes collaborate as group members.

The user should still feel they are inviting AI members into a chat room, not leaving chat for a separate task-management product.

## File Structure

- Create `src/config/groupProduct.ts`
  Central product copy, role/expert/development group templates, and compatibility mapping helpers.

- Create `src/config/groupProduct.test.mjs`
  Node test for product labels, template-to-existing-field mappings, and no banned workbench wording.

- Modify `src/pages/chat/components/CreateGroupWizard.tsx`
  Use product templates and chat-first copy. Keep output objects compatible with `AIGroup`, `AgentGroup`, and `CLIGroup`.

- Modify `src/pages/chat/components/AIGroupSettings.tsx`
  Replace the duplicated "全员讨论模式 + 调度策略 all" UI with one "发言方式" control.

- Modify `src/pages/chat/components/AgentGroupSettings.tsx`
  Show expert-group templates first; move raw technical strategies into an advanced section.

- Modify `src/pages/chat/components/CLIGroupSettings.tsx`
  Present development-group "群规" templates while preserving the existing `CLIStrategy` and `CLIExecutionPlan` execution path.

- Modify `src/pages/chat/components/AIMemberLibrary.tsx`
  Rename the member-management surface from "AI 群员库" semantics to a resource library with tabs for roles, experts, development agents, and model services.

- Modify `src/pages/chat/components/Sidebar.tsx`, `src/pages/chat/components/ChatUI.tsx`, `src/pages/chat/components/AgentChatUI.tsx`
  Align visible labels, empty states, badges, and placeholders with the new chat-first framing.

- Modify `src/engine/cliWorkflowModes.test.mjs`
  Update expected workflow labels for development-group templates.

- Optional modify `README.md`
  Refresh the feature bullets after UI behavior is updated.

---

## Task 1: Add Product Taxonomy Layer

**Files:**
- Create: `src/config/groupProduct.ts`
- Create: `src/config/groupProduct.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write the failing test**

Create `src/config/groupProduct.test.mjs`:

```js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function importTsModule(url) {
  const source = await readFile(url, 'utf8');
  const compiled = ts.transpileModule(`${source}\n// cache-bust:${Date.now()}`, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`;
  return import(moduleUrl);
}

const mod = await importTsModule(new URL('./groupProduct.ts', import.meta.url));

assert.deepEqual(
  mod.productGroupTypes.map((item) => item.label),
  ['角色群', '专家群', '开发群'],
);

assert.deepEqual(
  mod.aiSpeechModes.map((item) => item.label),
  ['智能点名', '轮流发言', '全员圆桌'],
);

assert.deepEqual(
  mod.agentWorkflowTemplates.map((item) => item.label),
  ['专家会诊', '方案产出', '评审决策', '接力修改', '自动处理'],
);

assert.deepEqual(
  mod.cliWorkflowTemplates.map((item) => item.label),
  ['快速响应', '写完再审', '审核修正', '多人出方案', '隔离竞赛', '群内讨论'],
);

assert.equal(
  mod.applyAISpeechMode('smart').schedulerStrategy,
  'tag',
);
assert.equal(
  mod.applyAISpeechMode('smart').isGroupDiscussionMode,
  false,
);
assert.equal(
  mod.applyAISpeechMode('all').schedulerStrategy,
  'all',
);
assert.equal(
  mod.applyAISpeechMode('all').isGroupDiscussionMode,
  true,
);

assert.equal(
  mod.resolveAISpeechMode({ isGroupDiscussionMode: true, schedulerStrategy: 'tag' }),
  'all',
);
assert.equal(
  mod.resolveAISpeechMode({ isGroupDiscussionMode: false, schedulerStrategy: 'round_robin' }),
  'round_robin',
);
assert.equal(
  mod.resolveAISpeechMode({ isGroupDiscussionMode: false, schedulerStrategy: 'all' }),
  'all',
);

const developmentLoop = mod.cliWorkflowTemplates.find((item) => item.id === 'implement_review');
assert.equal(developmentLoop.strategy, 'review');
assert.equal(developmentLoop.defaultStages.join(' -> '), '实现 -> 审核 -> 修正 -> 验证');

const labels = JSON.stringify({
  groups: mod.productGroupTypes,
  agent: mod.agentWorkflowTemplates,
  cli: mod.cliWorkflowTemplates,
});
assert.doesNotMatch(labels, /工作台/);
assert.doesNotMatch(labels, /Workbench/i);
```

- [ ] **Step 2: Run the test to confirm the module is missing**

Run: `node src/config/groupProduct.test.mjs`

Expected: fails with an import/read error for `groupProduct.ts`.

- [ ] **Step 3: Create the product taxonomy**

Create `src/config/groupProduct.ts`:

```ts
import type { AgentStrategy, CLIStrategy, CLIExecutionPlan, GroupType } from './groups';

export type AISpeechMode = 'smart' | 'round_robin' | 'all';

export interface ProductGroupType {
  type: GroupType;
  label: string;
  shortLabel: string;
  description: string;
}

export interface AISpeechModeOption {
  value: AISpeechMode;
  label: string;
  description: string;
}

export interface AgentWorkflowTemplate {
  id: 'expert_consult' | 'proposal' | 'decision_review' | 'relay_edit' | 'auto_delegate';
  label: string;
  description: string;
  strategy: AgentStrategy;
  maxRounds: number;
  coordinatorPrompt?: string;
}

export interface CLIWorkflowTemplate {
  id: 'quick_response' | 'implement_review' | 'review_fix' | 'multi_solution' | 'isolated_race' | 'discussion';
  label: string;
  description: string;
  strategy: CLIStrategy;
  executionPlan?: Partial<CLIExecutionPlan>;
  defaultStages: string[];
}

export const productGroupTypes: ProductGroupType[] = [
  {
    type: 'ai',
    label: '角色群',
    shortLabel: '角色',
    description: '邀请不同角色和模型一起聊天、脑暴、做观点碰撞。',
  },
  {
    type: 'agent',
    label: '专家群',
    shortLabel: '专家',
    description: '邀请具备职责分工的专家群友协作，产出方案、评审和结论。',
  },
  {
    type: 'cli',
    label: '开发群',
    shortLabel: '开发',
    description: '邀请 Codex、Claude Code、OpenCode、KimiCode、PI 等开发群友协作改代码。',
  },
];

export const aiSpeechModes: AISpeechModeOption[] = [
  {
    value: 'smart',
    label: '智能点名',
    description: '根据消息内容选择最相关的角色发言，适合日常聊天。',
  },
  {
    value: 'round_robin',
    label: '轮流发言',
    description: '群友按顺序轮流回复，适合长期陪伴式对话。',
  },
  {
    value: 'all',
    label: '全员圆桌',
    description: '每轮所有角色都发言，适合脑暴和多模型观点对比。',
  },
];

export const agentWorkflowTemplates: AgentWorkflowTemplate[] = [
  {
    id: 'expert_consult',
    label: '专家会诊',
    description: '多位专家群友独立分析同一问题，再形成综合意见。',
    strategy: 'discussion',
    maxRounds: 2,
    coordinatorPrompt: '请组织专家群友围绕用户问题分别给出判断、风险和建议，最后汇总成清晰结论。',
  },
  {
    id: 'proposal',
    label: '方案产出',
    description: '按调研、起草、审查、定稿的方式协作产出方案。',
    strategy: 'pipeline',
    maxRounds: 3,
  },
  {
    id: 'decision_review',
    label: '评审决策',
    description: '从多角色视角提出收益、风险、约束和最终建议。',
    strategy: 'debate',
    maxRounds: 3,
    coordinatorPrompt: '请让不同专家群友先提出独立意见，再互相指出风险，最后给出可执行建议。',
  },
  {
    id: 'relay_edit',
    label: '接力修改',
    description: '一个专家起草，一个专家审核，一个专家修订。',
    strategy: 'pipeline',
    maxRounds: 3,
  },
  {
    id: 'auto_delegate',
    label: '自动处理',
    description: '由协调者多轮分派任务，适合目标明确但步骤未定的问题。',
    strategy: 'react',
    maxRounds: 4,
    coordinatorPrompt: '请作为群内协调者，根据用户目标分派下一位专家群友处理，并在任务完成时给出总结。',
  },
];

export const cliWorkflowTemplates: CLIWorkflowTemplate[] = [
  {
    id: 'quick_response',
    label: '快速响应',
    description: '自动选择一位开发群友处理当前代码任务。',
    strategy: 'router',
    defaultStages: ['分派', '执行'],
  },
  {
    id: 'implement_review',
    label: '写完再审',
    description: '实现者先写代码，审核者再 review，必要时回到实现者修正。',
    strategy: 'review',
    defaultStages: ['实现', '审核', '修正', '验证'],
  },
  {
    id: 'review_fix',
    label: '审核修正',
    description: '先审查现有改动，再让开发群友按意见修正。',
    strategy: 'review',
    defaultStages: ['审核', '修正', '验证'],
  },
  {
    id: 'multi_solution',
    label: '多人出方案',
    description: '多个开发群友分别处理同一任务，结果在群里并列展示。',
    strategy: 'sequential',
    defaultStages: ['方案 A', '方案 B', '对比'],
  },
  {
    id: 'isolated_race',
    label: '隔离竞赛',
    description: '多个开发群友在独立 worktree 中并行实现，用户选择采纳。',
    strategy: 'race',
    defaultStages: ['并行实现', '结果对比', '用户采纳'],
  },
  {
    id: 'discussion',
    label: '群内讨论',
    description: '只分析代码方案和风险，不要求开发群友修改文件。',
    strategy: 'discussion',
    defaultStages: ['分析', '补充', '结论'],
    executionPlan: { isolation: 'copyPerAgent' },
  },
];

export function resolveAISpeechMode(group: {
  isGroupDiscussionMode?: boolean;
  schedulerStrategy?: 'tag' | 'round_robin' | 'all';
}): AISpeechMode {
  if (group.isGroupDiscussionMode) return 'all';
  if (group.schedulerStrategy === 'round_robin') return 'round_robin';
  if (group.schedulerStrategy === 'all') return 'all';
  return 'smart';
}

export function applyAISpeechMode(mode: AISpeechMode): {
  isGroupDiscussionMode: boolean;
  schedulerStrategy: 'tag' | 'round_robin' | 'all';
} {
  if (mode === 'all') {
    return { isGroupDiscussionMode: true, schedulerStrategy: 'all' };
  }
  if (mode === 'round_robin') {
    return { isGroupDiscussionMode: false, schedulerStrategy: 'round_robin' };
  }
  return { isGroupDiscussionMode: false, schedulerStrategy: 'tag' };
}

export function getProductGroupType(type: GroupType): ProductGroupType {
  return productGroupTypes.find((item) => item.type === type) || productGroupTypes[0];
}
```

- [ ] **Step 4: Add a test script**

Modify `package.json` scripts:

```json
"test:product": "node src/config/groupProduct.test.mjs"
```

Keep the existing scripts unchanged.

- [ ] **Step 5: Run the product test**

Run: `npm run test:product`

Expected: passes with no output beyond npm command output.

- [ ] **Step 6: Commit**

```bash
git add package.json src/config/groupProduct.ts src/config/groupProduct.test.mjs
git commit -m "feat(product): add group chat product taxonomy"
```

---

## Task 2: Reframe Create Group Wizard as Chat Group Creation

**Files:**
- Modify: `src/pages/chat/components/CreateGroupWizard.tsx`
- Test: `src/config/groupProduct.test.mjs`

- [ ] **Step 1: Extend the test to guard wizard labels**

Append to `src/config/groupProduct.test.mjs`:

```js
const wizard = await readFile(new URL('../pages/chat/components/CreateGroupWizard.tsx', import.meta.url), 'utf8');

for (const label of ['角色群', '专家群', '开发群']) {
  assert.match(wizard, new RegExp(label));
}

for (const label of ['智能点名', '轮流发言', '全员圆桌']) {
  assert.match(wizard, new RegExp(label));
}

for (const label of ['专家会诊', '方案产出', '评审决策', '接力修改', '自动处理']) {
  assert.match(wizard, new RegExp(label));
}

for (const label of ['快速响应', '写完再审', '审核修正', '多人出方案', '隔离竞赛', '群内讨论']) {
  assert.match(wizard, new RegExp(label));
}

assert.doesNotMatch(wizard, /选择你要创建的群聊类型/);
assert.doesNotMatch(wizard, /CLI Agent 群/);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:product`

Expected: fails because the wizard still contains old labels.

- [ ] **Step 3: Update imports and state**

In `CreateGroupWizard.tsx`, import product config:

```ts
import {
  aiSpeechModes,
  agentWorkflowTemplates,
  applyAISpeechMode,
  cliWorkflowTemplates,
  productGroupTypes,
  type AISpeechMode,
} from '@/config/groupProduct';
```

Replace:

```ts
const [schedulerStrategy, setSchedulerStrategy] = useState<'tag' | 'round_robin' | 'all'>('tag');
const [isDiscussionMode, setIsDiscussionMode] = useState(false);
```

with:

```ts
const [aiSpeechMode, setAISpeechMode] = useState<AISpeechMode>('smart');
```

When creating an `AIGroup`, compute:

```ts
const aiMode = applyAISpeechMode(aiSpeechMode);
```

and use:

```ts
isGroupDiscussionMode: aiMode.isGroupDiscussionMode,
schedulerStrategy: aiMode.schedulerStrategy,
```

Reset `aiSpeechMode` to `'smart'`.

- [ ] **Step 4: Replace type selection copy**

Use `productGroupTypes` for the three top-level cards. The intro sentence should be:

```tsx
<p style={{ fontSize: 14, color: 'rgba(0,0,0,0.45)', marginBottom: 4 }}>
  选择一个群聊场景，把合适的 AI 群友拉进来。
</p>
```

Each card should display `item.label` and `item.description`.

- [ ] **Step 5: Replace AI config with speech modes**

In `renderAIConfigStep`, remove the switch-based "全员讨论模式" block and render `aiSpeechModes` as selectable buttons. Each button sets `setAISpeechMode(item.value)`.

- [ ] **Step 6: Replace Agent config with expert templates**

In `renderAgentConfigStep`, render `agentWorkflowTemplates` instead of raw strategy labels. Clicking a template must set:

```ts
setStrategy(item.strategy);
setMaxRounds(item.maxRounds);
setCoordinatorPrompt(item.coordinatorPrompt || '');
```

Keep the coordinator prompt and max rounds fields below the template list so advanced users can still refine the group.

- [ ] **Step 7: Replace CLI config with development-group templates**

In `renderCLIConfigStep`, render `cliWorkflowTemplates`. Clicking a template sets `setCliStrategy(item.strategy)`.

The old labels `快速处理`, `模型对比`, `接力开发`, `开发评审` should no longer appear in the wizard.

- [ ] **Step 8: Run tests**

Run:

```bash
npm run test:product
npm run test:cli
```

Expected: product test passes. `test:cli` may fail if it still expects old CLI labels; update it in Task 6, not here.

- [ ] **Step 9: Commit**

```bash
git add src/pages/chat/components/CreateGroupWizard.tsx src/config/groupProduct.test.mjs
git commit -m "feat(product): reframe group creation around chat scenes"
```

---

## Task 3: Simplify Role Group Settings

**Files:**
- Modify: `src/pages/chat/components/AIGroupSettings.tsx`
- Test: `src/config/groupProduct.test.mjs`

- [ ] **Step 1: Extend the product test**

Append:

```js
const aiSettings = await readFile(new URL('../pages/chat/components/AIGroupSettings.tsx', import.meta.url), 'utf8');

assert.match(aiSettings, /发言方式/);
for (const label of ['智能点名', '轮流发言', '全员圆桌']) {
  assert.match(aiSettings, new RegExp(label));
}
assert.doesNotMatch(aiSettings, /全员讨论模式/);
assert.doesNotMatch(aiSettings, /调度策略/);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:product`

Expected: fails because the old settings still use "全员讨论模式" and "调度策略".

- [ ] **Step 3: Update imports and derive speech mode**

In `AIGroupSettings.tsx`, import:

```ts
import { aiSpeechModes, applyAISpeechMode, resolveAISpeechMode } from '@/config/groupProduct';
```

Inside the component:

```ts
const speechMode = resolveAISpeechMode({
  isGroupDiscussionMode,
  schedulerStrategy,
});
```

- [ ] **Step 4: Replace settings UI with one control**

Remove the separate full-discussion switch and conditional scheduler strategy block. Render one section:

```tsx
<div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
  <label style={{ fontSize: 14, fontWeight: 500 }}>发言方式</label>
  {aiSpeechModes.map((item) => (
    <button
      key={item.value}
      onClick={() => {
        const next = applyAISpeechMode(item.value);
        if (next.isGroupDiscussionMode !== isGroupDiscussionMode) {
          onToggleGroupDiscussion();
        }
        onStrategyChange(next.schedulerStrategy);
      }}
      className={cx(styles.strategyBtn, speechMode === item.value && styles.strategyBtnActive)}
    >
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 500 }}>{item.label}</div>
        <div style={{ fontSize: 10, opacity: 0.6 }}>{item.description}</div>
      </div>
      {speechMode === item.value && <Check size={14} style={{ color: '#ff6600' }} />}
    </button>
  ))}
</div>
```

- [ ] **Step 5: Update member language**

Change visible copy:

- `从群员库选择` -> `选择角色`
- `选择 AI 成员加入群聊...` -> `选择角色加入群聊...`
- `群成员` -> `群友`
- `快速添加` remains allowed because it is a chat-friendly action.

- [ ] **Step 6: Run tests**

Run: `npm run test:product`

Expected: passes.

- [ ] **Step 7: Commit**

```bash
git add src/pages/chat/components/AIGroupSettings.tsx src/config/groupProduct.test.mjs
git commit -m "feat(product): simplify role group speech modes"
```

---

## Task 4: Reframe Expert Group Settings Around Templates

**Files:**
- Modify: `src/pages/chat/components/AgentGroupSettings.tsx`
- Test: `src/config/groupProduct.test.mjs`

- [ ] **Step 1: Extend the product test**

Append:

```js
const agentSettings = await readFile(new URL('../pages/chat/components/AgentGroupSettings.tsx', import.meta.url), 'utf8');

assert.match(agentSettings, /专家群配置/);
assert.match(agentSettings, /群内协作方式/);
for (const label of ['专家会诊', '方案产出', '评审决策', '接力修改', '自动处理']) {
  assert.match(agentSettings, new RegExp(label));
}
assert.match(agentSettings, /高级策略/);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:product`

Expected: fails because settings still lead with raw strategy names.

- [ ] **Step 3: Import templates**

In `AgentGroupSettings.tsx`:

```ts
import { agentWorkflowTemplates } from '@/config/groupProduct';
```

- [ ] **Step 4: Render expert templates first**

Above the raw strategy grid, render a section titled `群内协作方式`. For each `agentWorkflowTemplates` item, render a button showing `label` and `description`. Clicking it calls:

```ts
onUpdateGroup({
  strategy: item.strategy,
  maxRounds: item.maxRounds,
  coordinatorPrompt: item.coordinatorPrompt || group.coordinatorPrompt,
});
```

The active template can be inferred by matching `strategy` and `maxRounds`. If no template matches, do not show an active card.

- [ ] **Step 5: Move raw strategies into an advanced section**

Rename the existing `执行策略` label to `高级策略`. Keep the existing `strategyOptions` buttons available below the templates, but reduce visual priority by placing them after the template cards.

- [ ] **Step 6: Update member language**

Change visible copy:

- `Agent 群聊配置` -> `专家群配置`
- `添加/管理 Agent 成员` -> `添加/管理专家群友`
- `选择 Agent 成员加入群聊...` -> `选择专家群友加入群聊...`
- `群成员` -> `专家群友`
- `如需新建/编辑 Agent...` -> `如需新建或编辑专家的模型、职责、工具，请到资源库操作。`

- [ ] **Step 7: Run tests**

Run: `npm run test:product`

Expected: passes.

- [ ] **Step 8: Commit**

```bash
git add src/pages/chat/components/AgentGroupSettings.tsx src/config/groupProduct.test.mjs
git commit -m "feat(product): reframe agent groups as expert groups"
```

---

## Task 5: Reframe Development Group Settings Around Group Rules

**Files:**
- Modify: `src/pages/chat/components/CLIGroupSettings.tsx`
- Modify: `src/engine/cliWorkflowModes.test.mjs`
- Test: `src/config/groupProduct.test.mjs`

- [ ] **Step 1: Update CLI workflow label test**

Modify `src/engine/cliWorkflowModes.test.mjs` so it expects:

```js
for (const label of ['快速响应', '写完再审', '审核修正', '多人出方案', '隔离竞赛', '群内讨论']) {
  assert.match(settingsStrategyBlock, new RegExp(`label: '${label}'`));
  assert.match(wizardCliConfigBlock, new RegExp(`label: '${label}'`));
}
```

Remove expectations for `快速处理`, `模型对比`, `接力开发`, and `开发评审`.

- [ ] **Step 2: Extend product test**

Append:

```js
const cliSettings = await readFile(new URL('../pages/chat/components/CLIGroupSettings.tsx', import.meta.url), 'utf8');

assert.match(cliSettings, /开发群配置/);
assert.match(cliSettings, /群规/);
for (const label of ['快速响应', '写完再审', '审核修正', '多人出方案', '隔离竞赛', '群内讨论']) {
  assert.match(cliSettings, new RegExp(label));
}
assert.match(cliSettings, /开发群友/);
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
npm run test:product
npm run test:cli
```

Expected: both fail until CLI settings are updated.

- [ ] **Step 4: Import CLI workflow templates**

In `CLIGroupSettings.tsx`:

```ts
import { cliWorkflowTemplates } from '@/config/groupProduct';
```

- [ ] **Step 5: Replace strategy card source**

Find the current strategy options around `strategyDescriptions` and the strategy button rendering. Use `cliWorkflowTemplates` for labels and descriptions. Clicking a template calls:

```ts
onStrategyChange(item.strategy);
if (item.executionPlan && onExecutionPlanChange) {
  onExecutionPlanChange(item.executionPlan);
}
```

Keep existing advanced `executionPlan` controls in place.

- [ ] **Step 6: Update development-group copy**

Change visible copy:

- `CLI Agent 配置` -> `开发群配置`
- `执行策略` -> `群规`
- `CLI Agent 将在此目录下执行命令` -> `开发群友将在此目录下读写代码`
- `添加/管理 CLI Agent` -> `添加/管理开发群友`
- `CLI Agents` -> `开发群友`
- `选择 CLI Agent 加入群聊...` -> `选择开发群友加入群聊...`
- Placeholder `输入指令，CLI Agent 将在 workspace 中执行...` in `ChatUI.tsx` will be updated in Task 7.

- [ ] **Step 7: Preserve execution behavior**

Do not change `executeCLIStrategy`, `resolveExecutionPlan`, `/api/cli/run`, worktree preparation, temp copy, task logging, or cancellation behavior in this task. This task changes labels and template-to-existing-strategy mapping only.

- [ ] **Step 8: Run tests**

Run:

```bash
npm run test:product
npm run test:cli
```

Expected: both pass.

- [ ] **Step 9: Commit**

```bash
git add src/pages/chat/components/CLIGroupSettings.tsx src/engine/cliWorkflowModes.test.mjs src/config/groupProduct.test.mjs
git commit -m "feat(product): reframe cli groups as development groups"
```

---

## Task 6: Reframe Resource Library

**Files:**
- Modify: `src/pages/chat/components/AIMemberLibrary.tsx`
- Test: `src/config/groupProduct.test.mjs`

- [ ] **Step 1: Extend product test**

Append:

```js
const library = await readFile(new URL('../pages/chat/components/AIMemberLibrary.tsx', import.meta.url), 'utf8');

for (const label of ['角色库', '专家库', '开发群友', '模型服务']) {
  assert.match(library, new RegExp(label));
}
assert.doesNotMatch(library, /AI 群员库/);
assert.doesNotMatch(library, /Agent协作/);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:product`

Expected: fails because the old library copy is still present.

- [ ] **Step 3: Rename kind labels**

In `getKindLabel`:

```ts
case 'llm':
  return { label: '角色', icon: Cpu, color: 'blue' };
case 'agent':
  return { label: '专家', icon: Sparkles, color: 'purple' };
case 'cli':
  return { label: '开发群友', icon: Terminal, color: 'green' };
```

- [ ] **Step 4: Rename actions**

Change search/action bar buttons:

- `新增 LLM 角色` -> `新增角色`
- `新增 Agent` -> `新增专家`
- `新增 CLI Agent` -> `新增开发群友`

- [ ] **Step 5: Rename tabs**

Change tabs:

- `LLM 角色` -> `角色库`
- `Agent 协作` -> `专家库`
- `CLI Agent` -> `开发群友`
- Keep `模型服务`.

Keep the `key` values unchanged: `llm`, `agent`, `cli`, `providers`.

- [ ] **Step 6: Run tests**

Run: `npm run test:product`

Expected: passes.

- [ ] **Step 7: Commit**

```bash
git add src/pages/chat/components/AIMemberLibrary.tsx src/config/groupProduct.test.mjs
git commit -m "feat(product): reframe member library as resources"
```

---

## Task 7: Align Chat Surface and Sidebar Copy

**Files:**
- Modify: `src/pages/chat/components/Sidebar.tsx`
- Modify: `src/pages/chat/components/ChatUI.tsx`
- Modify: `src/pages/chat/components/AgentChatUI.tsx`
- Test: `src/config/groupProduct.test.mjs`

- [ ] **Step 1: Extend product test**

Append:

```js
const sidebar = await readFile(new URL('../pages/chat/components/Sidebar.tsx', import.meta.url), 'utf8');
const chatUi = await readFile(new URL('../pages/chat/components/ChatUI.tsx', import.meta.url), 'utf8');
const agentChatUi = await readFile(new URL('../pages/chat/components/AgentChatUI.tsx', import.meta.url), 'utf8');

for (const label of ['角色', '专家', '开发']) {
  assert.match(sidebar, new RegExp(label));
}

assert.match(chatUi, /输入消息，开发群友会在 workspace 中协作/);
assert.match(agentChatUi, /输入消息，专家群友会按群规协作/);
assert.doesNotMatch(chatUi, /CLI Agent 将在 workspace 中执行/);
assert.doesNotMatch(agentChatUi, /Agent 将按策略协作回复/);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:product`

Expected: fails because the old placeholders and badges are still present.

- [ ] **Step 3: Update Sidebar group badges**

In `Sidebar.tsx`, keep the color coding and group type checks, but use visible labels:

- `ai` -> `角色`
- `agent` -> `专家`
- `cli` -> `开发`

- [ ] **Step 4: Update ChatUI placeholders and system messages**

In `ChatUI.tsx`, change the input placeholder for CLI groups to:

```tsx
placeholder={isCLIGroup ? '输入消息，开发群友会在 workspace 中协作...' : '输入消息...'}
```

Change the no-member system message for CLI groups from `CLI Agent 成员` to `开发群友`.

When confirming approval mode, change:

```ts
确认让 ${names} 在 ${workspacePath || '默认目录'} 执行这次任务？
```

to:

```ts
确认让开发群友 ${names} 在 ${workspacePath || '默认目录'} 协作处理这次任务？
```

- [ ] **Step 5: Update AgentChatUI placeholders and empty state**

In `AgentChatUI.tsx`, change:

- `Agent 协作群` -> `专家群`
- `该群引用了 ... 位 Agent` -> `该群引用了 ... 位专家群友`
- Placeholder to `输入消息，专家群友会按群规协作...`

- [ ] **Step 6: Run tests**

Run: `npm run test:product`

Expected: passes.

- [ ] **Step 7: Commit**

```bash
git add src/pages/chat/components/Sidebar.tsx src/pages/chat/components/ChatUI.tsx src/pages/chat/components/AgentChatUI.tsx src/config/groupProduct.test.mjs
git commit -m "feat(product): align chat surface copy"
```

---

## Task 8: Final Verification and README Refresh

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README feature bullets**

In `README.md`, update the feature section to mention:

```md
- 🤖 **角色群聊** — 多个模型角色一起聊天、脑暴、做观点碰撞
- 🧠 **专家群聊** — 产品、架构、运营等专家群友按群规协作产出结论
- 💻 **开发群聊** — Codex、Claude Code、OpenCode、KimiCode、PI 等开发群友协作改代码、审核和验证
```

Keep the Tauri/local/privacy bullets.

- [ ] **Step 2: Run all relevant tests**

Run:

```bash
npm run test:product
npm run test:cli
npm run test:llm
npm run build
```

Expected:

- `test:product` passes.
- `test:cli` passes.
- `test:llm` passes.
- `npm run build` completes without TypeScript or Vite errors.

- [ ] **Step 3: Inspect changed files**

Run:

```bash
git status --short
git diff --stat
```

Expected: only files from this plan are modified.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: refresh botgroup chat product positioning"
```

- [ ] **Step 5: Final branch status**

Run:

```bash
git status --short --branch
git log --oneline --decorate -8
```

Expected: branch is ahead of `main` by the plan commits and has a clean worktree.

---

## Execution Notes

- Keep the central product promise: every path is still a group chat.
- Do not introduce "工作台" as the main product label.
- Do not rename internal `GroupType` values in this pass.
- Do not delete advanced strategy controls; lower their prominence.
- Do not alter CLI execution semantics while changing copy.
- Treat KimiCode and PI as development-group runtime candidates in product copy, but do not add adapters in this plan.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-24-botgroup-chat-product-refactor.md`. Two execution options:

**1. Subagent-Driven (recommended)** - dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** - execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
