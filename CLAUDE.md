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
- **All Ollama API calls go through Rust Tauri commands** — the `ollama` npm package is unused and should not be added back. The frontend's `src/lib/ollama.js` proxies everything through `invoke()` to avoid CORS issues in production WebView2 builds.

### Rust backend structure

| File | Purpose |
|---|---|
| `tauri/src/main.rs` | App entry, window config, plugin + command registration |
| `tauri/src/db.rs` | SQLite schema, migrations, all CRUD operations |
| `tauri/src/commands.rs` | Tauri `#[tauri::command]` handlers wrapping DB + web tools |
| `tauri/src/tools/search.rs` | DuckDuckGo web search (HTTP → HTML parsing) |
| `tauri/src/tools/fetch.rs` | Web page fetch + Readability extraction. Body is streamed with a 2 MB cap (`MAX_HTML_BYTES`) — never revert to `res.text()`, which buffered unbounded. The fallback `strip_tags` is intentionally linear (one `to_ascii_lowercase` + byte-offset walk); use `to_ascii_lowercase` (not `to_lowercase`) so byte offsets stay aligned with the original for slicing.
| `tauri/src/tools/ollama_search.rs` | Ollama cloud web search/fetch (key-gated); mirrors the DuckDuckGo output shape |
| `tauri/src/tools/html.rs` | HTML → Markdown text conversion |
| `tauri/src/tools/mod.rs` | Module re-exports |

Commands are registered in `main.rs` via `tauri::generate_handler![]`. When adding a new command, add the function to `commands.rs` and register it in `main.rs`.

### Frontend structure

| File | Purpose |
|---|---|
| `src/App.jsx` | Layout: TitleBar, Sidebar, main ChatPane, optional SidePanel, SettingsPage |
| `src/components/MessageBubble.jsx` | One chat bubble: edit mode, selection→"Ask in side chat" popup, thinking block, streaming cursor. Markdown rendering is delegated to `MarkdownBody` |
| `src/components/MarkdownBody.jsx` | Owns the `<ReactMarkdown>` instance + plugins (GFM, math via `remark-math`) + the per-tag `components` overrides that style each markdown element with theme tokens. Exported `buildMarkdownComponents(theme)` is unit-tested in isolation. Extracted from `MessageBubble` so markdown element styling is a localized, open-for-extension concern |
| `src/components/InputArea.jsx` | Textarea, image attachments, send/stop. Single source of truth for the input box. |
| `src/components/Sidebar.jsx` | Recent chats list, "New Chat" button, Ollama status |
| `src/components/SidePanel.jsx` | Side-chat tabs + `+` button to add a new tab |
| `src/lib/ollama.js` | `streamChat()` is the thin coordinator for the tool-calling loop (model ↔ tool calls). `toolCallLimit` setting (0 = unlimited) caps rounds; when hit, the final round runs with tools disabled but the gathered tool results kept, so the model answers from what it found |
| `src/lib/ollamaStream.js` | Pure, independently-tested collaborators extracted from `streamChat`: `applyStreamLine` (parses one streamed JSON line → content/thinking/toolCalls deltas), `normalizeToolCalls`, `systemMessagesForRound` (force-final / wrap-up / web-search-nudge policy), `buildRequestBody`, `stripLeakedToolCallXml`, `runToolCalls` (executes a batch, detects quota/all-failed). `streamChat` wires these together with the Tauri event listeners and the round loop |
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
| `useSettingsStore` | `src/store/settingsStore.js` | Persisted settings (theme, default model, web search default, tool call limit, search provider, Ollama server URL + API key) write-through to SQLite | `hydrated` (one-shot), individual settings fields |

`chatStore.js` exports a factory `createChatStore(id)` — both panes use identical logic from the same factory. `useMainChat` is a singleton; side chats get one store per tab via `getSideChatStore(id)`. New chats start with an empty `model`; each store subscribes to `useSettingsStore` and lazily applies `defaultModel` once settings have hydrated, so module-init doesn't depend on the DB being open.

`useSessionStore` writes chat data to SQLite (via `db` from `src/lib/db.js`); `useSettingsStore` writes the `settings` key/value table. All DB mutations happen inside store actions, not in components.

