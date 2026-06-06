# Luma

A dual-pane AI chat desktop app built with Electron, React, and [Ollama](https://ollama.com).

## Features

- **Dual-pane layout** — main chat and a resizable side chat panel
- **Side chat context** — the side chat automatically receives the main chat's conversation as context, so you can ask follow-up questions about main chat responses
- **Streaming responses** — token-by-token output with stop button
- **Multi-model support** — switch models per pane; includes cloud models via Ollama Pro
- **Vision model support** — attach images via file picker or paste from clipboard
- **Clipboard paste** — paste images directly into the input (Ctrl+V / Cmd+V)
- **Resizable side panel** — drag the divider to resize
- **Light & dark themes** — toggle in the title bar; choice persists, with OS `prefers-color-scheme` fallback
- **Persistent chat history** — sessions, messages, and side chats are saved locally via SQLite (better-sqlite3) and restored on launch

## Requirements

- [Ollama](https://ollama.com) running locally on `http://localhost:11434`
- Node.js 18+

## Getting Started

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

Outputs an NSIS installer to `dist-electron/`.

## Stack

- **Electron** — desktop shell
- **React + Vite** — UI
- **Zustand** — state management
- **better-sqlite3** — local persistence
- **Tailwind CSS** — utility classes
- **Ollama API** — local and cloud model inference
