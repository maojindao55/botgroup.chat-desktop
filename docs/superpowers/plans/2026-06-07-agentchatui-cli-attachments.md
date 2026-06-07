# AgentChatUI CLI Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add path-based attachments to `AgentChatUI` so CLI agents receive original local file paths for images and common document/code files.

**Architecture:** Store attachment metadata on chat messages, never file bytes. Tauri supplies original file paths and metadata through a new file-picker command; React renders pending/sent attachments and composes a text prompt that includes the selected paths before calling `executeAgentStrategy`.

**Tech Stack:** React 19, TypeScript, Ant Design, lucide-react, Zustand session storage, Tauri v2 custom commands, Node `.mjs` tests, Rust `cargo test`.

---

## File Structure

- Modify `src/config/chatSessions.ts`: define the shared `ChatAttachment` type and preserve sanitized attachment metadata in persisted messages.
- Modify `src/config/chatSessions.test.mjs`: cover attachment sanitization and legacy messages without attachments.
- Create `src/utils/chatAttachments.ts`: pure attachment classification, validation, prompt formatting, history summary, file-size formatting, and preview URL resolution helpers.
- Create `src/utils/chatAttachments.test.mjs`: focused unit tests for the pure helper API.
- Modify `src-tauri/src/api.rs`: add `select_chat_attachments`, `chat_attachment_exists`, and metadata helpers using the existing `rfd` dependency.
- Modify `src-tauri/src/lib.rs`: register the new Tauri commands.
- Create `src/pages/chat/components/ChatAttachments.tsx`: reusable pending/sent attachment tray and local image preview rendering.
- Modify `src/pages/chat/components/AgentChatUI.tsx`: manage pending attachments, invoke file selection, store attachments on user messages, render attachments, and pass composed prompts to agents.
- Modify `src/i18n/resources/en-US/chat.json` and `src/i18n/resources/zh-CN/chat.json`: add user-facing attachment labels and warnings.

The current worktree has unrelated unstaged changes in `src-tauri/Cargo.lock`, `src/pages/chat/components/AgentChatUI.tsx`, and `src/pages/chat/components/ChatUI.tsx`. Implementers must preserve those changes and only edit around them.

---

### Task 1: Persist Attachment Metadata

**Files:**
- Modify: `src/config/chatSessions.ts`
- Modify: `src/config/chatSessions.test.mjs`

- [ ] **Step 1: Write the failing sanitization tests**

Append this block after the existing `sanitizeMessageForStorage: preserves agentTaskId + adapter round-trip` block in `src/config/chatSessions.test.mjs`:

```js
// ---- sanitizeMessageForStorage: preserves safe attachment metadata ----
{
  const msg = {
    id: 'm-att',
    sender: { id: 'u', name: 'Me' },
    content: 'see files',
    isAI: false,
    attachments: [
      {
        id: 'att-1',
        kind: 'image',
        name: 'screen.png',
        path: '/Users/me/Desktop/screen.png',
        mimeType: 'image/png',
        size: 1200,
        extension: 'png',
        dataUrl: `data:image/png;base64,${'A'.repeat(5000)}`,
      },
      {
        id: 'att-2',
        kind: 'code',
        name: 'main.ts',
        path: '/Users/me/project/main.ts',
        extension: 'ts',
        unknown: 'drop me',
      },
      {
        id: '',
        kind: 'image',
        name: 'bad.png',
        path: '/tmp/bad.png',
      },
    ],
  };

  const sanitized = sanitizeMessageForStorage(msg);
  assert.deepEqual(sanitized.attachments, [
    {
      id: 'att-1',
      kind: 'image',
      name: 'screen.png',
      path: '/Users/me/Desktop/screen.png',
      mimeType: 'image/png',
      size: 1200,
      extension: 'png',
    },
    {
      id: 'att-2',
      kind: 'code',
      name: 'main.ts',
      path: '/Users/me/project/main.ts',
      extension: 'ts',
    },
  ]);
  assert.ok(!JSON.stringify(sanitized).includes('base64'), 'attachment payload bytes must not be stored');
}

// ---- sanitizeMessageForStorage: omits attachments when absent or empty ----
{
  const legacy = {
    id: 'legacy',
    sender: { id: 'u', name: 'Me' },
    content: 'plain text',
    isAI: false,
  };
  const sanitizedLegacy = sanitizeMessageForStorage(legacy);
  assert.equal('attachments' in sanitizedLegacy, false, 'legacy messages stay compact');

  const emptyAttachments = sanitizeMessageForStorage({ ...legacy, attachments: [] });
  assert.equal('attachments' in emptyAttachments, false, 'empty attachment arrays are omitted');
}
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
node src/config/chatSessions.test.mjs
```

