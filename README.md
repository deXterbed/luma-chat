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

### Side chat as first-class research branch
- **Auto context bridge** — the side chat automatically receives the main chat's conversation as context, so you can ask follow-up questions about main-chat responses without losing the main thread
- **Side chats are isolated** — drilling into a subtopic in a side chat doesn't disturb the main conversation
- **Pre-filled prompts** — opening a side chat from a main message prefills a research-focused prompt

### Models
- **Multi-model support** — switch models per pane, independent of the other
- **Default model in Settings** — pick which model new chats and side chats start on; the per-pane picker still wins once a chat is open
- **Local + cloud** — uses any Ollama-served model, including Ollama Pro cloud models

### Streaming & control
- **Token-by-token streaming** — see the response build as the model generates
- **Stop button** — cancel mid-generation

### Vision
- **Image attachments** — file picker or clipboard paste (Ctrl/Cmd+V) into either pane
- **Vision-capable models** — any Ollama model that supports image input works automatically

### Research tools (tool-calling)
The model can call tools as it responds, with full visibility into the process:
- **`web_search(query)`** — DuckDuckGo search, no API key required. Returns titles, URLs, snippets.
- **`web_fetch(url)`** — fetch a URL and extract clean readable content via Mozilla Readability
- **`get_current_time()`** — local time + timezone

Web tools run in the Tauri Rust backend (no CORS, network code stays in one auditable place) and are exposed to the frontend via `@tauri-apps/api/core`. The tool-call loop is capped at 5 rounds per response to prevent runaway iteration. The `ToolActivity` component shows a live indicator (`🔍 Searching for "..."`, `📖 Reading article...`) plus a collapsible summary of every tool used for that response.

### Search controls
- **Per-pane web search toggle** — disable web tools in either pane for sessions that don't need them. The renderer filters the tool list before passing it to the model.
- **Global web search default** — the per-pane toggle seeds from a setting you can change in the Settings page. The per-pane override itself isn't persisted.

### Settings
A dedicated settings page (gear icon in the title bar) covers the most common knobs, all persisted to SQLite (no `localStorage`):
- **Appearance** — dark/light theme; choice re-applied synchronously before React mounts to avoid a flash of the wrong theme on launch
- **Default model** — dropdown of locally-pulled and user-added custom models; new chats and side chats start with this
- **Web search default** — global on/off for the per-pane web search toggle

### Persistence
- **SQLite via Tauri Rust backend** — sessions, messages, side chats, custom model aliases, and user settings are all stored locally (rusqlite) and restored on launch
- **No cloud sync** — research is the user's private work, not a collaborative product
- **Migrations** — `ALTER TABLE` upgrades run on init to handle existing DBs gracefully; a one-time theme migration picks up a legacy `localStorage` value and writes it to SQLite

### Theming
- **Light & dark themes** — toggle in the title bar or the Settings page; choice persists in the `settings` SQLite table, with `prefers-color-scheme` as the first-launch fallback
- **No FOUC** — an inline `<script>` in `index.html` sets `data-theme` on `<html>` before React mounts, so the first paint already uses the right palette
- **Tailwind CSS** — utility classes for layout and components

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
| `useMainChat` / `useSideChat` | `src/store/chatStore.js` | Per-pane messages, streaming state, tool-call records (same factory) |
| `useSessionStore` | `src/store/sessionStore.js` | Session list, side-chat metadata — the only store that writes chat data to SQLite |
| `useUiStore` | `src/store/uiStore.js` | Transient view state: side-chat open/closed, Ollama connectivity, settings page open |
| `useSettingsStore` | `src/store/settingsStore.js` | Persisted settings: theme, default model, web search default — write-through to the `settings` SQLite table |

## Stack

- **Tauri 2** — desktop shell, Rust-powered with OS-native webviews
- **React 18 + Vite 5** — UI and dev server
- **Zustand 4** — state management
- **rusqlite** — synchronous local persistence in the Rust backend
- **Tailwind CSS** — utility classes
- **Ollama API** — local and cloud model inference
- **react-markdown + remark-gfm + remark-math + rehype-katex** — message rendering
- **reqwest + scraper + readability** — web search and article extraction in the Rust backend
- **lucide-react** — icons

## Project layout

```
luma-chat/
├── tauri/                 Rust backend: DB, commands, web tools
│   └── src/
│       └── tools/         search.rs, fetch.rs, html.rs (web tools)
├── src/                   React UI
│   ├── components/        ChatPane, SidePanel, Sidebar, SettingsPage, InputArea, MessageBubble, ToolActivity…
│   ├── hooks/             useStreamingChat, useDbInit, useChatSession
│   ├── lib/               ollama.js, tools.js, db.js, systemPrompt.js
│   │   └── *.test.js      Unit tests for lib modules
│   ├── store/             chatStore, sessionStore, uiStore, settingsStore
│   │   └── *.test.js      Unit tests for store logic
│   └── test/              test setup and shared mocks (setup.ts)
├── vitest.config.ts       Vitest configuration
├── index.html, vite.config.mjs, tailwind.config.js, postcss.config.js
└── package.json
```

See `ROADMAP.md` for what's planned next and what's deliberately out of scope.

## License

MIT
