# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # Start Vite dev server + Electron together (hot reload)
npm run build      # Vite production build → electron-builder package
npm postinstall    # Rebuilds better-sqlite3 native module against Electron's Node ABI
```

There are no tests or linters configured.

## Architecture

**Luma** is a dual-pane Ollama chat desktop app (Electron + React/Vite + SQLite).

### Process boundary

The app has two separate JS processes with strict context isolation:

- **Main process** (`electron/`): owns the SQLite DB, window controls, and all network I/O (web search/fetch via DuckDuckGo + Readability). Never directly accessible from the renderer.
- **Renderer process** (`src/`): React UI. Reaches the main process only through the bridge objects that `electron/preload.js` exposes: `window.electron`, `window.db`, `window.webTools`.

IPC channels are registered in `electron/ipc.js` and mirrored in `electron/preload.js`. When adding a new main-process capability, both files need updating plus a thin client wrapper in `src/lib/db.js` or equivalent.

### State management (Zustand)

Three independent stores; none are persisted to `localStorage` (persistence goes to SQLite):

| Store | File | Owns |
|---|---|---|
| `useMainChat` / `useSideChat` | `src/store/chatStore.js` | Per-pane messages, streaming state, tool call records |
| `useSessionStore` | `src/store/sessionStore.js` | Session list, side-chat metadata, DB write-through |
| `useUiStore` | `src/store/uiStore.js` | Theme, sidebar open state, Ollama connectivity |

`chatStore.js` exports a factory `createChatStore(id)` — both panes use identical logic from the same factory. The two singletons are `useMainChat` and `useSideChat`.

`useSessionStore` is the only store that writes to SQLite directly. All DB mutations (save messages, upsert side chats, etc.) happen inside its actions, not in components.

### Streaming and tool-calling loop

`src/lib/ollama.js` → `streamChat()` runs the full tool-calling loop. It sends the messages array to Ollama, streams the response, and if the model returns `tool_calls`, it executes them via `executeTool` (from `src/lib/tools.js`), appends `role: "tool"` messages, and re-calls the model — up to `maxToolRounds = 5` times. The final text response triggers `onDone`.

`useStreamingChat` hook (`src/hooks/useStreamingChat.js`) wires the store actions (`addToolCall`, `completeToolCall`, `finalizeMessage`) to the `streamChat` callbacks and handles session creation on first message.

### Tool execution

`src/lib/tools.js` exports `TOOLS` (Ollama-format definitions) and `executeTool(name, args)`. Local tools (e.g. `get_current_time`) run in the renderer. Web tools (`web_search`, `web_fetch`) cross the IPC boundary via `window.webTools` to avoid CORS; the implementations live in `electron/tools/`.

Web search is per-pane toggleable (stored in `useUiStore`). `useStreamingChat` filters `TOOLS` to exclude web tools when the toggle is off before passing them to `streamChat`.

### Database schema

`electron/db.js` owns the schema and all queries (better-sqlite3, synchronous API). Tables: `sessions`, `messages`, `side_chats`, `side_chat_messages`. Message rows store `images` and `tool_calls` as JSON strings. On `init()`, `ALTER TABLE … ADD COLUMN` migrations run inside a try/catch to handle existing DBs gracefully.

### Theming

`src/theme.js` has the full color palette for `dark` and `light` as a JS object (`getTheme(name)`) and sets a `data-theme` attribute on `<html>`. `src/index.css` mirrors the same tokens as CSS custom properties (`var(--bg)`, etc.) for use in stylesheets. Components use whichever is convenient — the values are kept in sync manually.
