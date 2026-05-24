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

## UX Rules

- Do not put temporary task chats in the primary group list.
- Do not present a fixed development group as a normal chat room.
- Keep task history searchable and filterable by status, workspace, template, and agent.
- Let users continue a completed task from its own task chat.
- Let users create a new task from an old task when the next request should be isolated.
- Use group-chat language inside a task: agents speak as participants, execution output appears as collapsible process blocks, and review/fix loops appear as stages.

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

## Success Criteria

- A user can understand the CLI area as "my development tasks" without learning a fixed development group concept.
- Each coding request creates an isolated task chat.
- Agent collaboration still feels like a group chat inside each task.
- Old tasks are easy to find, continue, retry, archive, or delete.
- Team configuration remains reusable through templates.
