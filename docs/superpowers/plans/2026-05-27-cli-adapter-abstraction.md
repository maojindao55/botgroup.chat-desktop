# CLI Adapter Abstraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Centralize CLI adapter behavior behind registries and capability helpers without changing existing user-facing execution behavior.

**Architecture:** Add a frontend adapter registry consumed by task execution, session reuse, member typing, and stream dispatch. Refactor the Rust command builder around backend adapter definitions and per-adapter command helpers while preserving current commands.

**Tech Stack:** TypeScript, React, Node-based tests, Rust/Tauri.

---

### Task 1: Frontend Adapter Registry

**Files:**
- Create: `src/config/cliAdapters.ts`
- Create: `src/config/cliAdapters.test.mjs`
- Modify: `package.json`

- [ ] Write failing tests for registry lookup, unknown fallback, capability checks, and explicit session args.
- [ ] Implement `CLIAdapterDefinition` and helpers.
- [ ] Add the registry test to the appropriate npm test script.
- [ ] Run the new registry test and existing CLI session tests.

### Task 2: Session Reuse Uses Capabilities

**Files:**
- Modify: `src/engine/cliToolSessions.ts`
- Modify: `src/engine/cliToolSessions.test.mjs`
- Modify: `src/pages/chat/components/CLITaskUI.tsx`
- Modify: `src/config/cliTasks.ts`

- [ ] Change tool-session injection to call `supportsCliToolSession` and `hasExplicitToolSessionArg`.
- [ ] Change task UI session persistence to use `supportsCliToolSession`.
- [ ] Change OpenCode title checks to use adapter metadata where possible.
- [ ] Run CLI task/session tests.

### Task 3: Stream Dispatch Uses Stream Mode

**Files:**
- Modify: `src/utils/request.ts`
- Modify: `src/utils/markdownContent.ts`
- Modify: `src/utils/markdownContent.test.mjs`

- [ ] Read adapter `streamMode` once per CLI run.
- [ ] Dispatch stdout parsing by stream mode rather than adapter ID at the call site.
- [ ] Generalize completed CLI command detail normalization for registered command groups.
- [ ] Run LLM/stream tests.

### Task 4: Backend Adapter Definition Boundary

**Files:**
- Modify: `src-tauri/src/cli.rs`

- [ ] Add backend adapter definitions for binary lookup.
- [ ] Split each command assembly branch into adapter-specific helper functions.
- [ ] Keep existing command-builder tests passing.
- [ ] Run Rust CLI tests.

### Task 5: Final Verification

**Files:**
- No new files.

- [ ] Run `npm run test:cli`.
- [ ] Run `npm run test:llm`.
- [ ] Run `npm run test:product`.
- [ ] Run targeted Rust tests for `cli`.
- [ ] Review git diff to ensure unrelated dirty files were not overwritten.