Expected: FAIL because `sanitizeMessageForStorage` does not preserve `attachments`.

- [ ] **Step 3: Implement the message type and sanitizer**

In `src/config/chatSessions.ts`, insert this type above `ChatSessionMessage`:

```ts
export type ChatAttachmentKind = 'image' | 'document' | 'code';

export interface ChatAttachment {
  id: string;
  kind: ChatAttachmentKind;
  name: string;
  path: string;
  mimeType?: string;
  size?: number;
  extension?: string;
}
```

Add this field to `ChatSessionMessage`:

```ts
  /** Path-based user attachments for CLI agents. Stores metadata only, never file bytes. */
  attachments?: ChatAttachment[];
```

Add this helper above `sanitizeMessageForStorage`:

```ts
function sanitizeAttachmentForStorage(raw: unknown): ChatAttachment | null {
  if (!raw || typeof raw !== 'object') return null;
  const attachment = raw as Partial<ChatAttachment>;
  if (!attachment.id || !attachment.name || !attachment.path) return null;
  if (attachment.kind !== 'image' && attachment.kind !== 'document' && attachment.kind !== 'code') return null;

  const sanitized: ChatAttachment = {
    id: String(attachment.id),
    kind: attachment.kind,
    name: String(attachment.name),
    path: String(attachment.path),
  };
  if (attachment.mimeType) sanitized.mimeType = String(attachment.mimeType);
  if (typeof attachment.size === 'number' && Number.isFinite(attachment.size) && attachment.size >= 0) {
    sanitized.size = attachment.size;
  }
  if (attachment.extension) sanitized.extension = String(attachment.extension).toLowerCase();
  return sanitized;
}

function sanitizeAttachmentsForStorage(raw: unknown): ChatAttachment[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(sanitizeAttachmentForStorage)
    .filter((attachment): attachment is ChatAttachment => !!attachment);
}
```

Inside `sanitizeMessageForStorage`, before `return sanitized;`, add:

```ts
  const attachments = sanitizeAttachmentsForStorage((m as ChatSessionMessage & { attachments?: unknown }).attachments);
  if (attachments.length > 0) sanitized.attachments = attachments;
```

- [ ] **Step 4: Run the test and verify it passes**

Run:

```bash
node src/config/chatSessions.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config/chatSessions.ts src/config/chatSessions.test.mjs
git commit -m "feat: persist chat attachment metadata"
```

---

### Task 2: Add Pure Attachment Utilities

**Files:**
- Create: `src/utils/chatAttachments.ts`
- Create: `src/utils/chatAttachments.test.mjs`

- [ ] **Step 1: Write the failing utility tests**

Create `src/utils/chatAttachments.test.mjs`:

```js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function importTsModule(url) {
  const source = await readFile(url, 'utf8');
  const compiled = ts.transpileModule(`${source}\n// cache-bust:${Date.now()}:${Math.random()}`, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`;
  return import(moduleUrl);
}

const mod = await importTsModule(new URL('./chatAttachments.ts', import.meta.url));

const {
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_ATTACHMENT_BYTES,
  classifyAttachmentPath,
  createChatAttachment,
  validateAttachmentCandidate,
  formatBytes,
  formatAttachmentForPrompt,
  composeMessageWithAttachments,
  formatAttachmentsForHistory,
  resolveAttachmentPreviewSrc,
} = mod;

assert.equal(MAX_ATTACHMENTS_PER_MESSAGE, 10);
assert.equal(MAX_ATTACHMENT_BYTES, 50 * 1024 * 1024);

assert.deepEqual(classifyAttachmentPath('/tmp/screen.PNG'), { kind: 'image', extension: 'png', mimeType: 'image/png' });
assert.deepEqual(classifyAttachmentPath('/tmp/readme.md'), { kind: 'document', extension: 'md', mimeType: 'text/markdown' });
assert.deepEqual(classifyAttachmentPath('/tmp/App.tsx'), { kind: 'code', extension: 'tsx', mimeType: 'text/plain' });
assert.equal(classifyAttachmentPath('/tmp/archive.zip'), null);

