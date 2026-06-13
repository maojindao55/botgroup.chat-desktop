# CLI Coding Agent Task Chat Design

## Decision

CLI Coding Agent should not use a fixed development group as the primary user object. The primary object should be a development task. Each task opens a temporary task chat where coding agents collaborate.

This keeps the botgroup.chat product line intact: the chat experience still happens as a group chat, but the group is created for a concrete coding task instead of being a long-lived channel.

## Product Model

The CLI product has two visible concepts:

- Development task: the main object shown in the left sidebar. A task contains the user request, workspace, participating agents, execution logs, reviews, retries, and final result.
- Team template: a reusable configuration selected when creating a task. It defines members, workflow strategy, approval mode, workspace defaults, and session reuse policy.

The fixed development group becomes a template, not a destination.

## Information Architecture

The left sidebar should show development tasks directly, not fixed CLI groups.

Example:

```text
Development Tasks
  - Optimize OpenCode output folding
  - Fix Codex workspace handling
  - Implement login page
  - Review current diff
```

A task detail page behaves like a temporary group chat:

```text
Task header:
  title / status / workspace / template / actions

Timeline:
  user request
  Codex implementation
  Claude Code review
  Codex fix
  verification result

Composer:
  continue the task
  ask a specific agent to continue
  retry failed stage
```

## Task Creation

Starting a new CLI task should be direct:

1. User clicks New Task or types a coding request from the development task area.
2. The product selects a default team template or lets the user choose one.
3. The user confirms workspace and execution policy when needed.
4. The system creates a temporary task chat.
5. Agents join the task chat according to the template and workflow.

The created task inherits settings from the selected template, but it owns its runtime state.

## Data Boundaries

A team template stores stable preferences:

- template name and description
- agent members
- default workflow, such as quick response, write then review, multi-solution, or isolated race
- default approval mode
- default workspace preference
- session reuse policy

A task stores runtime state:

- original request
- resolved prompt
- selected template snapshot
- workspace and worktree paths
- participating agents
- CLI task IDs
- tool session IDs
- streamed messages and final content
- status, errors, retries, adoption state, and archive state

Template changes should not rewrite existing tasks. Existing tasks keep the template snapshot they were created with.

## Type Model Draft

The implementation can keep `CLIGroup` during migration, but new UI code should think in these names:

```ts
type CLITaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'timeout' | 'archived';

interface CLITeamTemplate {
  id: string;
  name: string;
  description: string;
  memberIds: string[];
  workspacePath?: string;
  approvalMode: 'auto' | 'ask';
  timeout: number;
  showStderr: boolean;
  strategy: CLIStrategy;
  executionPlan?: Partial<CLIExecutionPlan>;
  sessionPolicy: 'task' | 'workspace' | 'template';
}

interface CLIDevelopmentTask {
  id: string;
  title: string;
  prompt: string;
  status: CLITaskStatus;
  templateId: string;
  templateSnapshot: CLITeamTemplate;
  workspacePath: string;
  createdAt: string;
  updatedAt: string;
  agentTaskIds: string[];
  messages: CLITaskMessage[];
}

interface CLITaskMessage {
  id: string;
  taskId: string;
  role: 'user' | 'agent' | 'system';
  agentId?: string;
  agentName?: string;
  content: string;
  status?: CLITaskStatus;
  cliCwd?: string;
  cliBranch?: string;
  baseSha?: string;
  toolSessionId?: string;
}
```

For the first implementation, these types can live in frontend code and adapt existing persisted CLI task records instead of requiring a full storage migration.

## Session Policy

Session reuse must be explicit because coding tasks need isolation by default.

- `task`: default. Each development task owns its CLI tool sessions. Continuing the task reuses those sessions.
- `workspace`: reuse sessions across tasks in the same workspace and agent. This is useful for users who expect CLI tools to keep long-running context.
- `template`: reuse sessions across every task created from the same team template. This is powerful but riskier and should not be the default.

The current `cliToolSessionKey(groupId, agentId, workspacePath)` should be replaced or wrapped by a policy-aware key. The default task key should include `developmentTaskId`.

## First Implementation Scope

Build this in phases. Do not rewrite the CLI execution engine first.

Phase 1 should deliver the product shape:

- Add a CLI task list as the primary sidebar experience for CLI mode.
- Treat existing CLI groups as team templates.
- Let the user create a new development task from a selected template.
- Open each development task as its own temporary chat timeline.
- Keep `executeCLIStrategy` and `/api/cli/run` as the execution path.
- Store task messages in frontend state/local persistence if needed, while continuing to use existing CLI task logs for execution history.

