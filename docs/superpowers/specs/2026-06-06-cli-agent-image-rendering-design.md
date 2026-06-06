# CLI Agent Image Rendering Design

## Goal

Render local image paths mentioned in CLI agent final replies as images inside chat bubbles, while keeping CLI execution logs and code examples as text.

## Current Flow

CLI output is stored as `message.content` and rendered by `ChatMarkdown`. `ChatMarkdown` already normalizes chat markdown and calls `transformLocalImagePaths` with Tauri `convertFileSrc`, so the safest place to improve behavior is the markdown preprocessing layer.

## Rendering Rules

Render local image paths only in the final reply body:

- `/Users/a/out.png`
- `'/Users/a/out.png'`
- `"/Users/a/out.png"`
- `` `/Users/a/out.png` ``
- `file:///Users/a/out.png`

Do not render paths in:

- complete CLI command details blocks: `<details data-cli-command-group="...">...</details>`
- fenced code blocks
- inline code that is not exactly an image path, such as `` `open /Users/a/out.png` ``

## Implementation

Update `src/utils/markdownContent.ts`:

- Mask complete CLI command details blocks before local image path scanning.
- Split fenced code block handling from inline code handling.
- Convert inline code only when the trimmed content is a standalone local image path.
- Convert quoted standalone image paths by replacing the whole quoted token with a markdown image, so quotes do not remain around the rendered image.

Add tests in `src/utils/markdownContent.test.mjs` for quoted paths, pure inline-code paths, command inline-code paths, and CLI details masking.

## Success Criteria

- CLI final replies containing local image paths render as images in `ChatMarkdown`.
- CLI execution details remain text even if they contain image paths.
- Existing markdown image, HTML image, URL, and code block behavior remains intact.
