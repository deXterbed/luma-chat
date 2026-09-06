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

- **Rust backend** (`tauri/`): owns the SQLite DB (via `rusqlite`), window controls, and all network I/O (web search/fetch via `reqwest` + `scraper` + `readability`), exposed via Tauri commands.
- **Frontend** (`src/`): React UI, calling the backend through `@tauri-apps/api/core` → `invoke()`, wrapped in `src/lib/db.js` / `src/lib/tools.js`.
- **All Ollama API calls go through Rust Tauri commands** (`src/lib/ollama.js` proxies via `invoke()` to avoid CORS in production WebView2 builds) — don't reintroduce the `ollama` npm package.

### Rust backend structure

| File | Purpose |
|---|---|
| `tauri/src/main.rs` | App entry, window config, plugin + command registration |
| `tauri/src/db.rs` | SQLite schema, migrations, all CRUD operations |
| `tauri/src/commands.rs` | Tauri `#[tauri::command]` handlers wrapping DB + web tools |
| `tauri/src/tools/search.rs` | DuckDuckGo web search (HTTP → HTML parsing) |
| `tauri/src/tools/fetch.rs` | Web page fetch + Readability extraction. Body is streamed with a 2 MB cap (`MAX_HTML_BYTES`) — don't revert to `res.text()` (unbounded buffering). Fallback `strip_tags` uses `to_ascii_lowercase` (not `to_lowercase`) so byte offsets stay aligned for slicing. |
| `tauri/src/tools/ollama_search.rs` | Ollama cloud web search/fetch (key-gated); mirrors the DuckDuckGo output shape |
| `tauri/src/tools/html.rs` | HTML → Markdown text conversion |
| `tauri/src/tools/mod.rs` | Module re-exports |

New commands: add the function in `commands.rs` and register it in `main.rs`'s `tauri::generate_handler![]`.

### Frontend structure

| File | Purpose |
|---|---|
| `src/App.jsx` | Layout: TitleBar, Sidebar, main ChatPane, optional SidePanel, SettingsPage |
| `src/components/MessageBubble.jsx` | One chat bubble: edit mode, selection→"Ask in side chat" popup, thinking block, streaming cursor. Markdown delegated to `MarkdownBody` |
| `src/components/MarkdownBody.jsx` | `<ReactMarkdown>` instance + plugins (GFM, math via `remark-math`) + per-tag `components` overrides styled with theme tokens. `buildMarkdownComponents(theme)` is unit-tested in isolation |
| `src/components/InputArea.jsx` | Textarea, image attachments, send/stop — single source of truth for the input box |
| `src/components/Sidebar.jsx` | Recent chats list, "New Chat" button, Ollama status |
| `src/components/SidePanel.jsx` | Side-chat tabs + `+` button to add a new tab |
| `src/lib/ollama.js` | `streamChat()` coordinates the tool-calling loop. `toolCallLimit` setting (0 = unlimited) caps rounds; once hit, the final round runs tools-disabled but keeps gathered tool results so the model still answers from them |
| `src/lib/ollamaStream.js` | Pure collaborators extracted from `streamChat`: `applyStreamLine` (parses one streamed JSON line), `normalizeToolCalls`, `systemMessagesForRound` (force-final/wrap-up/web-search-nudge policy), `buildRequestBody`, `stripLeakedToolCallXml`, `runToolCalls` (executes a batch, detects quota/all-failed) |
| `src/lib/tools.js` | `TOOLS` (Ollama-format definitions) + `executeTool(name, args)` dispatcher |
| `src/lib/db.js` | Thin `invoke()` wrappers for every Tauri DB command |
| `src/hooks/useStreamingChat.js` | Wires `streamChat` callbacks to store actions; creates the session on first message |
| `src/hooks/useDbInit.js` | Triggers initial SQLite → store hydration on app start |

### State management (Zustand)

Independent stores, none persisted to `localStorage` (SQLite is the persistence layer). Selectors everywhere, so subscriptions only re-render for the slices they read.

