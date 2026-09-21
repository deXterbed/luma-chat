// Structured, opt-in record of what the agent loop actually did — the decisions
// it was handed, the tool calls it made, and where it failed — so the harness
// can be tuned from evidence instead of guesses.
//
// Format is JSONL (one object per line, `t` naming the event) so a session can
// be read with `jq`, diffed against another run, and grepped for a failure
// pattern. The schema is owned here: Rust only appends the lines it is handed,
// so a new event type never needs a backend change or a migration.
//
// Deliberate choices:
//   - **Off unless the user turns it on** (Settings → Agent log). Disabled means
//     this returns a no-op object: no buffer, no IPC, no console noise.
//   - **Batched at round boundaries.** A durable log without an IPC round-trip
//     per event, and a loop that runs long still leaves a usable tail.
//   - **Never breaks a chat.** Every flush swallows its own errors — a logging
//     failure must not surface as a failed turn.
//   - **Tool results are summarised, never copied in full**: length plus head and
//     tail. The tail matters because `read_file` puts its "continue with
//     offset=N" notice at the *end* — but duplicating whole source files into a
//     log is not worth the disk.

import { db } from "./db";

/** Flush after this many buffered lines even if the round hasn't ended. */
export const AGENT_LOG_FLUSH_AT = 40;

// Identifies one run's lines. `round` restarts at 0 every run and `stream.start`
// is just another line, so without this, attributing an event to a run means
// counting `stream.start` lines positionally — which turns "diff this run
// against that one" into an argument about ordering instead of a `jq group_by`.
// A logger instance is created per run (one per user turn), so the id lives on
// the logger rather than being threaded through every `event()` call.
let _runCounter = 0;
function nextRunId() {
  _runCounter += 1;
  return `run-${Date.now()}-${_runCounter}`;
}

// Events that end a phase of the run. Flushing on these is what stops a
// post-run event from being stranded in the buffer: `subtopics` fires after
// `stream.end`, so nothing else would ever flush it — and when a later run
// finally does, the event lands appended to *that* run's lines, out of order.
const FLUSH_NOW = new Set(["stream.end", "subtopics"]);
const RESULT_HEAD = 400;
const RESULT_TAIL = 200;
const TEXT_HEAD = 300;

const NOOP_LOGGER = {
  enabled: false,
  event() {},
  flush: () => Promise.resolve(),
};

/**
 * Trim text to a head, plus a tail when it is long enough for the tail to carry
 * information (truncation notices, trailing errors).
 */
export function summarize(text, head = TEXT_HEAD, tail = 0) {
  const s = typeof text === "string" ? text : text == null ? "" : String(text);
  if (tail > 0 && s.length > head + tail) {
    return {
      chars: s.length,
      head: s.slice(0, head),
      tail: s.slice(-tail),
    };
  }
  return { chars: s.length, head: s.slice(0, head) };
}

/** Tool results: longer budget than prose, and a tail worth keeping. */
export function summarizeToolResult(result) {
  return summarize(result, RESULT_HEAD, RESULT_TAIL);
}

/**
 * @param {object} options
 * @param {boolean} options.enabled - from settings; false gives the no-op logger
 * @param {function} [options.flush] - (lines: string[]) => Promise; defaults to
 *   the Tauri command. Injected in tests.
 * @param {function} [options.now]
 * @param {boolean} [options.echo] - mirror events to the devtools console
 *   (`npm run dev`), which is handy while actively tuning.
 */
export function createAgentLogger({
  enabled = false,
  flush,
  now = Date.now,
  echo = true,
} = {}) {
  if (!enabled) return NOOP_LOGGER;

  const runId = nextRunId();
  let buffer = [];
  // Serialize writes so two flushes can't interleave their lines.
  let chain = Promise.resolve();
  const send = flush ?? ((lines) => db.appendAgentLog(lines));

  const write = () => {
    if (buffer.length === 0) return chain;
    const lines = buffer;
    buffer = [];
    chain = chain
      .then(() => send(lines))
      .catch(() => {})
      .then(() => {
        // Logging is best-effort: a failure here is dropped rather than
        // propagated into the chat path.
      });
    return chain;
  };

  return {
    enabled: true,
    event(type, data = {}) {
      let line;
      try {
        line = JSON.stringify({ ts: now(), t: type, runId, ...data });
      } catch {
        // A non-serializable value in `data` (a Map, a circular ref) must not
        // take the stream down with it.
        return;
      }
      buffer.push(line);
      if (echo) {
        try {
          console.debug(`[agent] ${type}`, data);
        } catch {
          /* console may be unavailable in some embedded contexts */
        }
      }
      if (buffer.length >= AGENT_LOG_FLUSH_AT || FLUSH_NOW.has(type)) write();
    },
    flush: write,
  };
}

/** Total characters of a message array — the context-size proxy per round. */
export function contextChars(messages) {
  let total = 0;
  for (const m of messages || []) {
    if (typeof m?.content === "string") total += m.content.length;
    if (Array.isArray(m?.tool_calls)) {
      for (const call of m.tool_calls) {
        total += JSON.stringify(call?.function?.arguments ?? {}).length;
      }
    }
  }
  return total;
}
