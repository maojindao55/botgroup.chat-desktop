# AgentChatUI CLI Attachments Design

## Goal

`AgentChatUI` should let users attach photos and common files to a message so CLI agents can access those files through their original local paths.

This feature is path-based. It does not upload, copy, encode, or read file contents during send.

## Scope

- Support user-selected images and common document/code files:
  - Images: `png`, `jpg`, `jpeg`, `webp`, `gif`
  - Documents/text: `pdf`, `txt`, `md`, `json`, `csv`, `log`
  - Code/config: `ts`, `tsx`, `js`, `jsx`, `py`, `rs`, `go`, `java`, `php`, `html`, `css`, `scss`, `yaml`, `yml`, `toml`, `xml`, `sh`
- Store only original absolute file paths and lightweight metadata in chat messages.
- Allow up to 10 attachments per message.
- Apply a front-end file size limit of 50 MB per attachment.
- Show pending attachments before send and sent attachments inside message bubbles.
- Show image attachments as thumbnails/previews when the path is still readable.
- Show non-image attachments as compact file rows with filename, type, size, and path.
- If an original path no longer exists, keep the historical attachment entry and show it as unavailable.

Out of scope:

- Uploading files to a server.
- Copying files into the Tauri app data directory.
- Reading file contents into the prompt.
- Sending OpenAI-style multimodal image payloads to LLM agents.
- Drag-and-drop and paste upload support in the first version.

## Message Model

Extend the local `ChatMessage` and persisted `ChatSessionMessage` shapes with optional `attachments`.

```ts
export interface ChatAttachment {
  id: string;
  kind: 'image' | 'document' | 'code';
  name: string;
  path: string;
  mimeType?: string;
  size?: number;
  extension?: string;
}
```

Compatibility rules:

- Historical messages without `attachments` continue to load as empty attachment lists.
- Storage sanitization keeps attachment metadata but still strips large fields such as base64 data.
- `content` remains the searchable and title-generation text source for the first version.

## UX Behavior

The compose area gets an attachment button next to the text input. Selecting files adds them to a pending attachment tray above the input.

Pending attachment behavior:

- Show image thumbnails for image files.
- Show document/code chips for non-image files.
- Let users remove individual pending attachments before send.
- Disable send only when both text and attachments are empty.
- Keep existing Enter-to-send behavior.

Sent message behavior:

- Render attachments below the message text in the same bubble.
- User messages can contain text only, attachments only, or both.
- Image preview uses the existing local image rendering approach with Tauri-safe file URLs.
- Non-image rows show the original path so the user can confirm what the CLI agent received.

## Prompt Injection For CLI Agents

When a user sends attachments, `AgentChatUI` builds the agent input from the text plus an attachment section.

Example:

```text
用户消息：
请分析这个截图和日志

附件：
- screenshot.png (image/png, 1.2 MB): /Users/me/Desktop/screenshot.png
- error.log (text/plain, 45 KB): /Users/me/Desktop/error.log
```

If the user sends attachments without text:

```text
用户消息：
请查看这些附件。

附件：
- screenshot.png (image/png, 1.2 MB): /Users/me/Desktop/screenshot.png
```

This composed prompt is passed to `executeAgentStrategy` as `userMessage`. Conversation history may include a compact attachment summary for recent user messages, but should not include thumbnails or binary data.

LLM agents receive the same text summary. They are not expected to inspect files unless their runtime supports local file access.

## Local File Access

Use the Tauri file dialog to select files and return original local paths. The Tauri command should also stat selected files and return lightweight metadata such as name, size, extension, and inferred MIME type.

No file is copied or persisted outside the original path.

Path failure handling:

- If a path is missing during render, show an unavailable state.
- If a path is selected but does not match the allowed type list, reject it before it enters the pending tray.
- If a selected file exceeds 50 MB, reject it before it enters the pending tray.

## Architecture

Add a small attachment utility module, for example `src/utils/chatAttachments.ts`, to keep UI logic out of `AgentChatUI`:

- `classifyAttachment(path, fileMeta?)`
- `isAllowedAttachment(attachment)`
- `formatAttachmentForPrompt(attachment)`
- `formatAttachmentsForHistory(attachments)`
- `resolveAttachmentPreviewSrc(attachment)`

Add or extend a Tauri command for multi-file selection if the existing API only covers directories. The command should return selected file paths and optional metadata. In non-Tauri browser dev mode, attachment selection should show an unsupported warning unless a test hook supplies path-like fixtures, because browser file inputs do not expose original absolute paths.

`AgentChatUI` changes:

- Track `pendingAttachments`.
- Include attachments when creating the local user message.
- Use the composed prompt for `executeAgentStrategy`.
- Persist attachments through `localToStoredMessages` and `storedToLocalMessages`.
- Render attachment previews inside message bubbles.

`ChatSession` changes:

- Add the shared `ChatAttachment` type near `ChatSessionMessage`.
- Preserve attachments in `sanitizeMessageForStorage`.
- Keep search/title behavior text-first in the first implementation.

## Error Handling

- Unsupported type: show a concise Antd warning and skip that file.
- Oversized file: show a concise Antd warning and skip that file.
- Missing path on render: show the attachment row with an unavailable status.
- File dialog cancel: no-op.
- Duplicate selected path in one pending tray: keep one entry.

## Testing

Unit tests:

- Attachment type classification for image, document, code, and unsupported files.
- Prompt formatting with text plus attachments and attachments-only messages.
- Storage sanitization preserves attachment metadata and strips no large payloads.

Integration/static tests:

- `AgentChatUI` uses composed CLI prompt when attachments are present.
- Historical messages without `attachments` still convert correctly.

Manual verification:

- Send text plus an image to a CLI agent and confirm the prompt includes the original image path.
- Send attachments-only and confirm CLI agent receives the fallback user message plus path list.
- Reload the app and confirm sent attachment rows remain visible.
- Move/delete the original file and confirm the historical message shows an unavailable attachment state.

## Success Criteria

- Users can attach images and common documents/code files in `AgentChatUI`.
- CLI agents receive original local file paths in the prompt.
- The app does not store base64 file data or copy files.
- Existing text-only chat behavior remains unchanged.
- Old sessions continue to load without migration errors.