| Store | File | Owns | Re-render triggers |
|---|---|---|---|
| `useMainChat` | `src/store/chatStore.js` | Per-pane messages, streaming state, tool call records, model, `chatNonce` | `messages`, `isStreaming`, `model`, `error` (not `abortController`) |
| `getSideChatStore(id)` | `src/store/chatStore.js` | Same factory as `useMainChat`, one store per side-chat tab, kept in a `Map` keyed by tab id (never recreated on tab switch) | Same as above |
| `useSessionStore` | `src/store/sessionStore.js` | Session list (incl. side-chat metadata), chat data write-through to SQLite | `chatSessions`, `activeChatId` |
| `useUiStore` | `src/store/uiStore.js` | Transient view state: side-chat open/closed, Ollama connectivity, settings page open, side-chat prefill text | All fields (small UI-only store) |
| `useSettingsStore` | `src/store/settingsStore.js` | Persisted settings (theme, default model, web search default, tool call limit, search provider, Ollama server URL + API key), write-through to SQLite | `hydrated` (one-shot), individual fields |

`chatStore.js` exports `createChatStore(id)`; both panes use the same factory. New chats start with an empty `model` — each store subscribes to `useSettingsStore` and lazily applies `defaultModel` once hydrated, so module-init doesn't depend on the DB being open.

Store actions write to SQLite (via `db`/`useSettingsStore`), not components.

### Streaming and tool-calling loop

`ollama_chat_stream` (`commands.rs`) checks `response.status().is_success()` before treating the body as an SSE stream — a non-2xx response (e.g. a 403 usage-limit hit) otherwise fell through the JSON-line parser and emitted an empty `ollama://done`. Non-success now emits `ollama://error` (401/403/429 get a usage-limit message).

The stream is cancellable mid-flight: `response.chunk()` races a `tokio::sync::Notify` (per `request_id`, in a `CancelRegistry` Tauri state) via `tokio::select!`. `ollama_cancel(request_id)` latches an `AtomicBool` and calls `notify_waiters()`, so Rust stops draining Ollama immediately instead of burning quota after Stop. A `CancelGuard` removes the registry entry on every exit path. On cancel, `ollama://done` fires with the partial content so far, and `streamChat`'s `abort` listener invokes `ollama_cancel`. A pre-cancel tombstone handles the race where Stop fires before `register()` runs; `requestId` is nulled after `done`/`error` resolve so a late Stop doesn't insert a tombstone for an already-finished request.

`streamChat()` sends the messages array, streams the response, and executes any `tool_calls` via `executeTool`, appending `role: "tool"` messages and re-calling the model. Hitting `toolCallLimit` triggers one final tools-disabled round that keeps prior tool results plus a system message telling the model to answer from what it found. A soft `maxToolRounds = 10` nudge and a fixed 15-round DuckDuckGo rate-limit nudge inject "wrap up" system messages. `Error: QUOTA:` from a web tool ends the stream immediately. Only a **non-empty** `tool_calls` array from a streamed chunk is kept — some models emit a trailing `tool_calls: []` that would otherwise wipe calls captured earlier in the round. A `normalizeToolCalls` JSON-parse failure sets `parseError` on the entry; `runToolCalls` short-circuits it to a descriptive error tool result instead of calling `executeTool` with empty args, so the model can retry.

`think: true` (per-pane thinking toggle) makes Ollama stream reasoning in a separate `message.thinking` field. `streamChat` accumulates it across all rounds (unlike `content`, not reset per round) via `onThinking`; `MessageBubble` renders it in a collapsible block. It's **transient** — not saved to SQLite, so it disappears on reload (persisting would need a `messages.thinking` migration).

### Tool execution

`src/lib/tools.js` exports `TOOLS` + `executeTool(name, args)`. Local tools (e.g. `get_current_time`) run in the renderer; web tools (`web_search`, `web_fetch`) invoke Tauri commands (CORS), implemented in `tauri/src/tools/`.

Web search has a global default in `useSettingsStore`; the per-pane toggle in `ChatPane` seeds from it as a session override. `useStreamingChat` filters web tools out of `TOOLS` when the toggle is off.

### Database schema

`tauri/src/db.rs` owns schema + queries (SQLite via `rusqlite`, synchronous). Tables: `sessions`, `messages`, `side_chats`, `side_chat_messages`, `custom_models`, `settings` (key/value; well-known keys in `SETTING_KEYS`, `src/store/settingsStore.js`). Message rows store `images`/`tool_calls` as JSON strings.

Migrations use SQLite's `PRAGMA user_version`: `MIGRATIONS` in `db.rs` is an ordered array of steps, and `run_migrations()` only runs steps above the DB's current version, then advances it — so each step runs at most once. New schema changes: append a step, wrapped in `.ok()`; never edit or reorder existing steps (their position is their version number).

