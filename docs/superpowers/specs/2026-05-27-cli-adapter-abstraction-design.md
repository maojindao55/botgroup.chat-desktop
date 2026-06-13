# CLI Adapter Abstraction Design

## Goal

Make CLI adapters a first-class extension point for development tasks, so Codex, Claude, OpenCode, Cursor, and future adapters share one registry-driven path for capabilities, session reuse, stream parsing, runtime checks, and command construction.

## Scope

This pass keeps the existing execution protocol and UI behavior. It does not add a user-facing plugin marketplace or arbitrary custom parser DSL. The design focuses on centralizing adapter metadata and replacing scattered adapter conditionals with capability checks.

## Frontend Design

Add `src/config/cliAdapters.ts` as the frontend source of truth. Each adapter definition contains:

- `id`, `label`, and optional `defaultBinary`
- capability flags such as `toolSession` and `sessionTitle`
- `streamMode`, which maps an adapter to one of the supported stream parser families
- explicit session argument names used to avoid injecting duplicate session IDs

Consumers use helpers such as `getCLIAdapterDefinition`, `supportsCliToolSession`, `adapterUsesOpenCodeSessionTitle`, and `hasExplicitToolSessionArg`.

## Development Task Snapshot

Existing tasks currently snapshot template IDs but resolve member adapter settings live. A later compatibility step should add member runtime snapshots to each task. This implementation keeps stored task shape compatible and first centralizes adapter behavior; it will avoid broad storage migration in the same change.

## Stream Handling

`request.ts` keeps the current parser implementations but chooses them through `streamMode`. This reduces hard-coded adapter checks at call sites while keeping parser-specific rendering intact.

## Backend Design

Tauri keeps the current `cli_run` command but centralizes backend adapter metadata through a small adapter definition table. Command assembly is split into adapter-specific builder helpers so adding an adapter has a clear backend change point.

## Testing

Add frontend tests for adapter registry behavior and session capability decisions. Extend existing CLI tool session tests to prove session injection uses registry capabilities. Keep existing Rust command-builder tests passing after backend refactor.