{
  const attachment = createChatAttachment({
    path: '/Users/me/Desktop/screen.png',
    name: 'screen.png',
    size: 1536,
  });
  assert.equal(attachment.kind, 'image');
  assert.equal(attachment.name, 'screen.png');
  assert.equal(attachment.path, '/Users/me/Desktop/screen.png');
  assert.equal(attachment.mimeType, 'image/png');
  assert.equal(attachment.extension, 'png');
  assert.equal(typeof attachment.id, 'string');
}

assert.equal(validateAttachmentCandidate(createChatAttachment({ path: '/tmp/a.png', size: 1 })).ok, true);
assert.deepEqual(validateAttachmentCandidate(null), { ok: false, reason: 'unsupported_type' });
assert.deepEqual(
  validateAttachmentCandidate(createChatAttachment({ path: '/tmp/big.pdf', size: MAX_ATTACHMENT_BYTES + 1 })),
  { ok: false, reason: 'file_too_large' },
);

assert.equal(formatBytes(0), '0 B');
assert.equal(formatBytes(1024), '1 KB');
assert.equal(formatBytes(1536), '1.5 KB');
assert.equal(formatBytes(1024 * 1024), '1 MB');

{
  const image = createChatAttachment({ path: '/Users/me/Desktop/screen.png', size: 1536 });
  assert.equal(formatAttachmentForPrompt(image), '- screen.png (image/png, 1.5 KB): /Users/me/Desktop/screen.png');
  assert.equal(
    composeMessageWithAttachments('请分析', [image]),
    '用户消息：\n请分析\n\n附件：\n- screen.png (image/png, 1.5 KB): /Users/me/Desktop/screen.png',
  );
  assert.equal(
    composeMessageWithAttachments('', [image]),
    '用户消息：\n请查看这些附件。\n\n附件：\n- screen.png (image/png, 1.5 KB): /Users/me/Desktop/screen.png',
  );
  assert.equal(formatAttachmentsForHistory([image]), '[附件: screen.png -> /Users/me/Desktop/screen.png]');
  assert.equal(resolveAttachmentPreviewSrc(image, path => `asset://${path}`), 'asset:///Users/me/Desktop/screen.png');
}

{
  const doc = createChatAttachment({ path: '/tmp/report.pdf', size: 12 });
  assert.equal(resolveAttachmentPreviewSrc(doc, path => `asset://${path}`), null);
}
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
node src/utils/chatAttachments.test.mjs
```

Expected: FAIL because `src/utils/chatAttachments.ts` does not exist.

- [ ] **Step 3: Implement the utility module**

Create `src/utils/chatAttachments.ts`:

```ts
import type { ChatAttachment, ChatAttachmentKind } from '@/config/chatSessions';

export const MAX_ATTACHMENTS_PER_MESSAGE = 10;
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

export type AttachmentValidationReason = 'unsupported_type' | 'file_too_large';

export interface AttachmentCandidate {
  path: string;
  name?: string;
  size?: number;
  mimeType?: string;
}

export interface AttachmentClassification {
  kind: ChatAttachmentKind;
  extension: string;
  mimeType: string;
}

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

const DOCUMENT_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  json: 'application/json',
  csv: 'text/csv',
  log: 'text/plain',
};

const CODE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'java', 'php', 'html', 'css', 'scss',
  'yaml', 'yml', 'toml', 'xml', 'sh',
]);

function fallbackId(): string {
  const unique = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `att-${unique}`;
}

export function basenameFromPath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  return normalized.split('/').filter(Boolean).pop() || path;
}

export function extensionFromPath(path: string): string {
  const name = basenameFromPath(path);
  const idx = name.lastIndexOf('.');
  if (idx <= 0 || idx === name.length - 1) return '';
  return name.slice(idx + 1).toLowerCase();
}

export function classifyAttachmentPath(path: string): AttachmentClassification | null {
  const extension = extensionFromPath(path);
  if (!extension) return null;
  if (IMAGE_MIME[extension]) {
    return { kind: 'image', extension, mimeType: IMAGE_MIME[extension] };
  }
  if (DOCUMENT_MIME[extension]) {
    return { kind: 'document', extension, mimeType: DOCUMENT_MIME[extension] };
  }
  if (CODE_EXTENSIONS.has(extension)) {
    return { kind: 'code', extension, mimeType: 'text/plain' };
  }
  return null;
}