`save_messages`/`save_side_chat_messages` delegate to `sync_messages()`: one transaction that upserts by id (`ON CONFLICT … WHERE <field differs>`, so unchanged rows aren't rewritten) and deletes ids no longer present (persists truncate-after-edit). Replaces an earlier non-atomic DELETE-all + reinsert. Frontend API unchanged — callers send the full desired message list.

**DB location.** `Database::new(dir)` opens `luma.db` in the given dir; the dir comes from Tauri's `app_data_dir()`, resolved in `.setup()` in `tauri/src/lib.rs` (needs the `AppHandle`, so can't run before `tauri::Builder`). `migrate_legacy_db()` copies over an old Electron-era `luma.db` when the new DB is absent/empty (never clobbers real data). Don't read `useSettingsStore` at module init — same reason: the store isn't available before the Tauri/app context is ready.

### Chat backup / restore

`export_chats(path)`/`import_chats(path)` (`commands.rs`) back up **chat data only** (sessions, messages, side chats) — no settings/custom models/API keys. File format is a custom `.lumabackup` container: 4-byte magic (`LMBK`) + 1-byte version + gzip-compressed compact JSON (via `flate2`, already pulled in transitively by `reqwest`). `encode_backup`/`decode_backup` are pure functions (no `State`) for unit testing without a Tauri context. `import_all` preserves the backup's original `created_at`/`updated_at` (unlike `save_session`, which stamps "now") and upserts by id — it's a restore/merge, not additive-only.

Frontend uses `@tauri-apps/plugin-dialog`'s `save()`/`open()` for the native picker, then passes the path to the Tauri commands which do the file I/O via `std::fs`.

### Window controls

`src/components/TitleBar.jsx` uses `@tauri-apps/api/window` → `getCurrentWindow()` for minimize/maximize/close. Tauri v2 runs `decorations: false` (frameless) — the app draws its own title bar.

### Theming

`src/theme.js` holds the `dark`/`light` palettes (`getTheme(name)`) and sets `data-theme` on `<html>`; `src/index.css` mirrors the same tokens as CSS custom properties. CSS Modules for scoped styles — no Tailwind.

`index.css`'s global `*{margin:0;padding:0}` reset strips list indentation, so `ul`/`ol`/`li` need explicit padding overrides in `MarkdownBody.jsx`.

**All markdown element styling lives in the `components` prop of `<ReactMarkdown>` in `MarkdownBody.jsx` (inline styles), not CSS** — the `.markdown-body …` block in `index.css` is dead (the component uses the hashed `styles.markdownBody` class instead). `table` uses `table-layout: fixed` + `width: 100%`; `th`/`td` use `word-break: normal` / `overflow-wrap: break-word` (not `word-break: break-word`, which splits letter-by-letter) so long cell content wraps within its column instead of overflowing into the next one. To style a new tag, add it to the `components` prop, not the dead CSS rules.

### Math rendering

Math uses `remark-math` + `MathSpan` (`src/components/MathSpan.jsx`) + `temml` (not KaTeX/MathJax). `remark-math` only recognizes `$...$`/`$$...$$`, not the `\( \)`/`\[ \]` delimiters most models emit (CommonMark strips the backslash before any renderer sees it). `src/lib/mathDelimiters.js`'s `normalizeMathDelimiters()` rewrites both bracket forms to `$$...$$` before the string reaches `remark`, skipping fenced code blocks.

`MarkdownBody.jsx` passes `{ singleDollarTextMath: false }` to `remarkMath` so ordinary currency text (`$40`, `$0.40`) isn't misread as inline math — `normalizeMathDelimiters()` must keep emitting `$$...$$` (never single `$`) to stay consistent with that.

