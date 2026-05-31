# Mention Autocomplete Design

## Goal

Chat inputs should support member mention autocomplete. When the user types `@` or `@part`, the app shows current group members and lets the user insert `@MemberName ` without changing existing send behavior.

## Scope

- Cover the visible chat inputs in `ChatUI`, `CLITaskUI`, and `AgentChatUI`.
- Candidate members come from the current group or task context, not from the full member library.
- The current user is not included in suggestions.
- Existing CLI task mention routing remains unchanged; autocomplete only helps insert the existing `@member` syntax.

## UX Behavior

- Open suggestions when the token before the caret starts with `@`.
- Filter by case-insensitive substring against member name and id.
- Support mouse click, `ArrowUp`, `ArrowDown`, `Enter`, `Tab`, and `Escape`.
- Insertions replace only the active `@token` and add one trailing space.
- If there is no match, do not show the panel.

## Architecture

- Add a reusable mention utility for detecting active mention queries and replacing text.
- Add a shared `MentionTextarea` React component that wraps an Antd `TextArea`-style input and renders the suggestion panel.
- Use the shared component in `ChatUI`, `AgentChatUI`, and the Antd textarea path in `CLITaskUI`.
- For the Lobe `ChatInputArea.Inner` path in `CLITaskUI`, render the same suggestion panel around the existing input and call the shared utility for replacement.

## Testing

- Unit test mention detection and replacement with caret positions, Chinese names, and no-match cases.
- Build verification should cover TypeScript integration.
