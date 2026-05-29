# CLI Task Chat Model Hint Design

## Goal

In the current CLI task chat, agent message headers show only the AI member name, for example `Codex` or `ClaudeCode`. Add a lightweight model hint after the name when the model can be inferred from the CLI member's configured `extraArgs`.

The UI should show:

- `Codex · gpt-5-codex` when `extraArgs` contains a supported model argument.
- `Codex` unchanged when no model argument can be inferred.
- `Codex · gpt-5-codex · review` when the message also has a stage label.

This feature is display-only. It must not change CLI execution behavior.

## Scope

Only infer model names from CLI `extraArgs`.

Supported argument forms:

- `--model gpt-5-codex`
- `--model=gpt-5-codex`
- `-m gpt-5-codex`
- `-m=gpt-5-codex`

Out of scope:

- Inferring from environment variables.
- Reading external CLI config files.
- Calling CLI binaries to query the active model.
- Guessing adapter defaults when no explicit model argument exists.

## Architecture

Add a small pure utility for model inference, likely near CLI adapter/task helpers:

```ts
inferCliModelFromArgs(extraArgs?: string[] | null): string | undefined
```

The function should inspect the tokenized `extraArgs` array and return the first valid model value from the supported forms. Invalid or missing values return `undefined`.

`CLITaskMemberSnapshot` should gain an optional `modelHint?: string` field. `createCLITaskMemberSnapshots()` should populate it from each CLI member's `cli.extraArgs`. This keeps model display stable for new task history.

Old tasks without `modelHint` can fall back to resolving the current member and inferring from its current `extraArgs` at render time. If neither source has a value, the existing name remains unchanged.

## Data Flow

1. User creates or continues a CLI task.
2. Task creation snapshots each selected CLI member.
3. The snapshot stores `modelHint` if `extraArgs` contains a supported model argument.
4. When rendering agent message metadata, `CLITaskUI` resolves the message's CLI member.
5. The displayed sender label becomes `${baseAgentName} · ${modelHint}` only when a model hint exists.

The stored `agentName` in existing messages does not need to be rewritten. The appended model hint should be derived during rendering. When a message has a `stageLabel`, the render order should be:

```text
base agent name · model hint · stage label
```

This keeps the model directly after the AI name instead of after the stage label.

## Display Rules

- Append the model hint only for AI/CLI agent messages.
- Preserve the existing user message layout.
- Avoid duplicate suffixes if a future message name already contains the same model hint.
- Do not show adapter names as model names.
- Keep avatar lookup based on the base agent name, not the appended display label.
- Keep stage labels after the model hint, for example `Codex · gpt-5-codex · review`.

## Error Handling

Inference should be conservative:

- `--model` or `-m` with no following value returns no hint.
- A following token that starts with `-` returns no hint.
- Empty strings and whitespace-only values return no hint.
- Unknown argument formats are ignored.

No runtime error should block chat rendering.

## Testing

Add focused unit tests for the inference helper:

- `--model value`
- `--model=value`
- `-m value`
- `-m=value`
- missing model value
- next token is another flag
- no model args

Add a focused rendering or mapping test if there is an existing lightweight seam for chat row metadata. If not, keep the UI change simple and cover the data helper thoroughly.

## Acceptance Criteria

1. A CLI member configured with `extraArgs: ['--model', 'gpt-5-codex']` displays agent messages as `Codex · gpt-5-codex`.
2. A CLI member configured with `extraArgs: ['--model=gpt-5-codex']` displays the same suffix.
3. A CLI member without a model argument displays the current name unchanged.
4. Existing tasks without `modelHint` continue rendering.
5. CLI execution request bodies are unchanged except for existing `extraArgs`.
