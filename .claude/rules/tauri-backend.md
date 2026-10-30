---
paths: ["tauri/src/**"]
---

# Rust backend rules

Detail: `docs/architecture/database.md`, `codebase-mode.md`, `backup-restore.md`.

- **Register a new command in `lib.rs`'s `tauri::generate_handler![]`**, never in `main.rs` — that file is six lines calling `luma_lib::run()`.
- **`MIGRATIONS` is append-only.** A step's position is its `user_version`; append a new step wrapped in `.ok()`, never edit or reorder an existing one.
- **Expected failures return as observations, not `Error`-prefixed strings** (see `AGENTS.md`). `Error: QUOTA:` is the only deliberate exception.
- **Caps are applied before loading**, never read-then-truncate. `tauri/src/tools/fetch.rs` streams the body against `MAX_HTML_BYTES`; don't revert it to `res.text()`. Its fallback `strip_tags` uses `to_ascii_lowercase` (not `to_lowercase`) so byte offsets stay aligned for slicing.
- **The DB is not a trusted source for a project root.** `commands.rs`'s `roots_to_paths` re-applies the denylist on every file-tool call, because `import_chats` writes a backup's roots straight into it.
- **A directory handed to `read_file` must be caught with `metadata().is_dir()` first** — on Unix `File::open` opens a directory happily and fails later with `EISDIR`, which surfaces as an infrastructure error instead of an observation.
