# Agent log

The JSONL record is how the loop gets tuned from evidence. Rust only appends; the frontend owns the event shapes.

`src/lib/agentLog.js` writes a structured **JSONL** record of what the agent loop did — opt-in via the `agentLogEnabled` setting (Settings → Agent log), a no-op object when off. The log is the only way to tune the loop from evidence: it captures the harness's *decisions* (the prompt, the tools offered, which policy message fired on which round, the resolved limits) alongside the model's behaviour (per-round content/thinking sizes and latency, every tool call with args, verdict, timing and result size, budget counters) and the reason each run ended.

- **Rust only appends.** `append_agent_log(lines)` / `agent_log_path()` / `clear_agent_log()` in `commands.rs` are dumb: the frontend hands over already-serialized lines, so a new event type needs no backend change. Written to `<app_data_dir>/logs/agent.jsonl`, rotated to `agent.1.jsonl` past 5 MB.
- **Events** (`t`): `limits`, `stream.start`, `round.start` (with `injected`, naming the policy message via `messageKind`), `round.reply` (with `doneReason` — Ollama's `stop` vs `length`, the only way to tell a truncated answer from a short one — and `includeTools`, which is what distinguishes "the model chose no tools" from "tools were stripped for the forced-final round"), `tool`, `round.end`, `stream.end` (always written, from the loop's `finally`, with `reason`: `final` / `quota` / `abort` / `error`), `stream.error`, `subtopics`.
- **Every line carries a `runId`**, minted per logger and therefore per run, because `round` restarts at 0 each run — grouping or diffing runs is otherwise positional. `done_reason` rides on the same stream line as Ollama's final chunk, so it arrives without a backend change.
- **Flushes per round**, not per event, and swallows its own write errors — logging must never fail a chat turn.
- **Results are summarised, never copied**: `chars` + head 400 + tail 200. The tail is deliberate — `read_file` puts its "continue with offset=N" notice at the *end*. Roots are logged by basename, not absolute path, since the file may be shared.
- `classifyToolResult` (ollamaStream.js) is exported so the log reports the same verdict the loop acted on.
