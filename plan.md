# Luma — Codebase Mode Plan

A working plan (not a permanent doc), grounded in the current codebase.
Delete or archive this file once the work is done.

Guiding principles (from `CLAUDE.md`): surgical changes, simplicity first,
verifiable goals.

---

## What this is

Two modes in one app, the way Chat vs Agent works in Zed/VS Code:

- **chat** (default) — today's behaviour, unchanged.
- **codebase** — a project root is attached; read-only file tools are exposed.

The only new user-facing idea is that you can point Luma at a codebase, ask
questions, and open side chats to drill into the answers — exactly the
existing side-chat pattern, now with a project attached.

---

## Gate: resolve the ROADMAP thesis conflict FIRST

This is a deliberate scope reversal and must be settled in the docs, not
silently overridden.

- `ROADMAP.md` L15-16 states Luma is **"not a coding agent"**.
- `ROADMAP.md` L82-83 lists "Filesystem MCP server" and "Shell execution (too
  dangerous, not research)" as deliberate cuts.

Proposed resolution:

> **Codebase is read-only.** No writes, no shell, no code execution, no task
> completion. That keeps "not a coding agent" literally true, and makes the
> capability research ("understand this codebase") rather than agentic work.

Note the cut was specifically a *Filesystem MCP server* with broad access,
rationalised as "user can drag files in if needed". Root-bounded read tools in
the existing Tauri tool layer are a different, narrower thing.

Precedent for revisiting exists — `ROADMAP.md` L114-115 already records a
decision "in case we change our minds".

**Docs to update when this lands:** `ROADMAP.md` (amend L15-16 + L82),
`README.md` (Features, Architecture, Stack), `CLAUDE.md` (mode concept, new
tools, project root, migration).

---

## Already in place — reuse, don't rebuild

- Side-chat tree, nesting, `parentSideChatId`, path labels,
  `buildSideChatTree` — shipped.
- Tool loop, parallel tool calls, budgets (`toolCallLimit`, `maxSearches`,
  `TOOL_CONCURRENCY`), `ToolActivity` live indicators — shipped.
- `@tauri-apps/plugin-dialog` — already a dependency (backup/restore uses it),
  so the folder picker needs no new package.
- The "filter the tool list before handing it to the model" pattern already
  exists in `useStreamingChat` for the web-search toggle. Codebase reuses it.

---

## Prerequisite: `num_ctx`

`temperature: 0.7` and `num_ctx: 8192` are hardcoded in
`src/lib/ollamaStream.js` `buildRequestBody`. 8192 is too small to read real
source files, so codebase will read truncated code unless this is raised first.

Expose both in Settings (`settingsStore.js` `SETTING_KEYS` + `DEFAULTS`,
`SettingsPage.jsx`), read via passed options rather than at module init.
`temperature`: 0.0–2.0, default 0.7. `num_ctx`: 2048–131072, default 8192.

---

## Design

**Mode is a capability switch, not a separate UI surface.** Same panes, same
side-chat tree, same streaming. Codebase adds a project selector and file-tool
activity — nothing else.

Mode is **derived**: `project_roots IS NOT NULL` means codebase mode. So there's no
`mode` column. The only persisted piece is the *default* preference for new
sessions, which is a plain `settings` KV entry (`SETTING_KEYS`, no migration).
Stored mode values, if ever needed explicitly, are the strings `"chat"` and
`"codebase"`.

- Per-pane `mode` state seeded from a global default, following the existing
  web-search toggle pattern in `ChatPane` (local `useState`, `*TouchedRef`
  cleared on `chatNonce`, gates on settings `hydrated`).
- Side chats **inherit the parent's mode** — they already resolve parent
  context, so this falls out.

**Project roots:** `sessions.project_roots` (nullable TEXT holding a JSON array)
via an appended `MIGRATIONS` step in `db.rs`. The first entry is the **primary**
root; the rest are additional. Set with `open({ directory: true })` from the
dialog plugin (multi-select where the platform allows).

Passed to the Rust tools as `roots` from renderer session state — **never from
the model.**

### Multiple roots

Modelled as primary + additional, matching ACP's stable `cwd` +
`additionalDirectories` (and VS Code multi-root workspaces). That shape is
settled, and it maps 1:1 if Luma is ever exposed over ACP.

- **Relative paths resolve against the primary root only.** Additional roots are
  addressable but must be named — a flat relative namespace where `src/index.ts`
  could match either root is ambiguous and the model will pick unpredictably.
- Each additional root gets a short **alias** from its basename (deduped), and
  tools take an optional `root` argument defaulting to primary:
  `read_file({ path: "src/index.ts", root: "shared-lib" })`. Aliases are surfaced
  in the tool descriptions, so no extra string parsing.
