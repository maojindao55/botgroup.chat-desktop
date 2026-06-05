# CLI Agent Workflow UX Design

## Decision

For a new product without legacy group-chat constraints, the primary user object should be a **development task**, not a persistent CLI group.

The product should feel like a local development orchestration workbench:

```text
Task -> Workflow -> Agent runs -> Reviewable result
```

Group chat can remain as the conversational expression inside a task, but the main navigation, creation flow, execution view, and history should be task-first and workflow-first.

## Product Goals

1. Let users start a coding task with one clear prompt, not by configuring a chat room first.
2. Make multi-agent execution understandable before it starts: who will run, in what order, with what permissions.
3. Make running tasks observable: current stage, agent status, logs, workspace, worktree, diff, and blockers.
4. Let users safely stop, retry, rerun a stage, continue a task, or start a new isolated task from an old one.
5. Let users create reusable custom workflows without writing scripts first.

## Non Goals

- Do not expose a JavaScript workflow runtime in the first version.
- Do not make fixed development groups the main destination.
- Do not auto-merge competing worktree results.
- Do not hide CLI logs behind an opaque "AI is thinking" state.
- Do not require users to understand internal strategy names such as `router`, `pipeline`, or `race`.

## Core Mental Model

The user sees four durable objects:

| Object | User meaning | Examples |
| --- | --- | --- |
| Task | A single development job with its own context and execution history | "Fix login timeout", "Review current diff" |
| Workflow | A reusable orchestration recipe | "Plan -> Implement -> Review -> Revise" |
| Agent | A local CLI coding runtime with a role | Codex implementer, Claude reviewer, OpenCode fixer |
| Workspace | A local project directory where tasks run | `C:\Users\...\project` |

The user should never need to create a "CLI group" before doing useful work.

## Information Architecture

Recommended top-level navigation:

```text
Development
  Tasks
  Workflows
  Agents
  Workspaces
```

### Tasks

The default landing screen. It shows development work, not team configuration.

Task list sections:

- Running
- Needs attention
- Recently completed
- Failed
- Archived

Each row should show:

- title
- status
- workflow name
- workspace name or path
- current stage
- last active time
- small agent avatars or adapter badges

### Workflows

A template library for orchestration.

Sections:

- Recommended
- My workflows
- Recently used
- Advanced

Default workflows:

- Quick Fix: choose one agent and execute directly.
- Plan, Implement, Review: planner analyzes, implementer changes code, reviewer checks.
- Diagnose, Fix, Review: implementer diagnoses and fixes, reviewer approves or sends back.
- Isolated Race: several agents work in separate worktrees, user picks a result.
- Read-only Discussion: agents analyze risk and propose a plan without editing the original workspace.

### Agents

A runtime/profile library.

Each agent profile should expose:

- display name
- adapter: Codex, Claude Code, OpenCode, Cursor Agent, Qoder, generic
- command availability and login health
- default role
- approval mode
- extra args
- environment variables
- session reuse defaults

### Workspaces

A project registry.

Each workspace should expose:

- path
- git status
- default workflow
- allowed agents
- recent tasks
- worktree cleanup tools

## Primary User Flow

### New Task

The first screen in the creation flow should be a single task prompt:

```text
What should the development team do?
```

The app then guides the user through a compact setup:

1. Confirm workspace.
2. Choose workflow.
3. Preview the execution plan.
4. Run.

The workflow picker should default intelligently:

- If the prompt looks small and direct: Quick Fix.
- If the prompt asks for a new feature or refactor: Plan, Implement, Review.
- If the prompt describes a bug symptom: Diagnose, Fix, Review.
- If the user asks for alternatives or comparison: Isolated Race.
- If the prompt asks "how should we..." or "review this approach": Read-only Discussion.

### Execution Preview

Before execution, show a preview that users can trust:

```text
Workflow: Plan, Implement, Review
Workspace: botgroup.chat-desktop

1. Plan        Claude Code   read-only
2. Implement   Codex         write
3. Review      Claude Code   read-only
4. Revise      Codex         write if review requests changes, max 2 loops
```

Controls:

- change workflow
- swap agent
- change permission mode
- edit stage prompt
- run

This preview is the UX equivalent of Claude Code showing a generated workflow plan before running.

## Task Run View

The task detail page should not be a plain chat transcript. It should be an execution cockpit with a conversation lane.

Recommended layout:

```text
Header
  task title / status / workspace / workflow / stop button

Main
  left or top: stage timeline
  center: selected stage output and conversation
  right: context panel

Footer
  continue input / rerun selected stage / ask specific agent
```

### Stage Timeline

The timeline is the user's anchor.

Each stage card should show:

- stage label
- assigned agent
- mode: write or read-only
- status: pending, running, completed, failed, cancelled, skipped
- duration
- retry count
- output summary

Example:

```text
Done     Plan          Claude Code   1m 12s
Running  Implement     Codex         3m 04s
Pending  Review        Claude Code
Pending  Revise        Codex         conditional
```

### Stage Output

For each stage, separate signal from noise:

- Summary
- Files changed
- Commands run
- Validation result
- Full log
- Raw CLI output

Large logs should be collapsed by default. Errors, auth issues, failed commands, and final conclusions should stay visible.

### Context Panel

The right panel should answer "where did this run and what did it touch?"

Suggested tabs:

- Overview: workflow, agents, permissions, timestamps
- Workspace: cwd, git branch, dirty status
- Changes: diff summary, changed files
- Logs: per-agent task logs
- Worktrees: paths, base SHA, cleanup actions

## Custom Workflow Builder

The first version should be a visual and natural-language builder, not a script editor.

### Natural Language Entry

Let users create a workflow by describing it:

```text
First ask Claude to plan, then let Codex implement, then ask Claude to review.
If review fails, send it back to Codex once.
```

The app converts that into a structured workflow draft and asks for confirmation.

### Visual Editor

The editor should expose a small, safe DSL:

| Field | Meaning |
| --- | --- |
| Stage name | User-facing step label |
| Agent | Which CLI profile runs |
| Mode | `write` or `readOnly` |
| Prompt | Stage instruction |
| Input | Original request, previous output, selected artifact |
| Next | Next stage, done, or conditional branch |
| Loop limit | Maximum review/revise loops |

Review stages can have a decision contract:

```text
REVIEW_DECISION: approved
REVIEW_DECISION: revise
```

This keeps the runtime predictable while still allowing model-driven judgment.

### Advanced Mode

Advanced mode can expose graph features later:

- parallel stage
- reduce stage
- branch by structured output
- human approval gate
- stage artifacts
- rerun from stage

Do not expose raw JavaScript until the app has a sandbox, permission model, cost limits, and debuggable run history.

## Workflow Runtime Model

The runtime should be deterministic around orchestration and flexible inside each agent call.

Recommended internal model:

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

Execution should create a workflow run:

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

Each stage run can continue to use the existing CLI task/log mechanism.

## Safety Model

Coding agents can modify files and run commands, so safety must be visible.

### Permission Modes

Stage-level mode:

- Read-only: analyze, inspect, review. Should run in a copied workspace or strict read-only context when possible.
- Write: can modify files and run validation.

Task-level approval:

- Auto: run without asking for each stage.
- Ask before run: confirm the execution plan.
- Ask before write: read-only stages run automatically, write stages require confirmation.

### Worktree Rules

Use worktree isolation for competing or parallel write workflows.

Rules:

- If original workspace is dirty, block isolated race or ask the user to choose another mode.
- Do not auto-stash.
- Do not auto-commit.
- Do not auto-merge.
- Preserve worktree paths until user cleans them.

### Stop and Retry

Stop should mean:

- cancel currently running CLI processes
- prevent future stages from starting
- mark pending stages as skipped or cancelled

