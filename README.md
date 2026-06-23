# Luma

![Luma light mode](screenshots/light.png)

A research workbench for deep-dive topic exploration, built as a dual-pane desktop app on top of local LLMs. The main chat is the spine of a research session, and side chats are branches for drilling into subtopics and sources — with live web search and fetch so the model can ground its answers.

- **Stack:** Tauri + React/Vite + SQLite + [Ollama](https://ollama.com)
- **Not a general chatbot:** every capability exists to help a user research and deeply understand a topic. See `ROADMAP.md` for the long-term plan.

## Features

### Layout
- **Dual-pane layout** — main chat on the left, resizable side panel on the right
- **Resizable side panel** — drag the divider to resize
- **Sidebar** — session list with persistent history
- **Custom frameless title bar** — drag it to move the window, double-click to maximize/restore, with the app's own minimize/maximize/close controls

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
- **Auto-scroll toggle** — a control next to the send button keeps the view pinned to the newest tokens; off by default so you can read back without fighting the scroll
- **Inline message editing** — edit one of your earlier messages in place and resend from that point
- **Per-pane thinking toggle** — an icon next to the web-search button turns the model's internal reasoning step on or off for that pane. It defaults on for cloud models (which reason quickly) and off for local models (where the extra reasoning pass is slow), following the pane's model until you toggle it manually

### Vision
- **Image attachments** — file picker or clipboard paste (Ctrl/Cmd+V) into either pane
- **Vision-capable models** — any Ollama model that supports image input works automatically

### Research tools (tool-calling)
The model can call tools as it responds, with full visibility into the process:
- **`web_search(query)`** — web search via the selected provider (DuckDuckGo, no key; or Ollama cloud, API-key gated). Returns titles, URLs, snippets.
- **`web_fetch(url)`** — fetch a URL and extract clean readable content (Mozilla Readability for DuckDuckGo; Ollama's extractor for the cloud provider)
- **`get_current_time()`** — local time + timezone

Web tools run in the Tauri Rust backend (no CORS, network code stays in one auditable place) and are exposed to the frontend via `@tauri-apps/api/core`. The tool-call loop is bounded by the **Tool call limit** setting (0 = unlimited); when the limit is reached the model makes one final pass with tools disabled but keeps everything it gathered, so it answers from its findings instead of erroring out. The `ToolActivity` component shows a live indicator (`🔍 Searching for "..."`, `📖 Reading article...`) plus a collapsible summary of every tool used for that response.

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

### Persistence
- **SQLite via Tauri Rust backend** — sessions, messages, side chats, custom model aliases, and user settings are all stored locally (rusqlite) and restored on launch
- **Immediate writes** — messages are persisted as they arrive, so a session survives a crash, an aborted generation, or an error mid-stream
- **No cloud sync** — research is the user's private work, not a collaborative product
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
```

The frontend test suite covers Zustand store logic, tool definitions, Ollama utilities, and the DB command wrapper. The Rust test suite covers HTML-to-markdown conversion and DB serialization. No integration tests against a live Ollama instance are included.

## Architecture

The app runs with a Rust backend and a React frontend:

- **Rust backend** (`tauri/`) — owns the SQLite DB, window controls, and all outbound HTTP (web search/fetch via `reqwest` + `scraper` + `readability`). Exposed through Tauri commands.
- **Frontend** (`src/`) — React UI. Reaches the Rust backend through `@tauri-apps/api/core` → `invoke()` calls, wrapped in thin client modules (`src/lib/db.js`, `src/lib/tools.js`).

State lives in four independent Zustand stores. None of them persist to `localStorage`; durability is the DB's job (settings included).

| Store | File | Owns |
|---|---|---|
| `useMainChat` / `getSideChatStore(id)` | `src/store/chatStore.js` | Per-pane messages, streaming state, tool-call records (same factory; one store per side chat tab, keyed by id) |
| `useSessionStore` | `src/store/sessionStore.js` | Session list, side-chat metadata (including parent/branch relationships) — the only store that writes chat data to SQLite |
| `useUiStore` | `src/store/uiStore.js` | Transient view state: side-chat open/closed, Ollama connectivity, settings page open |
| `useSettingsStore` | `src/store/settingsStore.js` | Persisted settings: theme, default model, web search default, tool call limit, search provider, Ollama API key — write-through to the `settings` SQLite table |

## Stack

- **Tauri 2** — desktop shell, Rust-powered with OS-native webviews
- **React 18 + Vite 5** — UI and dev server
- **Zustand 4** — state management
- **rusqlite** — synchronous local persistence in the Rust backend
- **CSS Modules** — scoped per-component stylesheets
- **Ollama API** — local and cloud model inference
- **react-markdown + remark-gfm + remark-math + rehype-katex** — message rendering
- **reqwest + scraper + readability** — web search and article extraction in the Rust backend
- **lucide-react** — icons

## Project layout

```
luma-chat/
├── tauri/                 Rust backend: DB, commands, web tools
│   └── src/
│       └── tools/         search.rs, fetch.rs, ollama_search.rs, html.rs (web tools)
├── src/                   React UI
│   ├── components/        ChatPane, SidePanel, Sidebar, SettingsPage, InputArea, MessageBubble, ToolActivity…
│   ├── hooks/             useStreamingChat, useDbInit, useChatSession
│   ├── lib/               ollama.js, tools.js, db.js, systemPrompt.js
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