- `search_code` may span all roots; `read_file` / `list_dir` are per-root.
- **Ship a single-root UI in v1.** The add-folder affordance comes later with no
  migration, because the storage shape already holds a list.

**Guard implications (the part that changes):**

- The check becomes **set membership** — reject unless the canonical path is
  under *any* root.
- Use Rust's `Path::starts_with`, which compares **whole path components**. A
  naive string prefix on `to_string_lossy()` looks equivalent but wrongly admits
  `/home/user/project-evil` when the root is `/home/user/project`. The
  component-wise primitive is safe; the string version is the trap.
- **Reject roots nested inside other roots** — double-covered files and
  duplicated search hits.

### Scoping: default broad, narrow per call

**No conversation-level scoping.** Do not scope a side chat to a subpath. A
question asked while looking at `src/lib/fs.rs` frequently resolves elsewhere —
the trait it implements in a parent module, the caller in a sibling directory,
a code path in a sibling root. Narrowing the whole conversation would make the
model miss exactly the thing it needs.

Every harness agrees: Claude Code has no per-conversation path scoping (narrowing
is a per-call `path` argument the model chooses); Gemini CLI searches *all*
workspace directories when no `dir_path` is given; Codex uses a cwd plus relative
paths. Default broad, narrow per call.

So the narrowing mechanism is the tools' optional `path` argument — not a stored
per-chat scope, and not a column.

**The root set is the boundary, and nothing escapes it.** Dropping conversation
*scoping* is not dropping the *guard*: tools refuse anything outside the attached
roots, always. The model cannot widen its own access — the only way a directory
becomes readable is the user attaching it explicitly as a root, and there is no
tool that does this. Following `..` would turn "read the parent module" into
"read `~/.ssh`", and with `web_fetch` in the same context that is an
exfiltration path.

**The path is storage; the label is display.** Never surface the absolute path
as a title or project name — it's unreadable, machine-specific, and leaks the
username into screenshots (the README ships screenshots). Show the folder's
**basename** (`luma-chat`). Disambiguate with the parent directory only when two
attached projects share a basename (`work/api` vs `personal/api`); the full path
lives in a tooltip/settings and nowhere else. No label column — derive it at
render. Rename support arrives with a future `projects` table.

Session titles stay **independent** — attaching a project does not rename the
session.

*Cheaper alternative:* one global `codebaseProjectRoot` setting, no migration.
Rejected: Luma's unit is a session/research topic, and "add a project" implies
per-session.

---

## Persistence — one column, no new tables

`sessions.project_roots` (nullable TEXT holding a JSON array) is the entire DB
delta: an appended `MIGRATIONS` step wrapped in `.ok()`. Never edit or reorder
existing steps. Add the column to the assertions in
`test_migrations_apply_once_and_track_version`.

A JSON array rather than a normalized roots table: roots are never queried *by
path*, order is meaningful (primary first), and this codebase already JSON-encodes
arrays into columns (`images`, `tool_calls` in message rows). A table only pays for
itself for the deferred `projects`/recents feature.

**Do not split into a separate DB.** `sessions → messages` and
`sessions → side_chats → side_chat_messages` are `ON DELETE CASCADE` foreign
keys, and FKs don't span database files — `delete_session` would stop cascading
and orphan rows. Two connections also mean no single transaction for
`sync_messages`, and a second export/import path for `.lumabackup` (plus a
container version bump).

Separate tables aren't warranted either: a codebase session has the same shape
as any session plus one attribute. `NULL` means a chat session.

Because `export_all` serializes the `Session` struct, `project_roots` rides along
in `.lumabackup` automatically — no format change.

**Restore across machines:** paths won't exist elsewhere. Keep them and mark the
missing ones **per root** — the remaining roots stay usable. Never fail the
import, and don't fail a whole project because one sibling repo is absent.

**Tool results are stored in message rows.** File contents the model reads land
in `messages.tool_calls` JSON, so the byte caps chosen for `fs.rs` bound `luma.db`
growth too, not just context — codebase mode reads far more, far more often than
`web_fetch` ever did.

**Not yet:** a rebuildable code index (symbols/embeddings) would justify its own
table — bulk, derivable, disposable, keyed by `(project, path, mtime)` — but in
the same DB, and indexing is out of scope.

**Upgrade path:** a `projects` table (+ a roots table) and `sessions.project_id`,
backfilled by exploding the existing JSON arrays, if a recents list or multiple
sessions per codebase is ever wanted. Append-only migration, so starting with one
column isn't a dead end.

---

## Tools — read-only, frugal (`tauri/src/tools/fs.rs`)