export function createChatAttachment(candidate: AttachmentCandidate): ChatAttachment | null {
  const path = candidate.path.trim();
  if (!path) return null;
  const classification = classifyAttachmentPath(path);
  if (!classification) return null;
  return {
    id: fallbackId(),
    kind: classification.kind,
    name: candidate.name?.trim() || basenameFromPath(path),
    path,
    mimeType: candidate.mimeType || classification.mimeType,
    size: candidate.size,
    extension: classification.extension,
  };
}

export function validateAttachmentCandidate(
  attachment: ChatAttachment | null,
): { ok: true } | { ok: false; reason: AttachmentValidationReason } {
  if (!attachment) return { ok: false, reason: 'unsupported_type' };
  if (typeof attachment.size === 'number' && attachment.size > MAX_ATTACHMENT_BYTES) {
    return { ok: false, reason: 'file_too_large' };
  }
  return { ok: true };
}

export function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const rounded = value >= 10 || Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
  return `${rounded} ${units[unitIndex]}`;
}

export function formatAttachmentForPrompt(attachment: ChatAttachment): string {
  const mime = attachment.mimeType || attachment.extension || attachment.kind;
  const size = typeof attachment.size === 'number' ? `, ${formatBytes(attachment.size)}` : '';
  return `- ${attachment.name} (${mime}${size}): ${attachment.path}`;
}

export function composeMessageWithAttachments(content: string, attachments: ChatAttachment[]): string {
  const text = content.trim() || '请查看这些附件。';
  if (attachments.length === 0) return text;
  return `用户消息：\n${text}\n\n附件：\n${attachments.map(formatAttachmentForPrompt).join('\n')}`;
}

export function formatAttachmentsForHistory(attachments?: ChatAttachment[]): string {
  if (!attachments || attachments.length === 0) return '';
  return `[附件: ${attachments.map(att => `${att.name} -> ${att.path}`).join('; ')}]`;
}

export function resolveAttachmentPreviewSrc(
  attachment: ChatAttachment,
  convertFileSrc: (path: string) => string,
): string | null {
  if (attachment.kind !== 'image') return null;
  return convertFileSrc(attachment.path);
}
```

- [ ] **Step 4: Run tests and verify they pass**

Run:

```bash
node src/utils/chatAttachments.test.mjs
node src/utils/markdownContent.test.mjs
```

Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/chatAttachments.ts src/utils/chatAttachments.test.mjs
git commit -m "feat: add chat attachment utilities"
```

---

### Task 3: Add Tauri Attachment Commands

**Files:**
- Modify: `src-tauri/src/api.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add Rust metadata tests**

At the bottom of `src-tauri/src/api.rs`, add:

```rust
#[cfg(test)]
mod attachment_tests {
    use super::*;

    #[test]
    fn attachment_mime_from_extension_supports_allowed_types() {
        assert_eq!(attachment_mime_from_extension("png"), "image/png");
        assert_eq!(attachment_mime_from_extension("jpg"), "image/jpeg");
        assert_eq!(attachment_mime_from_extension("md"), "text/markdown");
        assert_eq!(attachment_mime_from_extension("pdf"), "application/pdf");
        assert_eq!(attachment_mime_from_extension("tsx"), "text/plain");
    }

    #[test]
    fn attachment_extension_is_lowercase() {
        let path = PathBuf::from("/tmp/Screen.PNG");
        assert_eq!(attachment_extension(&path), Some("png".to_string()));
    }

    #[test]
    fn chat_attachment_path_exists_reports_files() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("sample.txt");
        fs::write(&file, "hello").unwrap();
        assert!(chat_attachment_path_exists(file.to_string_lossy().as_ref()));
        assert!(!chat_attachment_path_exists(dir.path().join("missing.txt").to_string_lossy().as_ref()));
    }
}
```

- [ ] **Step 2: Run Rust tests and verify they fail**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml attachment_
```

Expected: FAIL because `attachment_mime_from_extension`, `attachment_extension`, and `chat_attachment_path_exists` do not exist.

- [ ] **Step 3: Implement the command in `api.rs`**

Insert this code near the existing `select_directory` command:

```rust
#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChatAttachmentCandidate {
    pub path: String,
    pub name: String,
    pub size: Option<u64>,
    pub extension: Option<String>,
    pub mime_type: String,
}

fn attachment_extension(path: &PathBuf) -> Option<String> {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .filter(|ext| !ext.is_empty())
}

fn attachment_mime_from_extension(ext: &str) -> &'static str {
    match ext {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "pdf" => "application/pdf",
        "txt" | "log" => "text/plain",
        "md" => "text/markdown",
        "json" => "application/json",
        "csv" => "text/csv",
        "ts" | "tsx" | "js" | "jsx" | "py" | "rs" | "go" | "java" | "php" | "html" | "css"
        | "scss" | "yaml" | "yml" | "toml" | "xml" | "sh" => "text/plain",
        _ => "application/octet-stream",
    }
}

fn chat_attachment_candidate(path: PathBuf) -> ChatAttachmentCandidate {
    let extension = attachment_extension(&path);
    let mime_type = extension
        .as_deref()
        .map(attachment_mime_from_extension)
        .unwrap_or("application/octet-stream")
        .to_string();
    let size = fs::metadata(&path).ok().map(|meta| meta.len());
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string_lossy().to_string());

    ChatAttachmentCandidate {
        path: path.to_string_lossy().to_string(),
        name,
        size,
        extension,
        mime_type,
    }
}

fn chat_attachment_path_exists(path: &str) -> bool {
    PathBuf::from(path.trim()).is_file()
}

#[tauri::command]
pub fn select_chat_attachments() -> Result<Vec<ChatAttachmentCandidate>, String> {
    let files = rfd::FileDialog::new()
        .add_filter(
            "Supported attachments",
            &[
                "png", "jpg", "jpeg", "webp", "gif", "pdf", "txt", "md", "json", "csv", "log",
                "ts", "tsx", "js", "jsx", "py", "rs", "go", "java", "php", "html", "css",
                "scss", "yaml", "yml", "toml", "xml", "sh",
            ],
        )
        .add_filter("All files", &["*"])
        .pick_files();

    Ok(files
        .unwrap_or_default()
        .into_iter()
        .filter(|path| path.is_file())
        .map(chat_attachment_candidate)
        .collect())
}

#[tauri::command]
pub fn chat_attachment_exists(path: String) -> bool {
    chat_attachment_path_exists(&path)
}
```

- [ ] **Step 4: Register the command**

In `src-tauri/src/lib.rs`, add `api::select_chat_attachments,` and `api::chat_attachment_exists,` immediately after `api::select_directory,` inside `tauri::generate_handler![...]`:

```rust
            api::select_directory,
            api::select_chat_attachments,
            api::chat_attachment_exists,
            api::save_image_as,
```

- [ ] **Step 5: Run Rust tests and verify they pass**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml attachment_
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/api.rs src-tauri/src/lib.rs
git commit -m "feat: add chat attachment file picker"
```

---

### Task 4: Add Attachment Rendering Components

**Files:**
- Create: `src/pages/chat/components/ChatAttachments.tsx`

- [ ] **Step 1: Create the component**

Create `src/pages/chat/components/ChatAttachments.tsx`:

```tsx
import { Image, Tooltip } from 'antd';
import { FileText, Image as ImageIcon, X } from 'lucide-react';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { createStyles } from 'antd-style';
import { useEffect, useState } from 'react';
import type { ChatAttachment } from '@/config/chatSessions';
import { formatBytes, resolveAttachmentPreviewSrc } from '@/utils/chatAttachments';

const useStyles = createStyles(({ token, css }) => ({
  list: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 8px;
  `,
  pendingList: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    width: 100%;
    max-width: 900px;
    margin: 0 auto 8px;
  `,
  item: css`
    display: inline-flex;
    align-items: center;
    gap: 8px;
    max-width: min(360px, 100%);
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 7px;
    background: ${token.colorFillQuaternary};
    padding: 6px 8px;
    color: ${token.colorText};
  `,
  thumbnail: css`
    width: 44px;
    height: 44px;
    border-radius: 6px;
    object-fit: cover;
    background: ${token.colorFillSecondary};
    flex: none;
  `,
  icon: css`
    width: 32px;
    height: 32px;
    border-radius: 6px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: ${token.colorFillSecondary};
    color: ${token.colorTextSecondary};
    flex: none;
  `,
  meta: css`
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  `,
  name: css`
    font-size: 12px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  sub: css`
    font-size: 11px;
    color: ${token.colorTextTertiary};
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  unavailable: css`
    color: ${token.colorError};
  `,
  removeButton: css`
    border: 0;
    background: transparent;
    color: ${token.colorTextTertiary};
    cursor: pointer;
    padding: 2px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    &:hover {
      background: ${token.colorFillSecondary};
      color: ${token.colorText};
    }
  `,
}));

interface AttachmentListProps {
  attachments?: ChatAttachment[];
  pending?: boolean;
  onRemove?: (id: string) => void;
  unavailableLabel?: string;
}