`temml/dist/temml.mjs` has only a default export — import as `const { default: temml } = await import(...)`. `MathSpan` calls `temml.renderToString()` directly (its bundled `renderMathInElement` depends on a `window.temml` global it doesn't set itself, so avoid it).

`src/App.jsx` preloads the Temml chunk via `requestIdleCallback` (falls back to `setTimeout` for older WKWebView) after mount, so the first math message doesn't pay the ~200KB chunk cost.

### Code splitting / lazy loading

`SidePanel` and `SettingsPage` are `React.lazy()`-wrapped at module scope (so the resolved module is cached and later mounts skip the Suspense flash). Both only ever mount from an explicit user action, never during boot.

Don't lazy-load something that can appear in the *initial* render (e.g. hydrated/restored state) — `ToolActivity` was tried and reverted because historical tool-call bubbles from a restored session mount immediately at launch, causing a visible flash. Also don't lazy-load components needed on every hot-path render (`MarkdownBody`, `ReactMarkdown`, `remark-gfm`) or `App` itself from `main.jsx` — no caching win for a local Tauri bundle, just an extra async hop.

Theme persistence lives in SQLite via `useSettingsStore`. An inline `<script>` in `index.html`'s `<head>` sets `data-theme` synchronously before React mounts (from legacy `localStorage`, else `prefers-color-scheme`) to avoid a flash; `useSettingsStore.hydrate()` then re-applies the authoritative SQLite value.

## Common tasks

Concrete entry points for changes that come up often. Skim this list before grepping.

- **Focus the input box** — `textareaRef` in `InputArea.jsx`. The `focusNonce` effect skips the initial mount (so main chat doesn't steal focus on boot), which also swallows a `bumpFocus()` that fires before a new `InputArea` mounts. Side chat panes instead pass `autoFocus={isSideChat}`, since a side chat's `InputArea` only mounts when the tab is created.
- **Auto-scroll on new content** — `messages.length` watcher in `ChatPane.jsx`, using `prevMessagesCountRef` to distinguish new messages from in-place streaming updates. Needs `requestAnimationFrame` since the new message isn't mounted yet when the effect fires.
- **Per-pane toggle (web search, thinking)** — local `useState` in `ChatPane`, re-derived from its default on `chatNonce` change, with a `*TouchedRef` (cleared per `chatNonce`) preserving manual overrides within a chat. Web search gates on settings `hydrated`; thinking derives from the model.
- **Reset a chat's per-pane state** — bump `chatNonce` (`clearMessages`/`loadMessages` already do). Per-chat-default effects should watch `chatNonce`, not `model`.
- **Add a new Tauri command** — add to `commands.rs`, register in `main.rs`, mirror a wrapper in `src/lib/db.js`/`src/lib/tools.js`. For long-running streams, follow the `ollama_chat_stream` event pattern (`ollama://chunk`/`done`/`error`, keyed by `request_id`).
- **Add a new persisted setting** — add to `SETTING_KEYS` in `settingsStore.js`; write-through to SQLite is automatic. Schema changes: append a `MIGRATIONS` step in `db.rs` (never edit/reorder existing ones).
- **Ollama server URL + API key** — `ollamaUrl`/`ollamaApiKey` in `useSettingsStore`, passed to `ollama_reachable`/`ollama_list_models`/`ollama_chat_stream` as `ollama_url`/`api_key` (fallback via `resolve_ollama_base()`). `ollamaApiKey` is unified across the remote-server bearer token and the web search API.
- **Add a new tool the model can call** — schema in `TOOLS` (`src/lib/tools.js`) + a case in `executeTool`. Web tools must run as Tauri commands (CORS); local tools run in the renderer.
- **Add a native save/open file dialog** — `@tauri-apps/plugin-dialog`'s `save()`/`open()` for the path, then a plain Tauri command doing `std::fs` I/O (see `export_chats`/`import_chats`). Add permissions to `tauri/capabilities/default.json`.
- **Add a copy button to markdown code blocks** — the `code` override inside `buildMarkdownComponents` in `MarkdownBody.jsx` is the place. Because the override now uses React hooks (`useState` for copied feedback), `MarkdownBody` must memoize the `components` object with `useMemo(..., [theme])` so React doesn't treat it as a new component type on every render. Add `paddingRight` to the `<pre>` so the button doesn't overlap long single-line code.
- **Add a test** — Vitest + jsdom, Tauri APIs mocked in `src/test/setup.ts`, matching `src/**/*.test.{js,jsx,ts,tsx}`. Prefer `npm run test:run` over `npm test`.
- **Delete a side chat** — trash button in `ChatPane`'s header, two-step confirm like `Sidebar`'s `SessionRow`. Calls `removeSideChat(sessionId, sideChatId)`, which must also call `deleteSideChatStore(id)` to evict the tab's store from `_sideChatStores`. Children of a deleted side chat aren't cascade-deleted — they become top-level orphans. If the deleted tab was active, the next active tab is the parent (if it still exists) or the last remaining tab in array order — never `remaining[0]`.
- **Branch a side chat from another side chat** — a side chat's `parentSideChatId` (`sessionStore.addSideChat(sessionId, model, parentSideChatId)`) marks it branched from another side chat. Created via the `GitBranch` icon in `ChatPane`'s header, or "Ask in side chat" from a selection inside a side chat. The child's context resolves to `getSideChatStore(parentSideChatId)` instead of `useMainChat` (see `SidePanel.jsx`). `buildSideChatTree()` assigns path labels (`1`, `1.1`, ...) and display order in one depth-first pass; `buildTabRows()` renders stacked rows from root to the active tab so only the active branch's children show. `TabButton`'s tooltip reads the live per-tab store (`getSideChatStore(sc.id)`), not the `sessionStore` snapshot, which can lag mid-stream.

## Things to know before you change state stores

- **Don't read `useSettingsStore` at module init.** It returns in-memory defaults before SQLite hydration completes. Subscribe to `hydrated`, or read `useSettingsStore.getState()` inside an action.
- **Store actions, not components, write to SQLite.**
- **Tab switching in the side panel never calls `loadMessages`.** Each tab owns its store permanently via `_sideChatStores`; switching is pure UI state (`activeSideChatId`).
- **`activeChatId` is for navigation, not activity.** Bump `updated_at` only via `bumpSessionActivity(id)` on real user actions.

## Keeping docs in sync

- **Skim `README.md` whenever you touch stack, persistence, or architecture, and fix any drift.** No test catches README drift, so this is a deliberate check. Prone sections: Stack, Persistence/Migrations, Architecture/State stores, project layout tree.
- **`ROADMAP.md` drifts the same way** — after the Electron→Tauri migration it still described the app as Electron throughout (phases, architecture decisions, status table, open-question paths like `electron/tools/search.js`). When you change the stack or move files, grep `ROADMAP.md` for stale references too. Its Status table's per-phase notes (e.g. `maxToolRounds` value, "In progress" markers) also go stale — verify against the code.

## Releasing

- **Version lives in three files, bumped together**: `package.json`, `tauri/tauri.conf.json`, `tauri/Cargo.toml`. `tauri/Cargo.lock`'s `luma` entry gets rewritten by any `cargo` invocation that touches the workspace — verify with `git diff tauri/Cargo.lock` rather than assuming it's stale.
- **After bumping `package.json`, run `npm install` (not a hand-edit)** so `package-lock.json`'s two `version` fields update too.
- **This machine's `~/.npmrc` sets `legacy-peer-deps=true` globally**, which hides lockfile issues that CI's strict `npm ci` will fail on (`EUSAGE`/"Missing: X from lock file"). Reproduce CI before tagging with `rm -rf node_modules && npm ci --no-legacy-peer-deps`; regenerate the lockfile with `npm install --no-legacy-peer-deps` if it fails.
- **Releases are CI-driven**: `.github/workflows/release.yml` builds and publishes a draft release on any `v*` tag push. A `check-main` job gates `release` on the tagged commit being reachable from `origin/main` (`git merge-base --is-ancestor`), so cut tags from `main` (merge `develop` in first).
- `CHANGELOG.md` is hand-maintained — update it in the same commit as the version bump, sourced from `git log <prev-tag>..HEAD --oneline`.

## Tauri / WebView pitfalls

- **Don't use `display: none` to hide simultaneously-mounted panes.** In WKWebView, a textarea transitioning `display: none` → `flex` renders but won't accept click-to-focus. Use `visibility: hidden; pointer-events: none` with absolute-position stacking instead (see `SidePanel.module.css`'s `.tabPane`/`.tabPaneActive`).
- **CSS module changes may not hot-reload in the Tauri dev window.** A full restart sometimes picks up what HMR reports as applied but isn't.
- **Unsigned macOS builds are Gatekeeper-blocked on download.** Users must run `xattr -cr /path/to/Luma.app` before opening (worse on arm64). Proper fix needs an Apple Developer account + signing config.

## Editor tooling

- **Ignore Prettier-only churn in diffs.** The editor's file-write tool reformats the whole file on save; don't revert those hunks, just focus on the semantic change.
- **Verify UI/CSS tweaks with a throwaway HTML repro, not the repo.** Build a minimal standalone HTML mirroring the global reset + bubble + `markdownBody`, screenshot via Playwright MCP, and write both to `/tmp` — not the repo root, since the screenshot tool defaults there and the commit hook auto-stages untracked files. Check `git show --stat HEAD` after committing to catch stray screenshots.