1. `read_file(path, start_line?, end_line?)` — window + `truncated` flag +
   total line count. Bounded in Rust.
2. `search_code(query, path?, glob?, output?)` — `output` is `content`
   (default) | `files` | `count`. `path` narrows the search to a subdirectory;
   `glob` filters by file pattern. Use the `ignore` + `grep` crates (ripgrep's
   libraries) — don't hand-roll a walker, don't shell out to `rg`.
3. `list_dir(path)` — shallow listing.

**Search output modes.** `content` returns `path:line: match`; `files` returns
paths only; `count` returns a per-file tally (e.g. `47 matches in 12 files`, top
files listed). `files` and `count` are the triage modes for broad scans — and
they capture a terminal's aggregation win without a shell.

`content` stays the default because it answers a focused question in one call,
and **a round-trip isn't free** — every tool call re-sends the whole pane
transcript, so forcing a locate-then-read pair can cost more than one slightly
larger result. That is only safe because of the caps below.

**Result caps:** per-file (~20) plus total (~100). The per-file cap is the
important one — without it one generated file with thousands of matches eats the
whole budget. It is also why Claude Code defaults to `files`; with the cap,
`content` is safe to default to.

**Not in v1:** `write_file`, `edit_file`, `run_command`, diffs, indexing, LSP.
Those are exactly what would make it a coding agent.

---

## Path safety — the part not to be lazy about

Model supplies a **relative** path only. Rust joins to `root`,
**canonicalizes**, *then* checks the prefix — canonicalize before the check or
symlinks walk straight out. Reject absolute paths and `..` as a first line,
with the canonical prefix check as the real guard.

Cap all outputs (bytes/lines) so a large file never crosses IPC into the
prompt — same spirit as `MAX_HTML_BYTES`.

Injection matters here specifically because `web_fetch` already pulls
untrusted web content into the model's context, which can instruct it to read
outside the project.

---

## Wiring

| File | Change |
|---|---|
| `tauri/src/tools/fs.rs` | new module — the three tools + root-bounding helper |
| `tauri/src/tools/mod.rs` | `mod fs;` + `pub use` |
| `tauri/src/commands.rs` | three thin `#[tauri::command]` wrappers delegating to `tools::*` |
| `tauri/src/lib.rs` | register in `generate_handler![]` |
| `tauri/src/db.rs` | append migration; read/write `project_roots` (`save_session` grows a field) |
| `src/lib/tools.js` | schemas in `TOOLS`; `executeTool` cases invoking Tauri (mirror `web_search`) |
| `src/hooks/useStreamingChat.js` | withhold file tools unless mode is codebase **and** a project is set |
| `src/components/ChatPane.jsx` | mode toggle + root selector in the header (add-folder later) |
| `src/store/settingsStore.js` | default-mode setting |

---

## Acceptance

1. `cargo test` — a `../` path and a symlink pointing outside the roots are
   rejected; with multiple roots, a path under a secondary root resolves while a
   path under none is rejected.
2. Chat mode: the tool list sent to the model contains no file tools (assert
   in `ollamaStream.test.js`).
3. Codebase + project: `read_file` respects the line range and flags truncation;
   `list_dir` / `search_code` return bounded results.
4. Codebase with **no** project: file tools withheld, not erroring.
5. Root-set hygiene: a root nested inside another is dropped, and the guard uses
   component-wise `Path::starts_with` so `/root-evil` does not pass a `/root`
   check.
6. Manual: drill into a repo, open a side chat from an answer, confirm the side
   chat is also codebase and the main thread is undisturbed.

---

## Out of scope (deliberate cuts — don't relitigate)

Shell execution, code execution sandbox, write/edit tools, multi-agent
orchestration, MCP servers, database tools, voice I/O, image generation beyond
vision input, LSP.

**No terminal.** A shell is the one thing that breaks the root-set boundary by
definition (`cat ~/.ssh/id_rsa`, `curl`), and with `web_fetch` putting untrusted
text in the same context it turns prompt injection into exfiltration. Its real
token win is aggregation, which `search_code`'s `files`/`count` modes capture
instead. If history questions ever prove essential, revisit a narrow **read-only
git tool** (`log`/`blame`/`show`, fixed argv, output cap, timeout) — not a
general shell.

**Read-only filesystem tools are no longer deferred** — in scope as Codebase
mode, because reading a codebase to understand it is research. The test for
any future proposal still holds: *does this help a user research and deeply
understand a topic?* If no, it doesn't ship.

---

## Open questions

- Add a `maxFileBytes` budget mirroring `maxSearches` (bounding total file
  bytes per response)? Probably yes — it slots into the same `limits` object.