Retry options:

- retry failed stage
- rerun from selected stage
- continue with a new instruction
- start new isolated task from this task

## UX Copy

Use user-facing workflow names, not internal strategy names.

Recommended labels:

| Internal concept | User label |
| --- | --- |
| router | Quick Fix |
| pipeline | Relay Development |
| review custom workflow | Plan, Implement, Review |
| race | Isolated Race |
| discussion | Read-only Discussion |
| task session policy | Isolate context per task |
| worktree per agent | Separate workspace per agent |

Use verbs in actions:

- Run workflow
- Stop task
- Retry stage
- Rerun from here
- Save as workflow
- Compare results
- Adopt this result
- Clean worktree

Avoid making the user think in implementation vocabulary:

- Avoid "CLI group".
- Avoid "strategy" in primary UI.
- Avoid "execution plan" unless inside advanced preview.
- Avoid "DAG" in user copy.

## MVP Scope

### Phase 1: Task-first Shell

Deliver the product shape:

- Task list is the default CLI area.
- New Task starts from prompt + workspace + workflow.
- Task detail shows a stage timeline.
- Existing CLI execution remains the underlying runner.
- Built-in workflows cover Quick Fix, Plan/Implement/Review, Diagnose/Fix/Review, Isolated Race.

Do not build the full custom workflow editor yet.

### Phase 2: Workflow Templates

Deliver reusable workflows:

- Workflow library.
- Save current run as workflow.
- Edit stage prompts, agent assignment, mode, max loops.
- Preview before run.
- Store workflow snapshots on each task.

### Phase 3: Custom Workflow Builder

Deliver user-defined orchestration:

- Natural-language to workflow draft.
- Visual stage editor.
- Conditional review/revise loops.
- Human approval gate.
- Rerun selected stage.

### Phase 4: Advanced Orchestration

Deliver higher-order patterns:

- parallel stage
- reduce/summarize stage
- race result comparison
- artifact passing between stages
- structured decision output

### Phase 5: Script Runtime, If Needed

Only consider a script runtime after the declarative builder proves insufficient.

Requirements before script runtime:

- sandboxed interpreter
- no direct filesystem access from scripts
- only approved APIs such as `runAgent`, `readArtifact`, `setArtifact`
- max concurrent agents
- max run time
- kill/resume semantics
- full run audit log

## Data Model Draft

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

## Implementation Notes

The new product shape can still reuse the current engine pieces:

- single CLI execution remains a local process run
- stage execution can call the existing CLI run path
- task logs can stay as JSONL files
- worktree preparation can stay in the backend
- workflow definitions and task timelines can start in frontend persistence, then move to SQLite when stable

The important product change is not a new runner. It is making the runner visible through task and workflow concepts.

## Acceptance Criteria

The design is implemented well when:

1. A new user can create a development task without first understanding groups.
2. Before a task runs, the user can see the exact stages, agents, and write/read-only modes.
3. During a task, the user can tell what is running now and what will run next.
4. After a task, the user can inspect changed files, logs, final summary, and worktree paths.
5. A failed task remains useful: users can retry a stage, continue the task, or start a new task from it.
6. A user can save a successful orchestration as a workflow template.
7. Custom workflows can express review/revise loops without exposing script code.

## Open Questions

- Should workflow generation from natural language call a local CLI agent or a direct LLM provider?
- Should read-only stages run in temporary copies by default, even when slower?
- Should task messages remain chat-like, or should stage summaries become the primary artifact?
- Should workflow templates be workspace-specific or global by default?
- How much of the workflow run history should move from frontend persistence to SQLite in the first release?

## Recommendation

Build the new product around a task-first workbench:

```text
Tasks are the destination.
Workflows are the reusable product surface.
Agents are configurable workers.
Chat is the transcript, not the app model.
```

This keeps the experience approachable for normal users while leaving enough room to grow toward Claude Code-style dynamic workflows later.