Phase 1 should not include:

- hard migration of all old CLI group data
- new backend tables unless unavoidable
- global task search
- sharing or collaboration permissions
- deleting old group concepts from AI and Agent chat

Phase 2 can refine persistence and management:

- durable task message storage
- task archive/delete
- template management screen
- task filters by status, workspace, template, and agent
- policy-aware CLI session reuse

Phase 3 can add advanced workflows:

- create a new task from an existing task
- compare tasks
- adopt race results into the main workspace
- global task inbox across all templates

## UI Routing

The current app routes groups by query index, for example `?id=...`. The task-first CLI UI should avoid forcing development tasks into the same group index model.

Recommended transitional route model:

```text
?view=cli-tasks
?view=cli-task&taskId=<task-id>
?view=cli-template&templateId=<template-id>
```

If changing routing is too large for Phase 1, keep the current route and implement task selection inside the CLI area, but do not add temporary tasks to the primary group list.

## Existing Code Mapping

Current code can be adapted instead of replaced:

- `CLIGroup` becomes the initial source for `CLITeamTemplate`.
- `CLIGroupSettings` becomes template settings plus task history entry points.
- `ChatUI.handleSendCLIMessage` becomes "create task and run selected template".
- `messages` should be scoped to the selected development task for CLI mode.
- `/api/cli/tasks/list` already returns execution task records and can back the task list.
- `/api/cli/tasks/log` can remain the source for raw execution logs.
- `executeCLIStrategy` can continue to schedule agents, prepare worktrees/copies, stream output, and report per-agent task IDs.

## UX Rules

- Do not put temporary task chats in the primary group list.
- Do not present a fixed development group as a normal chat room.
- Keep task history searchable and filterable by status, workspace, template, and agent.
- Let users continue a completed task from its own task chat.
- Let users create a new task from an old task when the next request should be isolated.
- Use group-chat language inside a task: agents speak as participants, execution output appears as collapsible process blocks, and review/fix loops appear as stages.
- Show task status prominently in the task list and task header.
- Make "continue this task" different from "start a new task from this task".
- A failed agent run should not hide the task. It should leave the task open with retry actions.
- Template settings should be reachable, but not the main focus of the CLI area.

## Why Not Fixed Development Groups

Fixed groups make sense for role chat and expert chat because conversation continuity is the product. For coding agents, the real unit of work is the task. Mixing many coding requests in one fixed group creates unclear context, tangled execution history, and risky session reuse.

Temporary task chats are cleaner:

- one task has one context
- workspace and worktree state are explicit
- retries and reviews belong to the task
- archive, share, delete, and continue are simple
- the sidebar reflects what users actually want to resume

## Migration From Current Model

Current CLI groups can be migrated conceptually as team templates.

Existing fields map as follows:

- group name -> template name
- group members -> template members
- strategy and execution plan -> template workflow
- workspace path -> template default workspace
- task history -> development task list

The implementation should avoid a hard data migration at first. It can introduce the task-first UI while adapting current CLI group configuration as the initial template source.

## Open Implementation Notes

- The current CLI task persistence already has task IDs, logs, statuses, cwd, and agent metadata. It can become the backbone of the development task list.
- The current CLI group settings panel should eventually become template settings.
- The current chat timeline should be scoped to a task, not the template.
- Tool session reuse must be keyed by task and agent unless the selected template explicitly enables cross-task reuse.

## Acceptance Tests

The implementation is acceptable when these user flows work:

1. A user opens the CLI area and sees development tasks, not fixed development groups.
2. A user creates a new task from a default template, runs Codex/Claude/OpenCode, and sees a task chat timeline.
3. A second task from the same template starts with isolated messages and isolated default tool sessions.
4. A user can continue an existing task and reuse that task's CLI tool sessions.
5. A user can retry a failed agent run inside the same task.
6. A user can open template settings and change members/workflow for future tasks without rewriting old tasks.
7. Old CLI group configuration still works as the initial team template source.

Recommended verification commands:

```bash
npm run test:cli
npm run test:llm
npm run build
```

Add or update focused tests for:

- converting a `CLIGroup` into a `CLITeamTemplate`
- creating a development task with a template snapshot
- session key generation for task-scoped reuse
- keeping task messages isolated between two tasks

## Success Criteria

- A user can understand the CLI area as "my development tasks" without learning a fixed development group concept.
- Each coding request creates an isolated task chat.
- Agent collaboration still feels like a group chat inside each task.
- Old tasks are easy to find, continue, retry, archive, or delete.
- Team configuration remains reusable through templates.
