---
name: add-persisted-setting
description: Add a new persisted setting backed by SQLite. Use when adding a setting, a settings-page option, or a new SETTING_KEYS entry.
---

- **Add a new persisted setting** — add to `SETTING_KEYS` in `settingsStore.js`; write-through to SQLite is automatic. Schema changes: append a `MIGRATIONS` step in `db.rs` (never edit/reorder existing ones).
