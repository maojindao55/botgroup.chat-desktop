# AGENTS.md

## Cursor Cloud specific instructions

### Project Overview

BotGroup.Chat Desktop — a Tauri v2 desktop app (React frontend + Rust backend) for AI group chat. SQLite is bundled via `rusqlite`, so no external database setup is needed.

### Running the App

- **Full app (Tauri + Vite):** `npm run tauri dev` — starts both Vite on port 1420 and the Rust backend
- **Frontend only:** `npm run dev` — starts Vite dev server on port 1420
- **Build:** `npm run build` (frontend) or `npm run tauri build` (full desktop binary)

### Type Checking & Tests

- **TypeScript:** `npx tsc --noEmit`
- **Test:** `node src/config/aiGame.test.mjs` (only test file; no formal framework configured)
- No ESLint or Prettier configured in this repo.

### Key Gotchas

- Rust toolchain must be **>= 1.85** (some dependencies require `edition2024` support). The update script runs `rustup update stable && rustup default stable` to ensure this.
- Tauri Linux system dependencies (`libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libsoup-3.0-dev`, `libjavascriptcoregtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev`, `patchelf`) are installed via the update script.
- The `libEGL warning: DRI3 error` messages at startup are harmless in the cloud VM—graphics acceleration is not available but the app still renders.
- AI model responses require API keys configured in the app UI (stored in localStorage). Without keys, messages send successfully but AI replies show "服务出错(请求失败)".
- The app starts in local mode ("本地用户") with no login required.
- `$DISPLAY` is set to `:1` in the cloud environment, so the Tauri window renders on a virtual display.
