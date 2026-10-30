# Chat backup and restore

Chat data only, custom `.lumabackup` container, merge rather than additive import.

`export_chats(path)`/`import_chats(path)` (`commands.rs`) back up **chat data only** (sessions, messages, side chats) — no settings/custom models/API keys. File format is a custom `.lumabackup` container: 4-byte magic (`LMBK`) + 1-byte version + gzip-compressed compact JSON (via `flate2`, already pulled in transitively by `reqwest`). `encode_backup`/`decode_backup` are pure functions (no `State`) for unit testing without a Tauri context. `import_all` preserves the backup's original `created_at`/`updated_at` (unlike `save_session`, which stamps "now") and upserts by id — it's a restore/merge, not additive-only. Project roots are part of that merge: a session already attached on this machine keeps its own (real, existing) folders, and one with no attachment adopts the backup's — which is the cross-machine case, where those paths usually don't exist and get marked missing in the UI instead of failing the import.

Frontend uses `@tauri-apps/plugin-dialog`'s `save()`/`open()` for the native picker, then passes the path to the Tauri commands which do the file I/O via `std::fs`.
