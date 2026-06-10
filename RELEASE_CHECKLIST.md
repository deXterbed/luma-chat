# RELEASE CHECKLIST

Pre-flight checks before shipping a public build of Luma. Work through these
top-to-bottom — each item has a short rationale so the next maintainer
understands why it matters.

## 1. CONFIGURE TAURI DEVTOOLS

**Status:** `devtools: true` is currently hardcoded in
`tauri/tauri.conf.json` and the `devtools` feature is enabled on the
`tauri` crate in `tauri/Cargo.toml`. This is needed right now to debug
release-only issues (CORS, prod-only bugs), but it ships to end users as-is
and exposes the WebView inspector to anyone with a keyboard shortcut.

**Action:** pick one of the two patterns below and apply it before tagging
a public release.

### Option A — Two configs (recommended)
Keep `tauri/tauri.conf.json` as the **release** (devtools OFF) config and
add `tauri/tauri.conf.debug.json` (devtools ON) for local debugging.

In `tauri.conf.json`:
- Set `"devtools": false` (or remove the key — false is the default)
- `tauri/Cargo.toml`: revert `tauri = { version = "2", features = ["devtools"] }`
  back to `tauri = { version = "2", features = [] }`

In `tauri.conf.debug.json` (new file, identical except):
- `"devtools": true`
- `tauri/Cargo.toml` debug build: `tauri = { version = "2", features = ["devtools"] }`

Build the debug variant with:
```bash
cargo tauri build --config tauri/tauri.conf.debug.json
```

### Option B — Build-time env var
Toggle via `TAURI_DEBUG` at compile time. In `tauri.conf.json`:
```json
"devtools": process.env.TAURI_DEBUG === "1"
```
…and in `tauri/src/main.rs` (or `lib.rs`) gate the `devtools` Cargo feature
behind the same env var so the Rust side matches the JS config.

Release build:
```bash
npm run build
```
Debug build (devtools on):
```bash
TAURI_DEBUG=1 npm run build
```

## 2. VERIFY CORS / OLLAMA PROXY

The frontend must NOT call `http://localhost:11434` directly — production
runs at the `http://tauri.localhost` origin and Ollama returns no CORS
headers. Confirm all Ollama traffic goes through the Rust proxy:
- `isOllamaReachable()` → `invoke("ollama_reachable")`
- `listLocalModels()` → `invoke("ollama_list_models")`
- `streamChat()` → `invoke("ollama_chat_stream")` + `listen()` on
  `ollama://chunk`, `ollama://done`, `ollama://error`

A `grep -R "localhost:11434" src/` should return **zero** hits in any
runtime path (a comment is fine, a `fetch()` is not).

## 3. SMOKE TEST THE RELEASE BINARY

Run `tauri\target\release\luma.exe` from a normal (non-elevated) shell.
Verify in order:
- Window opens, frameless title bar renders, sidebar is populated from
  SQLite.
- Ollama status dot turns green; local model list appears in the picker.
- Send a message; tokens stream in; tool-calling round-trip works.
- Side chat creates a new model thread and persists across app restart.
- Quit and relaunch — sessions, side chats, and custom models survive.

## 4. CHECK BUILD ARTIFACTS

`npm run build` should produce:
- `tauri\target\release\luma.exe` — standalone executable
- `tauri\target\release\bundle\msi\*.msi` — Windows installer
- `tauri\target\release\bundle\nsis\*-setup.exe` — NSIS installer (if
  enabled)

Confirm file sizes look sane (an unexpectedly tiny `.exe` means the bundle
step silently skipped something). Smoke-test the installer on a clean
Windows VM that does not have Rust or Node installed.

## 5. VERSION BUMP

- `tauri/tauri.conf.json` → bump `version` (semver: MAJOR for breaking,
  MINOR for features, PATCH for fixes).
- Tag the release in git: `git tag vX.Y.Z`.
- The MSI/NSIS bundle names pick this up automatically.

## 6. PRE-RELEASE HOUSEKEEPING

- [ ] No leftover `console.log` debug noise in `src/lib/`.
- [ ] No `unwrap()` in production-critical Rust paths (`commands.rs`,
  `db.rs`).
- [ ] SQLite migrations in `tauri/src/db.rs` use `ALTER TABLE … ADD COLUMN
  … .ok()` so existing user databases don't break on upgrade.
- [ ] `tauri.conf.json` has `"active": true` and `"targets": "all"` only
  for the platforms you actually build on.
- [ ] Icon set in `tauri/icons/` includes a real 1024×1024 source PNG
  (regenerate with `cargo tauri icon path/to/source.png` if needed).

## 7. POST-RELEASE

- [ ] Test the installed app end-to-end on a clean Windows 10 + 11 VM.
- [ ] Verify WebView2 runtime is bundled or the installer prompts to
  install it.
- [ ] File size + startup time within budget.
- [ ] Roll back: keep the previous MSI handy in case a regression ships.
