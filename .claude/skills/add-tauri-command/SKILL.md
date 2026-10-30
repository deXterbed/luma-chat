---
name: add-tauri-command
description: Add a new Tauri command end to end. Use when adding a backend command, exposing new Rust functionality to the frontend, or adding a native file dialog.
---

- **Add a new Tauri command** — add to `commands.rs`, register in `lib.rs`'s `generate_handler![]`, mirror a wrapper in `src/lib/db.js`/`src/lib/tools.js`. For long-running streams, follow the `ollama_chat_stream` event pattern (`ollama://chunk`/`done`/`error`, keyed by `request_id`).
- **Add a native save/open file dialog** — `@tauri-apps/plugin-dialog`'s `save()`/`open()` for the path, then a plain Tauri command doing `std::fs` I/O (see `export_chats`/`import_chats`). Add permissions to `tauri/capabilities/default.json`.
