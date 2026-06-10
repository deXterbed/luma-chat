# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # Start Vite dev server + Tauri dev window (hot reload)
npm run build      # Vite production build → Tauri bundler
npm run dev:vite   # Vite dev server only (for browser-based dev)
npm run build:vite # Vite production build only
```

There are no tests or linters configured.

### Prerequisites

- **Rust**: Install via [rustup](https://rustup.rs/) (`rustup stable`)
- **Tauri CLI**: `npm install` pulls `@tauri-apps/cli`
- **Icons**: Generate with `cargo tauri icon path/to/source.png` (1024x1024 recommended)

## Architecture

**Luma** is a dual-pane Ollama chat desktop app (Tauri + React/Vite + SQLite).

### Process boundary

- **Rust backend** (`tauri/`): owns the SQLite DB (via `rusqlite`), window controls, and all network I/O (web search/fetch via `reqwest` + `scraper` + `readability`). Exposed to the frontend through Tauri commands.
- **Frontend** (`src/`): React UI. Reaches the Rust backend through `@tauri-apps/api/core` → `invoke()` calls, wrapped in thin client modules (`src/lib/db.js`, `src/lib/tools.js`).

### Rust backend structure

| File | Purpose |
|---|---|
| `tauri/src/main.rs` | App entry, window config, plugin + command registration |
| `tauri/src/db.rs` | SQLite schema, migrations, all CRUD operations |
| `tauri/src/commands.rs` | Tauri `#[tauri::command]` handlers wrapping DB + web tools |
| `tauri/src/tools/search.rs` | DuckDuckGo web search (HTTP → HTML parsing) |
| `tauri/src/tools/fetch.rs` | Web page fetch + Readability extraction |
| `tauri/src/tools/html.rs` | HTML → Markdown text conversion |
| `tauri/src/tools/mod.rs` | Module re-exports |

Commands are registered in `main.rs` via `tauri::generate_handler![]`. When adding a new command, add the function to `commands.rs` and register it in `main.rs`.

### State management (Zustand)

Four independent stores; none are persisted to `localStorage` (persistence goes to SQLite):

| Store | File | Owns |
|---|---|---|
| `useMainChat` / `useSideChat` | `src/store/chatStore.js` | Per-pane messages, streaming state, tool call records |
| `useSessionStore` | `src/store/sessionStore.js` | Session list, side-chat metadata, chat data write-through |
| `useUiStore` | `src/store/uiStore.js` | Transient view state: side-chat open/closed, Ollama connectivity, settings page open |
| `useSettingsStore` | `src/store/settingsStore.js` | Persisted settings (theme, default model, web search default) write-through to SQLite |

`chatStore.js` exports a factory `createChatStore(id)` — both panes use identical logic from the same factory. The two singletons are `useMainChat` and `useSideChat`. New chats start with an empty `model`; each store subscribes to `useSettingsStore` and lazily applies `defaultModel` once settings have hydrated, so module-init doesn't depend on the DB being open.

`useSessionStore` writes chat data to SQLite (via `db` from `src/lib/db.js`); `useSettingsStore` writes the `settings` key/value table. All DB mutations happen inside store actions, not in components.

### Streaming and tool-calling loop

`src/lib/ollama.js` → `streamChat()` runs the full tool-calling loop. It sends the messages array to Ollama, streams the response, and if the model returns `tool_calls`, it executes them via `executeTool` (from `src/lib/tools.js`), appends `role: "tool"` messages, and re-calls the model — up to `maxToolRounds = 5` times. The final text response triggers `onDone`.

`useStreamingChat` hook (`src/hooks/useStreamingChat.js`) wires the store actions (`addToolCall`, `completeToolCall`, `finalizeMessage`) to the `streamChat` callbacks and handles session creation on first message.

### Tool execution

`src/lib/tools.js` exports `TOOLS` (Ollama-format definitions) and `executeTool(name, args)`. Local tools (e.g. `get_current_time`) run in the renderer. Web tools (`web_search`, `web_fetch`) invoke Tauri commands via `@tauri-apps/api/core` to avoid CORS; the implementations live in `tauri/src/tools/`.

Web search has a global default in `useSettingsStore`; the per-pane web toggle in `ChatPane` seeds from it (and remains a session override). `useStreamingChat` filters `TOOLS` to exclude web tools when the toggle is off before passing them to `streamChat`.

### Database schema

`tauri/src/db.rs` owns the schema and all queries (SQLite via `rusqlite`, synchronous API). Tables: `sessions`, `messages`, `side_chats`, `side_chat_messages`, `custom_models`, `settings`. Message rows store `images` and `tool_calls` as JSON strings. The `settings` table is a key/value store (`key TEXT PRIMARY KEY, value TEXT`); well-known keys are defined in `src/store/settingsStore.js` (`SETTING_KEYS`). On init, `ALTER TABLE … ADD COLUMN` migrations run inside `.ok()` to handle existing DBs gracefully.

### Window controls

`src/components/TitleBar.jsx` uses `@tauri-apps/api/window` → `getCurrentWindow()` for minimize/maximize/close. Tauri v2 is configured with `decorations: false` (frameless window) — the app draws its own title bar.

### Theming

`src/theme.js` has the full color palette for `dark` and `light` as a JS object (`getTheme(name)`) and sets a `data-theme` attribute on `<html>`. `src/index.css` mirrors the same tokens as CSS custom properties (`var(--bg)`, etc.) for use in stylesheets. Components use whichever is convenient — the values are kept in sync manually.

Theme persistence lives in the `settings` SQLite table via `useSettingsStore` (no `localStorage`). To prevent a flash of the wrong theme on launch, an inline `<script>` at the top of `<head>` in `index.html` reads a legacy `localStorage['luma:theme']` value (if any), falls back to `prefers-color-scheme`, and sets `data-theme` on `<html>` synchronously before React mounts. `useSettingsStore.hydrate()` then re-applies the authoritative SQLite value (and migrates a legacy `localStorage` entry into SQLite on first run).
