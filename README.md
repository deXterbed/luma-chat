# Luma

![Luma light mode](screenshots/light.png)

A research workbench for deep-dive topic exploration, built as a dual-pane desktop app on top of local LLMs. The main chat is the spine of a research session, and side chats are branches for drilling into subtopics and sources — with live web search and fetch so the model can ground its answers. Attach a project folder and the same loop becomes **Codebase mode**: read-only file tools, so you can ask how real code works and branch off any answer to keep drilling.

- **Stack:** Tauri + React/Vite + SQLite + [Ollama](https://ollama.com)
- **Not a general chatbot:** every capability exists to help a user research and deeply understand a topic. See `ROADMAP.md` for the long-term plan.

## Features

### Layout
- **Dual-pane layout** — main chat on the left, resizable side panel on the right
- **Resizable side panel** — drag the divider to resize
- **Sidebar** — session list with persistent history
- **Custom frameless title bar** — drag it to move the window, double-click to maximize/restore. It draws its own minimize/maximize/close controls on Windows and Linux; on macOS it keeps the native traffic lights, so the OS also draws the window's rounded corners and shadow

### Side chat as first-class research branch
- **Auto context bridge** — the side chat automatically receives the main chat's conversation as context, so you can ask follow-up questions about main-chat responses without losing the main thread
- **Side chats are isolated** — drilling into a subtopic in a side chat doesn't disturb the main conversation
- **Pre-filled prompts** — opening a side chat from a main message prefills a research-focused prompt
- **Nested side chats** — branch a side chat off of another side chat (the branch icon in its header, or "Ask in side chat" on a selection inside it) to drill further into a subtopic without losing that thread's own context. A branched side chat's context bridge points at its parent side chat, not the main chat
- **Path-numbered tabs** — side chat tabs are labeled by their position in the branch tree (`1`, `2`, `1.1`, `1.1.1`, ...) so it's clear at a glance which side chat each one branched from

### Models
- **Multi-model support** — switch models per pane, independent of the other
- **Default model in Settings** — pick which model new chats and side chats start on; the per-pane picker still wins once a chat is open
- **Side chats inherit the main model** — a side chat opens on whatever model the main chat is using
- **Local + cloud** — uses any Ollama-served model, including Ollama Pro cloud models

### Streaming & control
- **Token-by-token streaming** — see the response build as the model generates, throttled to animation-frame cadence so long responses stay smooth
- **Stop button** — cancels mid-generation and halts the UI immediately, keeping whatever streamed so far
- **Switching chats stops the run** — opening another session or starting a new chat mid-generation cancels it rather than leaving it running in the background; the part-written answer is dropped instead of being saved into either chat
- **Auto-scroll toggle** — a control next to the send button keeps the view pinned to the newest tokens; off by default so you can read back without fighting the scroll
- **Inline message editing** — edit one of your earlier messages in place and resend from that point
- **Per-pane thinking toggle** — an icon next to the web-search button turns the model's internal reasoning step on or off for that pane. It defaults on for cloud models (which reason quickly) and off for local models (where the extra reasoning pass is slow), following the pane's model until you toggle it manually. The reasoning is saved with the message, so reopening a chat still shows how an answer was reached (it is display-only — it is never fed back to the model)
- **Follow-up subtopic chips** — after an answer finishes, 1–3 clickable follow-up questions appear beneath it. Clicking one sends it as your next message in the same pane, so you keep exploring without retyping. Suggestions come from a separate focused model call made after the answer (not a tool the main response calls) and are transient — they disappear on reload

### Vision
- **Image attachments** — file picker or clipboard paste (Ctrl/Cmd+V) into either pane
- **Vision-capable models** — any Ollama model that supports image input works automatically

### Research tools (tool-calling)
The model can call tools as it responds, with full visibility into the process:
- **`web_search(query)`** — web search via the selected provider (DuckDuckGo, no key; or Ollama cloud, API-key gated). Returns titles, URLs, snippets.
- **`web_fetch(url)`** — fetch a URL and extract clean readable content (Mozilla Readability for DuckDuckGo; Ollama's extractor for the cloud provider)
- **`get_current_time()`** — local time + timezone

Web tools run in the Tauri Rust backend (no CORS, network code stays in one auditable place) and are exposed to the frontend via `@tauri-apps/api/core`. The tool-call loop is bounded by the **Tool call limit** setting (0 = unlimited); when the limit is reached the model makes one final pass with tools disabled but keeps everything it gathered, so it answers from its findings instead of erroring out. When the model issues several searches in one round they run **in parallel** (capped at 3) so a batch completes in the time of the slowest call, not the sum; a per-response **search budget** (15 `web_search`/`web_fetch` calls, 0 = unlimited) bounds total web activity, after which the model answers from what it gathered. The `ToolActivity` component shows a live indicator (`🔍 Searching for "..."`, `📖 Reading article...`) plus a collapsible summary of every tool used for that response.

### Codebase mode (read-only project research)

Attach a project folder from the pane header (the folder icon) and the model gains read-only access to that codebase — how Luma answers "how does this work?" about real code instead of about its training data. Attach more than one and it reads across them.

- **Three read-only tools** — `read_file` (line-numbered, paginated with `offset`/`limit`), `search_code` (ripgrep's own engine: literal by default with `regex` as an opt-in, respects `.gitignore`, and `files`/`count` outputs for triage before reading), and `list_dir`
- **Nothing leaves the attached folders** — every path the model supplies is relative, resolved against one of the attached roots and canonicalized *before* it's checked, so `../`, absolute paths, and symlinks pointing outside are all refused. There is no write, edit, or shell tool: Codebase mode reads code, it doesn't change it
- **Side chats inherit it** — a side chat opened from a codebase answer keeps file access, so a question about the answer doesn't need a trip back to the main thread
- **Web search defaults off while a folder is attached** — reading files and reaching the web from one context is the outbound pair (a fetched page can ask for a file, a file can leave inside a URL), so attaching a folder turns the pane's web-search toggle off whatever your global default says. Turn it back on in the header if you want docs lookup mid-codebase
- **The attached folder *is* the mode switch** — detach it and the pane is an ordinary chat again; there's no separate toggle to keep in sync
- **Several folders per session** — the header's picker takes a multi-select, each attached folder gets its own chip, and each chip detaches on its own. `search_code` sweeps all of them; `read_file` and `list_dir` act on the first, and all three take `root` to name a different folder (the model is told the folder names, never the absolute paths). A path that exists under a different folder says so rather than a bare "not found"
- **Bounded by design** — per-call caps (2000 lines, ~150 KB per read, 20 matches per file) plus per-response budgets (60 file calls, ~150 KB) and a later wrap-up nudge, so reading a large repo can't run away with the context window
- **Sizes its own context window** — attaching a folder raises `num_ctx` automatically for cloud models, capped by the window the model itself reports from Ollama (a 256k-window model ends up at 65536, not a guess). Local models keep your Settings value, since that memory is yours, and the agent log records the number each run used

### Agent log (tuning the harness)

An opt-in record of what the agent loop actually did, written as JSONL (one JSON object per line) to `<app data>/logs/agent.jsonl`, so the harness can be tuned from evidence rather than guesswork:

- **The decisions** — the system prompt sent, which tools were offered, the resolved limits, and which policy message (wrap-up, force-final, rate-limit nudge) fired on which round
- **The model's behaviour** — per-round content and thinking sizes, latency, and the model's stated plan for that round
- **Every tool call** — name, arguments, verdict, timing, and the result's length plus head and tail (never the whole file)
- **Why each run ended** — `final`, `quota`, `abort`, or `error`, always recorded, even on the paths that return or throw

```bash
# Is the model looping? repeated identical calls show up as counts > 1
jq -r 'select(.t=="tool") | "\(.name) \(.args|tostring)"' agent.jsonl | sort | uniq -c | sort -rn

# Did the runs finish, or did the harness cut them off?
jq -c 'select(.t=="stream.end") | {reason, rounds, fileCalls, fileBytes}' agent.jsonl
```

Off by default (Settings → Agent log), because it contains the prompt and excerpts of whatever the model read. Batched at round boundaries, and it can never fail a chat turn.

### Search controls
- **Per-pane web search toggle** — disable web tools in either pane for sessions that don't need them. The renderer filters the tool list before passing it to the model.
- **Global web search default** — the per-pane toggle seeds from a setting you can change in the Settings page. The per-pane override itself isn't persisted.
- **Search provider** — choose DuckDuckGo (no key) or Ollama cloud search (needs an API key) in Settings. Quota/auth failures from the Ollama provider surface as a dismissible app-wide banner that links to Settings, instead of failing silently mid-response.

### Settings
A dedicated settings page (gear icon in the title bar) covers the most common knobs, all persisted to SQLite (no `localStorage`):
- **Appearance** — dark/light theme; choice re-applied synchronously before React mounts to avoid a flash of the wrong theme on launch
- **Default model** — dropdown of locally-pulled and user-added custom models; new chats and side chats start with this
- **Web search default** — global on/off for the per-pane web search toggle
- **Search provider & Ollama API key** — pick DuckDuckGo or Ollama cloud search; the key is stored locally and only used for the Ollama provider
- **Tool call limit** — max tool-calling rounds before the model is made to answer from what it has (0 = unlimited)
- **Context window (`num_ctx`)** — how many tokens the model can hold at once (2048–131072). Raise it to 32768 or more before attaching a project folder
- **Temperature** — sampling randomness, 0 (deterministic) to 2; lower suits reading code, higher suits brainstorming
- **Agent log** — opt-in structured log of the agent loop (see Agent log above), for tuning how the model actually behaves

### Persistence
- **SQLite via Tauri Rust backend** — sessions, messages, side chats, custom model aliases, attached project folders, and user settings are all stored locally (rusqlite) and restored on launch
- **Immediate writes** — messages are persisted as they arrive, so a session survives a crash, an aborted generation, or an error mid-stream
- **No cloud sync** — research is the user's private work, not a collaborative product
- **…unless you point Luma at a remote server** — an Ollama URL that isn't loopback means your prompts, and in Codebase mode the files the model reads, are sent there. Luma gives a one-time notice when you attach a folder in that setup; a local Ollama keeps everything on the machine
- **Backup & restore** — export every chat to a compressed `.lumabackup` file and import it back (chat data only; settings and API keys are never included). Attached project folders travel with their session; one that doesn't exist on the new machine is marked missing rather than failing the import
- **Migrations** — schema upgrades are tracked via SQLite's `PRAGMA user_version`, so each migration runs exactly once per database instead of being re-attempted on every launch; a one-time theme migration picks up a legacy `localStorage` value and writes it to SQLite

### Theming
- **Light & dark themes** — toggle in the title bar or the Settings page; choice persists in the `settings` SQLite table, with `prefers-color-scheme` as the first-launch fallback
- **No FOUC** — an inline `<script>` in `index.html` sets `data-theme` on `<html>` before React mounts, so the first paint already uses the right palette
- **CSS Modules** — scoped per-component styles (`*.module.css`); no Tailwind

## Requirements

- [Ollama](https://ollama.com) running locally on `http://localhost:11434`
- [Rust](https://rustup.rs) (stable toolchain)
- Node.js 18+

## Getting Started

```bash
npm install
npm run dev
```

## Troubleshooting

### macOS: "Luma is damaged and can't be opened"

macOS Gatekeeper quarantines apps downloaded from the internet that aren't notarized. Run this in Terminal after downloading:

```bash
xattr -cr /path/to/Luma.app
```

Then open the app normally. Alternatively: **System Settings → Privacy & Security** → scroll down → click **Open Anyway**.

### Windows: `linking with link.exe failed`

If you see an error mentioning `link: extra operand` during `npm run build` (or `npm run dev`, which compiles internally), the GNU `link.exe` shipped with Git for Windows is shadowing the MSVC linker. See [`docs/windows-link-exe-conflict.md`](docs/windows-link-exe-conflict.md) for the diagnosis and three ways to fix it.

## Build

```bash
npm run build
```

Runs `vite build` then `tauri build`.

## Tests

```bash
# Run all tests (frontend + Rust backend)
npm run test:all

# Frontend only (Vitest, watch mode)
npm test

# Frontend once (CI)
npm run test:run

# Rust backend only (cargo test)
npm run test:rust

# Formatting + clippy (the repo's lint; there is no JS linter)
npm run lint

# lint + frontend tests + `cargo check --all-targets` — the pre-push gate
npm run check
```

The frontend test suite covers Zustand store logic, tool definitions and argument coercion, the agent log, system prompts, Ollama streaming utilities and loop policy, follow-up subtopic parsing, and the DB command wrapper. The Rust test suite covers HTML-to-markdown conversion, DB serialization and migrations, the backup container, and the Codebase file-tool guard (path escapes, symlink refusal, root validation). Three `cargo test` cases read a legacy Electron-era database and fail on a machine that doesn't have one — `CLAUDE.md` explains which and why, and `.github/workflows/ci.yml` skips them by name so the rest of the suite still runs on CI. No integration tests against a live Ollama instance are included.

## Architecture

The app runs with a Rust backend and a React frontend:

- **Rust backend** (`tauri/`) — owns the SQLite DB, window controls, all outbound HTTP (web search/fetch via `reqwest` + `scraper` + `readability`), and the read-only project file tools (ripgrep's `ignore`/`grep-*` crates, root-bounded). Also appends the opt-in agent log. Exposed through Tauri commands.
- **Frontend** (`src/`) — React UI. Reaches the Rust backend through `@tauri-apps/api/core` → `invoke()` calls, wrapped in thin client modules (`src/lib/db.js`, `src/lib/tools.js`).

State lives in four independent Zustand stores. None of them persist to `localStorage`; durability is the DB's job (settings included).

| Store | File | Owns |
|---|---|---|
| `useMainChat` / `getSideChatStore(id)` | `src/store/chatStore.js` | Per-pane messages, streaming state, tool-call records, attached project folders (same factory; one store per side chat tab, keyed by id) |
| `useSessionStore` | `src/store/sessionStore.js` | Session list, side-chat metadata (including parent/branch relationships), a session's attached project folders — the only store that writes chat data to SQLite |
| `useUiStore` | `src/store/uiStore.js` | Transient view state: side-chat open/closed, Ollama connectivity, settings page open |
| `useSettingsStore` | `src/store/settingsStore.js` | Persisted settings: theme, default model, web search default, tool call limit, context window, temperature, search provider, Ollama API key, agent log — write-through to the `settings` SQLite table |

## Stack

- **Tauri 2** — desktop shell, Rust-powered with OS-native webviews
- **React 18 + Vite 5** — UI and dev server
- **Zustand 4** — state management
- **rusqlite** — synchronous local persistence in the Rust backend
- **CSS Modules** — scoped per-component stylesheets
- **Ollama API** — local and cloud model inference
- **react-markdown + remark-gfm + remark-math + temml** — message rendering (math via Temml, not KaTeX/MathJax)
- **reqwest + scraper + readability** — web search and article extraction in the Rust backend
- **ignore + grep-searcher + grep-regex** — ripgrep's own walking and searching libraries, for Codebase mode
- **lucide-react** — icons

## Project layout

```
luma-chat/
├── tauri/                 Rust backend: DB, commands, web tools, file tools
│   └── src/
│       └── tools/         search.rs, fetch.rs, ollama_search.rs, html.rs (web), fs.rs (codebase)
├── src/                   React UI
│   ├── components/        ChatPane, SidePanel, Sidebar, SettingsPage, InputArea, MessageBubble, ToolActivity, SubtopicChips…
│   ├── hooks/             useStreamingChat, useDbInit, useChatSession
│   ├── lib/               ollama.js, ollamaStream.js, tools.js, followups.js, agentLog.js, db.js, systemPrompt.js
│   │   └── *.test.js      Unit tests for lib modules
│   ├── store/             chatStore, sessionStore, uiStore, settingsStore
│   │   └── *.test.js      Unit tests for store logic
│   └── test/              test setup and shared mocks (setup.ts)
├── vitest.config.ts       Vitest configuration
├── index.html, vite.config.mjs
└── package.json
```

See `ROADMAP.md` for what's planned next and what's deliberately out of scope.

## License

MIT