### Streaming and tool-calling loop

`ollama_chat_stream` in `commands.rs` checks `response.status().is_success()` right after the HTTP send, before treating the body as an SSE stream. Without this check, a non-2xx response (e.g. a 403 from hitting an Ollama usage limit) fell through into the JSON-line parser, found no `message.content` to accumulate, and emitted `ollama://done` with empty content — the chat silently ended with nothing. Non-success now emits `ollama://error` (401/403/429 get a usage-limit-specific message) and returns `Err`, which `src/lib/ollama.js`'s existing `ollama://error` listener already surfaces into the store's error state.

`ollama_chat_stream` is cancellable mid-stream. The chunk loop wraps `response.chunk()` in a `tokio::select!` raced against a `tokio::sync::Notify` looked up by `request_id` in a `CancelRegistry` (managed Tauri state). The `ollama_cancel(request_id)` command latches a per-request `AtomicBool` and calls `notify_waiters()`, so the Rust task breaks out of the await immediately instead of draining Ollama until the round finishes — the old behavior burned GPU/cloud quota after Stop and held `streamChat` stuck on `completionPromise`. The pre-loop `is_cancelled()` check also catches a cancel that lands between awaits (the microsecond gap where `notify_waiters()` alone would be lost). A `CancelGuard` removes the registry entry on every exit path (done/error/cancel) so no stale slot lingers. On cancel, the command emits `ollama://done` with the partial `full` content accumulated so far; `streamChat`'s `ollama://done` listener resolves `completionPromise`, then the loop's `signal?.aborted` check throws and `useStreamingChat` finalizes the bubble with the partial. `streamChat` registers an `abort` listener on the JS `AbortSignal` that fires `invoke("ollama_cancel", { requestId })` — so `stopStreaming` (which aborts the store's `AbortController`) now actually stops generation on the Rust side, not just the UI. `cancel()` also covers the register race: if Stop fires after JS sets `state.requestId` but before `ollama_chat_stream` calls `register()`, the cancel inserts a pre-cancelled tombstone, which `register()` then returns instead of a fresh slot — so the stream's first `is_cancelled()` check breaks immediately and the round never drains Ollama. The `ollama://done` and `ollama://error` listeners null `state.requestId` after resolving `completionPromise`, so a Stop that lands right as a round completes (Rust emitted done, `CancelGuard` removed the slot, but `onAbort` still sees the id) skips the `ollama_cancel` invoke via its `if (id)` guard instead of inserting a tombstone for a dead id that nothing ever removes.

`src/lib/ollama.js` → `streamChat()` runs the full tool-calling loop. It sends the messages array to Ollama, streams the response, and if the model returns `tool_calls`, it executes them via `executeTool` (from `src/lib/tools.js`), appends `role: "tool"` messages, and re-calls the model. The `toolCallLimit` param (from `useSettingsStore`, 0 = unlimited) caps the rounds; once hit, the loop makes one final call with tools disabled while **keeping** the gathered tool results in `workingMessages`, plus a system message telling the model to answer from what it retrieved (don't reset to training data) — it never throws a "called tools N times" error. A soft `maxToolRounds = 10` nudge and a fixed 15-round DuckDuckGo rate-limit nudge inject "wrap up" system messages along the way. A web tool returning `Error: QUOTA:` (bad/exhausted Ollama key) ends the stream immediately. The final text response triggers `onDone`. When capturing `tool_calls` from streamed chunks, only a **non-empty** array is kept: some models/Ollama emit a trailing `tool_calls: []` chunk that would otherwise wipe the calls captured earlier in the round, ending it with zero tool calls so the loop finalizes early (the Stop button flips to Send) and the tool never runs.

`useStreamingChat` hook (`src/hooks/useStreamingChat.js`) wires the store actions (`addToolCall`, `completeToolCall`, `finalizeMessage`) to the `streamChat` callbacks and handles session creation on first message.

When `think: true` is sent (the per-pane thinking toggle), Ollama streams the model's reasoning in a **separate** `message.thinking` field, distinct from the final-answer `message.content`. `streamChat` accumulates it across all rounds (it is *not* reset per round, unlike `content`) and fires `onThinking(chunk, full)`; the hook flushes it (rAF-throttled like tokens) into `message.thinking` via `updateThinking`, and `MessageBubble` renders it in a collapsible "Thinking…/Thoughts" block above the answer. The reasoning is **transient** — not saved to SQLite, so it disappears on reload. Persisting it would need a `messages.thinking` column migration in `db.rs` plus save/load plumbing. The Rust `ollama_chat_stream` needs no change: it forwards the full JSON line, so `thinking` already reaches the renderer; its accumulated `full` buffer (for `onDone`) intentionally only collects `content`.

### Tool execution

`src/lib/tools.js` exports `TOOLS` (Ollama-format definitions) and `executeTool(name, args)`. Local tools (e.g. `get_current_time`) run in the renderer. Web tools (`web_search`, `web_fetch`) invoke Tauri commands via `@tauri-apps/api/core` to avoid CORS; the implementations live in `tauri/src/tools/`.

Web search has a global default in `useSettingsStore`; the per-pane web toggle in `ChatPane` seeds from it (and remains a session override). `useStreamingChat` filters `TOOLS` to exclude web tools when the toggle is off before passing them to `streamChat`.

### Database schema

`tauri/src/db.rs` owns the schema and all queries (SQLite via `rusqlite`, synchronous API). Tables: `sessions`, `messages`, `side_chats`, `side_chat_messages`, `custom_models`, `settings`. Message rows store `images` and `tool_calls` as JSON strings. The `settings` table is a key/value store (`key TEXT PRIMARY KEY, value TEXT`); well-known keys are defined in `src/store/settingsStore.js` (`SETTING_KEYS`). Schema migrations are tracked via SQLite's `PRAGMA user_version`: `MIGRATIONS` is an ordered array of `fn(&Connection)` steps in `db.rs`, and `run_migrations()` (called once from `Database::new()`) only runs the steps above the DB's current version, then advances it — so each `ALTER TABLE`/`UPDATE` is attempted at most once per DB, not re-attempted (and silently swallowed via `.ok()`) on every launch. Each step still wraps its SQL in `.ok()` as a one-time safety net for DBs upgraded from before this tracking existed (where the column may already exist from the old approach but `user_version` starts at 0).

`save_messages` / `save_side_chat_messages` both delegate to `sync_messages()`: one transaction that (a) upserts each message by id with an `ON CONFLICT … DO UPDATE … WHERE <field differs>` clause — the WHERE suppresses no-op updates, so unchanged rows (e.g. old messages with base64 images) are never rewritten — and (b) deletes rows whose ids are no longer in the list, which is what persists truncate-after-edit. Inline edits persist via the upsert because message ids are stable UUIDs. This replaced a DELETE-all + reinsert that was non-atomic (a crash mid-save could lose the whole conversation) and rewrote every row on every save. The frontend API is unchanged: callers still send the full desired message list.

**DB location.** `Database::new(dir: PathBuf)` takes the data dir and opens `luma.db` inside it; it no longer resolves the path itself. The dir comes from Tauri's `app_data_dir()` (via `app.path().app_data_dir()`), resolved in the `.setup()` hook in `tauri/src/lib.rs` — **not** eagerly before `tauri::Builder` runs, because the path needs the `AppHandle`. This fixed Windows, where the old `dirs_next()` env-var probe (`HOME` is usually unset there) fell through to a relative `luma_data` dir. `app_data_dir()` resolves to the `identifier` (`com.luma.chat`) subdir, which differs from the legacy Electron location (`Luma` on macOS, `luma` on Linux), so `migrate_legacy_db()` (called in setup before `Database::new`) copies the old `luma.db` over the new one when the new one is absent or has zero sessions (never clobbering a new DB that holds real data; conservative skip if the new DB can't be opened to count). `dirs_next()` is retained in `db.rs` only as the legacy-path probe for that migration (and the smoke tests that read the real on-disk DB). Do **not** read `useSettingsStore` at module init — same lesson applies: the path/store isn't available before the Tauri/app context is ready.

### Window controls

`src/components/TitleBar.jsx` uses `@tauri-apps/api/window` → `getCurrentWindow()` for minimize/maximize/close. Tauri v2 is configured with `decorations: false` (frameless window) — the app draws its own title bar.

### Theming

`src/theme.js` has the full color palette for `dark` and `light` as a JS object (`getTheme(name)`) and sets a `data-theme` attribute on `<html>`. `src/index.css` mirrors the same tokens as CSS custom properties (`var(--bg)`, etc.) for use in stylesheets. Components use CSS Modules (`*.module.css`) for scoped styles — no Tailwind CSS.

`src/index.css` has a global `*{margin:0;padding:0}` reset. This strips list indentation, so `ReactMarkdown` content in `MarkdownBody.jsx` must restore padding **per tag** via its `components` overrides — `ul`, `ol`, and `li` each need their own style. A missing `ol` override is what let ordered-list numbers render in the (zero-width) padding area and overflow left, outside the chat bubble. When adding a new markdown element, give it explicit spacing.

**All markdown element styling lives in the `components` prop of `<ReactMarkdown>` in `MarkdownBody.jsx` (inline styles), not in CSS.** The `.markdown-body …` block in `index.css` (headings, `strong`, `a`, `blockquote`, `table`) is **dead**: the component applies the CSS-module class `styles.markdownBody` (a hashed name), so the literal global `.markdown-body` selector never matches. Elements without a `components` override (previously the headings, and `table`/`th`/`td`) fall back to browser defaults — which is why h1/h2/h3 were oversized until `h1`/`h2`/`h3` overrides were added, and why tables rendered squished (auto column sizing shrank a column to near-zero, and the bubble's inherited `word-break: break-word` then split words letter-by-letter to fit). The fix: `table` uses `table-layout: fixed` + `width: 100%` so columns split evenly within the bubble, and `th`/`td` override back to `word-break: normal` / `overflow-wrap: normal`. `theme.js` already had `mdThBg`/`mdThText`/`mdTdBorder` tokens defined for this — they were dead until the `table`/`th`/`td` overrides were added. To style a markdown tag, add/edit its entry in the `components` prop in `MarkdownBody.jsx`; don't edit the dead `.markdown-body` rules.

### Math rendering

Math uses `remark-math` + `MathSpan` (`src/components/MathSpan.jsx`) + `temml` — not KaTeX/MathJax. `remark-math` only recognizes `$...$`/`$$...$$`; it does **not** support the `\( \)`/`\[ \]` delimiters most models actually emit, because CommonMark's own backslash-escape handling strips the backslash from `\(`/`\[` before any renderer ever sees it (verified in a real browser — a DOM-post-render delimiter scan, like MathJax's `typesetPromise` or a hand-rolled regex, cannot recover from this since the character is already gone by the time markdown finishes parsing). `src/lib/mathDelimiters.js`'s `normalizeMathDelimiters()` rewrites `\( \)`/`\[ \]` to `$$...$$` (both forms — not single `$`) *before* the string reaches `remark`, skipping fenced code blocks so literal backslash-parens in code (regex, shell) aren't touched. `remark-math` turns math into `language-math`/`math-inline`/`math-display` code nodes, which `MarkdownBody`'s `code` component override routes to `MathSpan` for rendering via `temml.renderToString` (dynamically imported).

`MarkdownBody.jsx` passes `{ singleDollarTextMath: false }` to `remarkMath`, so a single `$` is never treated as a math delimiter — only `$$...$$` is. Without this, ordinary currency text (e.g. a pricing table cell like `**$40 per 100GB** ($0.40/GB)`) has two literal `$` that `remark-math` would otherwise pair up into a bogus inline-math span covering everything between them, which Temml then renders as garbled math instead of the original text. This is why `normalizeMathDelimiters()` always emits `$$...$$` (never single `$`) for the backslash-form conversion — it has to stay consistent with `singleDollarTextMath: false` or converted inline math would stop rendering.

`temml/dist/temml.mjs` has **only a default export** (no named exports) — import as `const { default: temml } = await import(...)`. Its bundled `renderMathInElement` (unused here, but relevant if ever adopted for DOM-scanning) internally calls the *global* `window.temml.render(...)` instead of its own module scope (to avoid a circular import), so it throws `ReferenceError: temml is not defined` unless `window.temml` is set first — `MathSpan` avoids this entirely by calling `temml.renderToString()` directly instead.

`src/App.jsx` preloads the Temml chunk via `requestIdleCallback` (falls back to `setTimeout` — WKWebView didn't support `requestIdleCallback` until relatively recently) right after mount, so the first math-containing message doesn't pay the ~200KB chunk's download/parse cost; `MathSpan`'s own `import()` of the same specifier then resolves from cache.

### Code splitting / lazy loading

`SidePanel` and `SettingsPage` are `React.lazy()`-wrapped, each declared once at module scope (not inside a render function) — this matters because `React.lazy` caches the resolved module on that one lazy-component reference, so every mount *after* the first renders immediately with no Suspense fallback flash. Both are safe to lazy-load because they only ever mount in response to an explicit user action (opening the side panel / settings) — never during initial app boot.

`ToolActivity` (in `MessageBubble.jsx`) was tried as a `React.lazy()` import and **reverted** — unlike SidePanel/SettingsPage, it isn't gated behind a user action: a restored session's message history is hydrated from SQLite immediately at launch, and any past message with tool calls mounts `ToolActivity` as part of that very first render. Lazy-loading it meant every historical tool-call bubble flashed from a "Loading tools…" Suspense fallback to the real content the instant the chunk resolved — a visible flicker on launch for any chat with prior tool activity, not a deferred load at all. The lesson generalizes: before lazy-loading a component, check whether it can appear in the *initial* render (e.g. via restored/hydrated state), not just whether it's conditionally rendered — "conditional" and "deferred until user action" aren't the same thing.

Don't lazy-load components that are needed on every render of a hot path (e.g. `MarkdownBody`, `ReactMarkdown`, `remark-gfm`) — they were tried as lazy imports and reverted, since a plugin/library value (not a component) can't be meaningfully wrapped in `React.lazy` anyway, and a component that's needed immediately just gains a Suspense-flash for no benefit. Likewise, `App` itself should **not** be lazy-loaded from `main.jsx` — it's always needed immediately on every launch (no conditional), and since this is a local Tauri bundle rather than a public multi-visit website, there's no cross-session caching win to justify the extra async hop before first paint.

Theme persistence lives in the `settings` SQLite table via `useSettingsStore` (no `localStorage`). To prevent a flash of the wrong theme on launch, an inline `<script>` at the top of `<head>` in `index.html` reads a legacy `localStorage['luma:theme']` value (if any), falls back to `prefers-color-scheme`, and sets `data-theme` on `<html>` synchronously before React mounts. `useSettingsStore.hydrate()` then re-applies the authoritative SQLite value (and migrates a legacy `localStorage` entry into SQLite on first run).

## Common tasks

Concrete entry points for changes that come up often. Skim this list before grepping.

- **Focus the input box** — `textareaRef` in `InputArea.jsx`. Existing triggers: the `prefill` effect (focuses + sets cursor) and the `focusNonce` effect. The `focusNonce` effect has a `hasSeenFocusBump` guard that **skips the initial mount** so the main chat doesn't steal focus on app boot — but this guard also swallows a `bumpFocus()` that runs *before* the `InputArea` mounts. That was the bug with new side chats: `addSideChat` calls `bumpFocus()` before the new tab's `InputArea` mounts, so the already-bumped `focusNonce` arrived as the "initial" value and got skipped. Fix: side chat panes pass `autoFocus={isSideChat}` so their input focuses on mount (a side chat's `InputArea` only mounts when the tab is created, which is exactly when focus is wanted). For a different "focus on new chat" use case, either set `autoFocus` or bump a `chatNonce`-derived value passed in as a key on `InputArea`.
- **Auto-scroll on new content** — `messages.length` watcher in `ChatPane.jsx`. Uses a `prevMessagesCountRef` to distinguish new messages from in-place streaming token updates. `requestAnimationFrame` is required because the new message isn't mounted when the effect fires.
- **Per-pane toggle (web search, thinking)** — local `useState` in `ChatPane`, re-derived from its default whenever `chatNonce` bumps (new chat / loaded session) so it doesn't carry over between chats, with a `*TouchedRef` (cleared on each `chatNonce` change) so the user's manual override survives re-derivation *within* a chat. Web search is gated on settings `hydrated`; thinking derives from the model. Don't re-derive on every render.
- **Reset a chat's per-pane state** — bump `chatNonce` (e.g. `clearMessages` and `loadMessages` already do this). Effects that derive per-chat defaults should watch `chatNonce`, not `model`.
- **Add a new Tauri command** — add the function in `tauri/src/commands.rs`, register it in `tauri::generate_handler![]` in `main.rs`, and mirror a wrapper in `src/lib/db.js` or `src/lib/tools.js`. For a long-running stream, use the `ollama_chat_stream` pattern (Rust emits `ollama://chunk` / `ollama://done` / `ollama://error` events; frontend subscribes with `listen()` keyed by a `request_id`).
- **Add a new persisted setting** — add the key to `SETTING_KEYS` in `src/store/settingsStore.js`, read it via the store (never `localStorage`), and the write-through to SQLite is automatic. For schema-level changes, append a new step to `MIGRATIONS` in `db.rs` (wrap its SQL in `.ok()`) — never edit or reorder existing steps, since their position is their `user_version` number.
- **Ollama server URL + API key** — `ollamaUrl` and `ollamaApiKey` in `useSettingsStore`. The URL (default `""` = `localhost:11434`) and key are passed to all three Ollama proxy commands (`ollama_reachable`, `ollama_list_models`, `ollama_chat_stream`) as `ollama_url`/`api_key` optional params; `commands.rs` has `resolve_ollama_base()` to apply the fallback. `ollamaApiKey` is unified: it covers both the `Authorization: Bearer` header for the remote server and the Ollama web search API — so users only set it once in the "Ollama server" settings section; the web search section shows a note instead of a duplicate input when the key is already set.
- **Add a new tool the model can call** — define the Ollama schema in `TOOLS` in `src/lib/tools.js` and a case in `executeTool`. Web tools must run as Tauri commands (CORS). Local tools run in the renderer.
- **Add a test** — Vitest with jsdom, Tauri APIs mocked in `src/test/setup.ts`. Files match `src/**/*.test.{js,jsx,ts,tsx}`. Prefer `npm run test:run` over `npm test` to avoid the watch loop.
- **Delete a side chat** — trash button in `ChatPane`'s header (next to the `{label}` caption, gated on `isSideChat`), using the same two-step confirm pattern as the Sidebar's `SessionRow`. Calls `removeSideChat(sessionId, sideChatId)` in `sessionStore`. That action must also call `deleteSideChatStore(id)` to evict the tab's store from the `_sideChatStores` Map (same cleanup `removeChatSession` does for its side chats) — otherwise a stale store lingers. Deleting the last side chat leaves the panel empty (no auto-recreate; that only fires on session switch). If a side chat has children (see below) and gets deleted, its children are *not* cascade-deleted — they become orphans and `SidePanel`'s tree-builder treats them as top-level so they stay visible. When the deleted tab was active, `removeSideChat` picks the next active tab itself (UI-only — it deliberately doesn't call `db.setActiveSideChat`, unlike `setActiveSideChatId`): the deleted tab's parent if it still exists, otherwise the last remaining tab in `sess.sideChats` array order (closest to "most recently created", since `addSideChat` always appends) — never just `remaining[0]`, which would jump to an unrelated old tab.
- **Branch a side chat from another side chat** — side chats can nest: a side chat's `parentSideChatId` (`sessionStore.addSideChat(sessionId, model, parentSideChatId)`) marks it as branched from another side chat instead of the main chat. Two entry points create one: the `GitBranch` icon in `ChatPane`'s header (next to delete, `onBranch` prop wired in `SidePanel.jsx`), and "Ask in side chat" from a text selection *inside* a side chat (`MessageBubble.jsx`'s `parentSideChatId` prop, passed by `ChatPane` as `sideChatId` when `isSideChat`). The child's `contextStore` (what `useStreamingChat` injects as "recent conversation" context) resolves to `getSideChatStore(parentSideChatId)` instead of `useMainChat` — see the ternary in `SidePanel.jsx`'s `ChatPane` render. Tab labels are computed by `buildSideChatTree()` in `SidePanel.jsx`: a depth-first walk of the parent/child relationships assigns path labels (`1`, `1.1`, `1.1.1`, ...) *and* the tab display order in one pass, so a child tab always renders immediately after its parent regardless of creation order across the flat `sideChats` array.

## Things to know before you change state stores

- **Don't read `useSettingsStore` at module init.** It returns in-memory defaults before SQLite hydration completes. Subscribe to `hydrated` and apply values in an effect, or read `useSettingsStore.getState()` inside an action (e.g. `clearMessages` does this for `defaultModel`).
- **Store actions, not components, write to SQLite.** The pattern is: store action mutates state → calls `db.saveX()` → store is the single source of truth.
- **Tab switching in the side panel never calls `loadMessages`.** Each tab owns its store permanently (via the `_sideChatStores` Map in `chatStore.js`). Switching tabs is a pure UI concern handled by `activeSideChatId`.
- **`activeChatId` is for navigation, not activity.** Bump `updated_at` only on real user actions via `bumpSessionActivity(id)`.

## Keeping docs in sync

- **Skim `README.md` whenever you touch stack, persistence, or architecture — and fix any drift you find.** README drift is silent (no tests catch it), so the only way to keep it honest is a deliberate check. If a section describes something that no longer matches the code, correct it in the same commit as the code change. Sections most prone to drift: Stack, Persistence/Migrations, Architecture/State stores, and the project layout file tree.

## Vite Dynamic Import Warning Fix

- **Mixed static and dynamic imports of `@tauri-apps/api/core` were causing Vite optimization warnings.** The solution was to standardize on dynamic imports using a lazy-loading pattern with caching in `src/lib/ollama.js`. This eliminated the warning while maintaining all functionality and graceful fallback behavior in browser/dev environments.


## Tauri / WebView pitfalls

- **Don't use `display: none` to hide simultaneously-mounted panes.** In Tauri's WKWebView, a textarea inside a container that transitions from `display: none` → `display: flex` will render visually but won't accept click-to-focus (no cursor, no placeholder). Use `visibility: hidden; pointer-events: none` with `position: absolute; inset: 0` stacking instead — all elements stay in the layout and fully initialized, so focus works the moment the pane becomes visible. See `SidePanel.module.css` (`.tabPane` / `.tabPaneActive`) for the pattern.
- **CSS module changes may not hot-reload in the Tauri dev window.** A full app restart is sometimes needed to pick up layout changes even when Vite reports a successful HMR update.
- **Unsigned macOS builds are blocked by Gatekeeper on download.** The app is not code-signed or notarized, so macOS quarantines it. Users must run `xattr -cr /path/to/Luma.app` before opening. This affects arm64 (Apple Silicon) more strictly than x86_64. Fixing this properly requires an Apple Developer account and signing config in `tauri.conf.json`.

## Editor tooling

- **Ignore Prettier-only churn in diffs.** The editor's file-write tool runs Prettier on the whole file when saving, which can reformat unrelated lines (line breaks, JSX attribute wrapping, etc.). Don't try to revert those hunks — they're a no-op in practice since the project's `npm run dev` / `npm run build` pipeline would format the same way. Focus on the semantic change and the lines that trace directly to the user's request.
- **Verify UI/CSS tweaks with a throwaway HTML repro, not the repo.** When confirming a visual change (heading sizes, list indent, etc.), build a minimal standalone HTML that mirrors the global reset + bubble + `markdownBody` and screenshot it via the Playwright MCP. Write that file and its screenshot to `/tmp`, **not** the repo root — the Playwright screenshot tool defaults its output dir to the repo root, and the commit hook auto-stages untracked files, so stray `*.png` will silently get swept into your commit. Always `git show --stat HEAD` after committing to catch this.
