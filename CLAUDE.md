# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # Start Vite dev server + Tauri dev window (hot reload)
npm run build      # Vite production build → Tauri bundler
npm run dev:vite   # Vite dev server only (for browser-based dev)
npm run build:vite # Vite production build only
npm test           # Vitest in watch mode (jsdom, Tauri APIs mocked)
npm run test:run   # Vitest single run (use this in CI / pre-commit)
npm run test:rust  # Cargo tests for the Tauri backend
npm run test:all   # Both test suites sequentially
```

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
| `tauri/src/tools/ollama_search.rs` | Ollama cloud web search/fetch (key-gated); mirrors the DuckDuckGo output shape |
| `tauri/src/tools/html.rs` | HTML → Markdown text conversion |
| `tauri/src/tools/mod.rs` | Module re-exports |

Commands are registered in `main.rs` via `tauri::generate_handler![]`. When adding a new command, add the function to `commands.rs` and register it in `main.rs`.

### Frontend structure

| File | Purpose |
|---|---|
| `src/App.jsx` | Layout: TitleBar, Sidebar, main ChatPane, optional SidePanel, SettingsPage |
| `src/components/ChatPane.jsx` | One chat surface (used for both main and side panes — identical logic, different `store`/`compact` props) |
| `src/components/InputArea.jsx` | Textarea, image attachments, send/stop. Single source of truth for the input box. |
| `src/components/Sidebar.jsx` | Recent chats list, "New Chat" button, Ollama status |
| `src/components/SidePanel.jsx` | Side-chat tabs + `+` button to add a new tab |
| `src/lib/ollama.js` | `streamChat()` runs the full tool-calling loop (model ↔ tool calls). `toolCallLimit` setting (0 = unlimited) caps rounds; when hit, the final round runs with tools disabled but the gathered tool results kept, so the model answers from what it found |
| `src/lib/tools.js` | `TOOLS` (Ollama-format definitions) + `executeTool(name, args)` dispatcher |
| `src/lib/db.js` | Thin `invoke()` wrappers for every Tauri DB command |
| `src/hooks/useStreamingChat.js` | Wires `streamChat` callbacks to store actions; creates the session on first message |
| `src/hooks/useDbInit.js` | Triggers initial SQLite → store hydration on app start |

### State management (Zustand)

Independent stores; none are persisted to `localStorage` — persistence goes to SQLite. Selectors are used everywhere, so each subscription only re-renders for the slices it reads.

| Store | File | Owns | Re-render triggers (only the selected slice matters) |
|---|---|---|---|
| `useMainChat` | `src/store/chatStore.js` | Per-pane messages, streaming state, tool call records, model, `chatNonce` | `messages`, `isStreaming`, `model`, `error`. `abortController` does **not** re-render. |
| `getSideChatStore(id)` | `src/store/chatStore.js` | Same factory as `useMainChat`; one store per side-chat tab. Stored in a `Map` keyed by tab id — never recreated on tab switch. | Same as above. |
| `useSessionStore` | `src/store/sessionStore.js` | Session list (incl. side-chat metadata), chat data write-through to SQLite | `chatSessions`, `activeChatId` |
| `useUiStore` | `src/store/uiStore.js` | Transient view state: side-chat open/closed, Ollama connectivity, settings page open, side-chat prefill text | All fields; this is a small UI-only store |
| `useSettingsStore` | `src/store/settingsStore.js` | Persisted settings (theme, default model, web search default, tool call limit, search provider, Ollama API key) write-through to SQLite | `hydrated` (one-shot), individual settings fields |

`chatStore.js` exports a factory `createChatStore(id)` — both panes use identical logic from the same factory. `useMainChat` is a singleton; side chats get one store per tab via `getSideChatStore(id)`. New chats start with an empty `model`; each store subscribes to `useSettingsStore` and lazily applies `defaultModel` once settings have hydrated, so module-init doesn't depend on the DB being open.

`useSessionStore` writes chat data to SQLite (via `db` from `src/lib/db.js`); `useSettingsStore` writes the `settings` key/value table. All DB mutations happen inside store actions, not in components.

### Streaming and tool-calling loop

`src/lib/ollama.js` → `streamChat()` runs the full tool-calling loop. It sends the messages array to Ollama, streams the response, and if the model returns `tool_calls`, it executes them via `executeTool` (from `src/lib/tools.js`), appends `role: "tool"` messages, and re-calls the model. The `toolCallLimit` param (from `useSettingsStore`, 0 = unlimited) caps the rounds; once hit, the loop makes one final call with tools disabled while **keeping** the gathered tool results in `workingMessages`, plus a system message telling the model to answer from what it retrieved (don't reset to training data) — it never throws a "called tools N times" error. A soft `maxToolRounds = 10` nudge and a fixed 15-round DuckDuckGo rate-limit nudge inject "wrap up" system messages along the way. A web tool returning `Error: QUOTA:` (bad/exhausted Ollama key) ends the stream immediately. The final text response triggers `onDone`.

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

## Common tasks

Concrete entry points for changes that come up often. Skim this list before grepping.

- **Focus the input box** — `textareaRef` in `InputArea.jsx`. Existing trigger: the `prefill` effect focuses + sets cursor. For a generic "focus on new chat" use case, add a new `autoFocus` prop (or bump a `chatNonce`-derived value passed in as a key on `InputArea`).
- **Auto-scroll on new content** — `messages.length` watcher in `ChatPane.jsx`. Uses a `prevMessagesCountRef` to distinguish new messages from in-place streaming token updates. `requestAnimationFrame` is required because the new message isn't mounted when the effect fires.
- **Per-pane toggle (web search, thinking)** — local `useState` in `ChatPane`, seeded once from `useSettingsStore` after hydration, with a `*TouchedRef` so the user's manual override survives re-derivation. Don't re-derive on every render.
- **Reset a chat's per-pane state** — bump `chatNonce` (e.g. `clearMessages` and `loadMessages` already do this). Effects that derive per-chat defaults should watch `chatNonce`, not `model`.
- **Add a new Tauri command** — add the function in `tauri/src/commands.rs`, register it in `tauri::generate_handler![]` in `main.rs`, and mirror a wrapper in `src/lib/db.js` or `src/lib/tools.js`. For a long-running stream, use the `ollama_chat_stream` pattern (Rust emits `ollama://chunk` / `ollama://done` / `ollama://error` events; frontend subscribes with `listen()` keyed by a `request_id`).
- **Add a new persisted setting** — add the key to `SETTING_KEYS` in `src/store/settingsStore.js`, read it via the store (never `localStorage`), and the write-through to SQLite is automatic. For schema-level changes, add an `ALTER TABLE … ADD COLUMN` migration in `db.rs` and wrap it in `.ok()`.
- **Add a new tool the model can call** — define the Ollama schema in `TOOLS` in `src/lib/tools.js` and a case in `executeTool`. Web tools must run as Tauri commands (CORS). Local tools run in the renderer.
- **Add a test** — Vitest with jsdom, Tauri APIs mocked in `src/test/setup.ts`. Files match `src/**/*.test.{js,jsx,ts,tsx}`. Prefer `npm run test:run` over `npm test` to avoid the watch loop.

## Things to know before you change state stores

- **Don't read `useSettingsStore` at module init.** It returns in-memory defaults before SQLite hydration completes. Subscribe to `hydrated` and apply values in an effect, or read `useSettingsStore.getState()` inside an action (e.g. `clearMessages` does this for `defaultModel`).
- **Store actions, not components, write to SQLite.** The pattern is: store action mutates state → calls `db.saveX()` → store is the single source of truth.
- **Tab switching in the side panel never calls `loadMessages`.** Each tab owns its store permanently (via the `_sideChatStores` Map in `chatStore.js`). Switching tabs is a pure UI concern handled by `activeSideChatId`.
- **`activeChatId` is for navigation, not activity.** Bump `updated_at` only on real user actions via `bumpSessionActivity(id)`.