function attachmentSubtitle(attachment: ChatAttachment): string {
  const parts = [
    attachment.mimeType || attachment.extension || attachment.kind,
    typeof attachment.size === 'number' ? formatBytes(attachment.size) : '',
  ].filter(Boolean);
  return parts.join(' · ');
}

export function ChatAttachmentList({
  attachments = [],
  pending = false,
  onRemove,
  unavailableLabel = 'Unavailable',
}: AttachmentListProps) {
  const { styles } = useStyles();
  const [availability, setAvailability] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (pending || attachments.length === 0) return;
    let cancelled = false;
    Promise.all(
      attachments.map(async (attachment) => {
        try {
          const exists = await invoke<boolean>('chat_attachment_exists', { path: attachment.path });
          return [attachment.id, exists] as const;
        } catch {
          return [attachment.id, false] as const;
        }
      }),
    ).then((entries) => {
      if (!cancelled) setAvailability(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [attachments, pending]);

  if (attachments.length === 0) return null;

  return (
    <div className={pending ? styles.pendingList : styles.list}>
      {attachments.map((attachment) => {
        const isUnavailable = availability[attachment.id] === false;
        const previewSrc = isUnavailable ? null : resolveAttachmentPreviewSrc(attachment, convertFileSrc);
        return (
          <div key={attachment.id} className={styles.item}>
            {previewSrc ? (
              <Image
                src={previewSrc}
                alt={attachment.name}
                className={styles.thumbnail}
                preview={{ src: previewSrc }}
                fallback=""
              />
            ) : (
              <span className={styles.icon}>
                {attachment.kind === 'image' ? <ImageIcon size={16} /> : <FileText size={16} />}
              </span>
            )}
            <Tooltip title={attachment.path}>
              <span className={styles.meta}>
                <span className={styles.name}>{attachment.name}</span>
                <span className={styles.sub}>{attachmentSubtitle(attachment)}</span>
                {isUnavailable && <span className={styles.unavailable}>{unavailableLabel}</span>}
                {!pending && <span className={styles.sub}>{attachment.path}</span>}
              </span>
            </Tooltip>
            {onRemove && (
              <button
                type="button"
                className={styles.removeButton}
                onClick={() => onRemove(attachment.id)}
                aria-label={`Remove ${attachment.name}`}
              >
                <X size={14} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Run TypeScript build check**

Run:

```bash
npm run build
```

Expected: TypeScript should accept the new component or expose only unrelated existing build failures. If there are failures in this component, fix them before continuing.

- [ ] **Step 3: Commit**

```bash
git add src/pages/chat/components/ChatAttachments.tsx
git commit -m "feat: render chat attachments"
```

---

### Task 5: Integrate Attachments Into AgentChatUI

**Files:**
- Modify: `src/pages/chat/components/AgentChatUI.tsx`

- [ ] **Step 1: Add imports**

In `src/pages/chat/components/AgentChatUI.tsx`, change the lucide import:

```ts
import { Send, Square, Settings2, ChevronLeft, Puzzle, PanelLeftOpen, Paperclip } from 'lucide-react';
```

Add these imports:

```ts
import { invoke } from '@tauri-apps/api/core';
import {
  composeMessageWithAttachments,
  createChatAttachment,
  formatAttachmentsForHistory,
  MAX_ATTACHMENTS_PER_MESSAGE,
  validateAttachmentCandidate,
} from '@/utils/chatAttachments';
import { ChatAttachmentList } from './ChatAttachments';
```

Update the existing `@/config/chatSessions` import to:

```ts
import {
  truncateSessionTitle,
  type ChatAttachment,
  type ChatSessionMessage,
} from '@/config/chatSessions';
```

- [ ] **Step 2: Extend local message conversion**

Add `attachments?: ChatAttachment[];` to the local `ChatMessage` interface:

```ts
  attachments?: ChatAttachment[];
```

In `storedToLocalMessages`, add:

```ts
      attachments: m.attachments || [],
```

In `localToStoredMessages`, add:

```ts
      attachments: m.attachments || undefined,
```

- [ ] **Step 3: Add pending attachment state and picker**

Add state near `inputMessage`:

```ts
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([]);
```

Add these types and functions before `handleSendMessage`:

```ts
  type TauriAttachmentCandidate = {
    path: string;
    name?: string;
    size?: number;
    mimeType?: string;
    mime_type?: string;
  };

  const handleSelectAttachments = async () => {
    if (isLoading) return;
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
      antdMessage.warning(t('chat:attachments.tauriOnly'));
      return;
    }

    try {
      const selected = await invoke<TauriAttachmentCandidate[]>('select_chat_attachments');
      if (!selected || selected.length === 0) return;

      setPendingAttachments(prev => {
        const byPath = new Map(prev.map(att => [att.path, att]));
        for (const candidate of selected) {
          if (byPath.size >= MAX_ATTACHMENTS_PER_MESSAGE) {
            antdMessage.warning(t('chat:attachments.maxCount', { count: MAX_ATTACHMENTS_PER_MESSAGE }));
            break;
          }
          const attachment = createChatAttachment({
            path: candidate.path,
            name: candidate.name,
            size: candidate.size,
            mimeType: candidate.mimeType || candidate.mime_type,
          });
          const validation = validateAttachmentCandidate(attachment);
          if (!validation.ok && validation.reason === 'file_too_large') {
            antdMessage.warning(t('chat:attachments.fileTooLarge', { name: candidate.name || candidate.path }));
            continue;
          }
          if (!validation.ok) {
            antdMessage.warning(t('chat:attachments.unsupported', { name: candidate.name || candidate.path }));
            continue;
          }
          if (byPath.has(attachment.path)) continue;
          byPath.set(attachment.path, attachment);
        }
        return Array.from(byPath.values());
      });
    } catch (error) {
      antdMessage.error(t('chat:attachments.selectFailed', { message: error instanceof Error ? error.message : String(error) }));
    }
  };

  const handleRemovePendingAttachment = (id: string) => {
    setPendingAttachments(prev => prev.filter(attachment => attachment.id !== id));
  };
```

- [ ] **Step 4: Update send gating and user message creation**

Replace the first line of `handleSendMessage`:

```ts
    if (isLoading || !inputMessage.trim()) return;
```

with:

```ts
    if (isLoading) return;
    const attachmentsToSend = pendingAttachments;
    if (!inputMessage.trim() && attachmentsToSend.length === 0) return;
```

After `const capturedInput = inputMessage;`, add:

```ts
    const agentInput = composeMessageWithAttachments(capturedInput, attachmentsToSend);
```

Change:

```ts
    const sessionId = ensureActiveSession(capturedInput);
```

to:

```ts
    const sessionId = ensureActiveSession(capturedInput || attachmentsToSend[0]?.name || t('chat:attachments.fallbackTitle'));
```

Add attachments to the user message:

```ts
      attachments: attachmentsToSend,
```

After `setInputMessage('');`, add:

```ts
    setPendingAttachments([]);
```

- [ ] **Step 5: Compose history and agent prompt with attachment summaries**

Replace the history mapping:

```ts
        .map(m => `${m.sender.name}: ${m.content}`)
```

with:

```ts
        .map(m => {
          const attachmentSummary = formatAttachmentsForHistory(m.attachments);
          return `${m.sender.name}: ${[m.content, attachmentSummary].filter(Boolean).join('\n')}`;
        })
```

Change:

```ts
      await executeAgentStrategy(group, capturedInput, history, mutedUsers, callbacks, {
```

to:

```ts
      await executeAgentStrategy(group, agentInput, history, mutedUsers, callbacks, {
```

- [ ] **Step 6: Render sent and pending attachments**

Inside the bubble, immediately after `<ChatMarkdown ... />`, add:

```tsx
                          <ChatAttachmentList
                            attachments={message.attachments}
                            unavailableLabel={t('chat:attachments.unavailable')}
                          />
```

In the input area, immediately inside `<div className={styles.inputArea}>` and before `<div className={styles.composeShell}>`, add:

```tsx
              <ChatAttachmentList
                pending
                attachments={pendingAttachments}
                onRemove={handleRemovePendingAttachment}
              />
```

Inside `composeShell`, before `<MentionTextArea`, add:

```tsx
                <AntdButton
                  type="text"
                  onClick={handleSelectAttachments}
                  icon={<Paperclip size={16} />}
                  disabled={isLoading || pendingAttachments.length >= MAX_ATTACHMENTS_PER_MESSAGE}
                  aria-label={t('chat:attachments.add')}
                />
```

Change the send button disabled behavior by adding `disabled={!inputMessage.trim() && pendingAttachments.length === 0}` to the non-loading send button:

```tsx
                  <AntdButton
                    className={styles.composeSendButton}
                    onClick={handleSendMessage}
                    disabled={!inputMessage.trim() && pendingAttachments.length === 0}
                    icon={<Send size={16} color={BRAND_ON_PRIMARY} />}
```

- [ ] **Step 7: Run focused static tests/build**

Run:

```bash
npm run test:product
npm run build
```

Expected: `test:product` PASS. `npm run build` PASS or only fail on unrelated existing errors; any `AgentChatUI`/attachment errors must be fixed.

- [ ] **Step 8: Commit**

```bash
git add src/pages/chat/components/AgentChatUI.tsx
git commit -m "feat: send attachments to cli agents"
```

---

### Task 6: Add i18n Strings

**Files:**
- Modify: `src/i18n/resources/en-US/chat.json`
- Modify: `src/i18n/resources/zh-CN/chat.json`

- [ ] **Step 1: Add English strings**

In `src/i18n/resources/en-US/chat.json`, add this top-level object alongside existing sections such as `agentChat` and `conversation`:

```json
"attachments": {
  "add": "Add attachment",
  "fallbackTitle": "Attachments",
  "tauriOnly": "Attachments require the desktop app.",
  "unsupported": "{{name}} is not a supported attachment type.",
  "fileTooLarge": "{{name}} exceeds the 50 MB attachment limit.",
  "maxCount": "Each message can include up to {{count}} attachments.",
  "selectFailed": "Failed to select attachments: {{message}}",
  "unavailable": "File unavailable"
}
```

- [ ] **Step 2: Add Chinese strings**

In `src/i18n/resources/zh-CN/chat.json`, add the matching top-level object:

```json
"attachments": {
  "add": "添加附件",
  "fallbackTitle": "附件",
  "tauriOnly": "附件功能需要在桌面端使用。",
  "unsupported": "{{name}} 不是支持的附件类型。",
  "fileTooLarge": "{{name}} 超过 50 MB 附件大小限制。",
  "maxCount": "每条消息最多添加 {{count}} 个附件。",
  "selectFailed": "选择附件失败：{{message}}",
  "unavailable": "文件不可用"
}
```

- [ ] **Step 3: Run i18n tests**

Run:

```bash
npm run test:i18n
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/i18n/resources/en-US/chat.json src/i18n/resources/zh-CN/chat.json
git commit -m "feat: add attachment translations"
```

---

### Task 7: Final Verification

**Files:**
- Verify all files changed by prior tasks.

- [ ] **Step 1: Run unit/static test set**

Run:

```bash
node src/config/chatSessions.test.mjs
node src/utils/chatAttachments.test.mjs
node src/utils/markdownContent.test.mjs
npm run test:product
npm run test:i18n
cargo test --manifest-path src-tauri/Cargo.toml attachment_
```

Expected: all PASS.

- [ ] **Step 2: Run build**

Run:

```bash
npm run build
```

Expected: PASS. If this exposes unrelated pre-existing build errors, record the exact errors in the final handoff and confirm no new attachment files are implicated.

- [ ] **Step 3: Manual desktop smoke test**

Run the app:

```bash
npm run tauri dev
```

Manual checks:

- Open an agent group that contains a CLI member and has a workspace configured.
- Click the paperclip button and select one image plus one text/code file.
- Confirm the pending tray shows both attachments.
- Send a message with text and attachments.
- Confirm the sent bubble shows the attachment rows.
- Open the CLI task log for the responding CLI agent and confirm the prompt contains the original paths under `附件：`.
- Start a new message with attachments only and confirm the fallback text `请查看这些附件。` is sent.
- Reload the app and confirm sent attachment metadata is still visible.

- [ ] **Step 4: Final commit if verification fixes were needed**

If Step 1 or Step 2 required code fixes, commit those fixes:

```bash
git add src/config/chatSessions.ts src/config/chatSessions.test.mjs src/utils/chatAttachments.ts src/utils/chatAttachments.test.mjs src-tauri/src/api.rs src-tauri/src/lib.rs src/pages/chat/components/ChatAttachments.tsx src/pages/chat/components/AgentChatUI.tsx src/i18n/resources/en-US/chat.json src/i18n/resources/zh-CN/chat.json
git commit -m "fix: stabilize agent chat attachments"
```

If no fixes were needed, do not create an empty commit.

---

## Completion Notes

When implementation is complete, report:

- The commits created.
- The exact verification commands and pass/fail results.
- Whether `npm run build` had unrelated pre-existing failures.
- Any remaining manual limitation, especially that original-path attachments break if the user moves or deletes the source file.
