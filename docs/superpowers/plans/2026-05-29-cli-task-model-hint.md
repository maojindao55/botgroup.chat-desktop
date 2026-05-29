# CLI Task Model Hint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a CLI model hint directly after the AI member name in CLI task chat when the model can be inferred from `extraArgs`.

**Architecture:** Add a conservative pure parser in `src/config/cliTasks.ts`, persist the parsed hint in `CLITaskMemberSnapshot`, and derive the displayed chat sender label in `CLITaskUI` without changing stored message content or CLI execution payloads.

**Tech Stack:** TypeScript, React, Zustand task persistence, existing Node-based `.mjs` tests.

---

### Task 1: Model Hint Parser And Snapshot

**Files:**
- Modify: `src/config/cliTasks.ts`
- Test: `src/config/cliTasks.test.mjs`

- [ ] **Step 1: Write the failing parser and snapshot tests**

Add assertions to `src/config/cliTasks.test.mjs` after the first `createDevelopmentTask` assertions:

```js
assert.equal(mod.inferCliModelFromArgs(['--model', 'gpt-5-codex']), 'gpt-5-codex');
assert.equal(mod.inferCliModelFromArgs(['--model=gpt-5-codex']), 'gpt-5-codex');
assert.equal(mod.inferCliModelFromArgs(['-m', 'claude-sonnet-4.5']), 'claude-sonnet-4.5');
assert.equal(mod.inferCliModelFromArgs(['-m=claude-sonnet-4.5']), 'claude-sonnet-4.5');
assert.equal(mod.inferCliModelFromArgs(['--model']), undefined);
assert.equal(mod.inferCliModelFromArgs(['--model', '--sandbox']), undefined);
assert.equal(mod.inferCliModelFromArgs(['--json']), undefined);
```

In the existing `sourceMembers` snapshot test, change `extraArgs: ['--json']` to:

```js
extraArgs: ['--json', '--model', 'gpt-5-codex'],
```

Then assert:

```js
assert.equal(snapshotTask.memberSnapshots[0].modelHint, 'gpt-5-codex');
assert.equal(restoredAgent.cli.modelHint, 'gpt-5-codex');
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node src/config/cliTasks.test.mjs`

Expected: FAIL because `inferCliModelFromArgs` does not exist or `modelHint` is not populated.

- [ ] **Step 3: Implement the parser and snapshot field**

In `src/config/cliTasks.ts`, add `modelHint?: string` to `CLITaskMemberSnapshot`.

Add:

```ts
function normalizeCliModelValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.startsWith('-')) return undefined;
  return trimmed;
}

export function inferCliModelFromArgs(extraArgs?: string[] | null): string | undefined {
  if (!extraArgs?.length) return undefined;
  for (let index = 0; index < extraArgs.length; index += 1) {
    const arg = extraArgs[index]?.trim();
    if (!arg) continue;
    if (arg === '--model' || arg === '-m') {
      const value = normalizeCliModelValue(extraArgs[index + 1]);
      if (value) return value;
      continue;
    }
    if (arg.startsWith('--model=')) {
      const value = normalizeCliModelValue(arg.slice('--model='.length));
      if (value) return value;
      continue;
    }
    if (arg.startsWith('-m=')) {
      const value = normalizeCliModelValue(arg.slice('-m='.length));
      if (value) return value;
    }
  }
  return undefined;
}
```

Set `modelHint: inferCliModelFromArgs(member.cli!.extraArgs)` when creating snapshots, clone it in `cloneCLITaskMemberSnapshots()`, and pass it through `cliTaskMemberSnapshotToAgent()` as `cli.modelHint`.

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `node src/config/cliTasks.test.mjs`

Expected: PASS.

### Task 2: Chat Sender Display

**Files:**
- Modify: `src/pages/chat/components/CLITaskUI.tsx`
- Test: covered by parser tests plus TypeScript build.

- [ ] **Step 1: Add display helpers in `CLITaskUI`**

Import `inferCliModelFromArgs` from `@/config/cliTasks`.

Add render-local helpers:

```ts
const splitAgentDisplayName = (name: string, stageLabel?: string) => {
  const marker = stageLabel ? ` · ${stageLabel}` : '';
  if (marker && name.endsWith(marker)) {
    return { baseName: name.slice(0, -marker.length), stageName: stageLabel };
  }
  const parts = name.split(' · ');
  return parts.length > 1
    ? { baseName: parts[0], stageName: parts.slice(1).join(' · ') }
    : { baseName: name, stageName: stageLabel };
};

const appendCliModelHint = (baseName: string, modelHint?: string) => {
  if (!modelHint || baseName.includes(` · ${modelHint}`)) return baseName;
  return `${baseName} · ${modelHint}`;
};
```

- [ ] **Step 2: Use the model hint in message metadata rendering**

Inside the `chatMessages.map()` render block, compute:

```ts
const snapshotMember = selectedTask.memberSnapshots?.find(member => member.id === message.sender.id);
const modelHint = snapshotMember?.modelHint
  || (cliMember?.kind === 'cli' ? inferCliModelFromArgs(cliMember.cli?.extraArgs) : undefined);
const displayNameParts = splitAgentDisplayName(message.sender.name, message.stageLabel);
const senderDisplayName = isUser
  ? message.sender.name
  : [
      appendCliModelHint(displayNameParts.baseName, modelHint),
      displayNameParts.stageName,
    ].filter(Boolean).join(' · ');
```

Use `senderDisplayName` in the metadata row and keep avatar/title lookup on the original agent name.

- [ ] **Step 3: Run TypeScript build**

Run: `npm run build`

Expected: PASS.

### Task 3: Final Verification

**Files:**
- Verify only.

- [ ] **Step 1: Run CLI task tests**

Run: `npm run test:cli`

Expected: PASS.

- [ ] **Step 2: Inspect diff for scope**

Run: `git diff -- src/config/cliTasks.ts src/config/cliTasks.test.mjs src/pages/chat/components/CLITaskUI.tsx`

Expected: Diff only adds model hint parsing, snapshot persistence, tests, and display logic.
