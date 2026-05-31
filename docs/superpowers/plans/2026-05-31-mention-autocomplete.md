# Mention Autocomplete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add member mention autocomplete to all visible chat input surfaces.

**Architecture:** Put mention parsing and insertion in a focused utility, then render a small shared suggestion panel near each existing input. Keep each page's send behavior unchanged and only transform text while the user is composing.

**Tech Stack:** React, TypeScript, Antd `Input.TextArea`, Lobe `ChatInputArea.Inner`, Node-based `.test.mjs` unit tests.

---

### Task 1: Mention Utility

**Files:**
- Create: `src/utils/mentionAutocomplete.ts`
- Create: `src/utils/mentionAutocomplete.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing tests**

Create tests for detecting `@` tokens, filtering by name/id, replacing only the active token, and preserving Chinese names.

- [ ] **Step 2: Run tests and confirm failure**

Run: `node src/utils/mentionAutocomplete.test.mjs`

- [ ] **Step 3: Implement utility**

Export `MentionCandidate`, `getActiveMention`, `filterMentionCandidates`, and `applyMention`.

- [ ] **Step 4: Run tests and confirm pass**

Run: `node src/utils/mentionAutocomplete.test.mjs`

### Task 2: Shared Suggestion UI

**Files:**
- Create: `src/pages/chat/components/MentionAutocomplete.tsx`

- [ ] **Step 1: Build reusable panel and hook**

Create `useMentionAutocomplete`, `MentionSuggestionPanel`, and `MentionTextArea`.

- [ ] **Step 2: Keyboard behavior**

Support `ArrowUp`, `ArrowDown`, `Enter`, `Tab`, and `Escape`, preserving normal Enter-send when no suggestion is active.

### Task 3: Wire Chat Inputs

**Files:**
- Modify: `src/pages/chat/components/ChatUI.tsx`
- Modify: `src/pages/chat/components/AgentChatUI.tsx`
- Modify: `src/pages/chat/components/CLITaskUI.tsx`

- [ ] **Step 1: Compute mention candidates per current group/task**

Use existing resolved group/task members and pass `{ id, name, avatar }` into the shared component.

- [ ] **Step 2: Replace Antd textareas**

Use `MentionTextArea` for `ChatUI`, `AgentChatUI`, and the Antd textarea path in `CLITaskUI`.

- [ ] **Step 3: Wrap Lobe task composer**

Use `useMentionAutocomplete` and `MentionSuggestionPanel` around `ChatInputArea.Inner`.

### Task 4: Verify

**Files:**
- No new source files.

- [ ] **Step 1: Run unit tests**

Run: `node src/utils/mentionAutocomplete.test.mjs`

- [ ] **Step 2: Run CLI test suite**

Run: `npm run test:cli`

- [ ] **Step 3: Run build**

Run: `npm run build`
