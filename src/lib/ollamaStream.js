// Pure collaborators extracted from `streamChat` in `ollama.js`.
//
// Each function here owns ONE responsibility of the streaming tool-calling
// loop and is independently testable. `streamChat` remains the thin
// coordinator (Controller stereotype) that wires these together with the
// Tauri event listeners and the round loop.

// -----------------------------------------------------------------------------
// JSON helpers
// -----------------------------------------------------------------------------

export function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

// -----------------------------------------------------------------------------
// Tool-call normalization
// -----------------------------------------------------------------------------

// Map a raw Ollama `tool_calls` array into the normalized shape we keep in
// state: { function: { name, arguments: object } }. String arguments are
// parsed as JSON (Ollama sends them as a JSON string), with a {} fallback.
// When a string fails to parse, `parseError` is set with the JSON.parse error
// message so `runToolCalls` can feed it back to the model instead of silently
// running the tool with empty args.
export function normalizeToolCalls(toolCalls) {
  return toolCalls.map((tc) => {
    const raw = tc.function?.arguments;
    let args = {};
    let parseError;
    if (typeof raw === "string") {
      try {
        args = JSON.parse(raw);
      } catch (e) {
        parseError = e?.message || String(e);
      }
    } else if (raw && typeof raw === "object") {
      args = raw;
    }
    const entry = { function: { name: tc.function?.name, arguments: args } };
    if (parseError) entry.parseError = parseError;
    return entry;
  });
}

// -----------------------------------------------------------------------------
// Stream-line parsing
// -----------------------------------------------------------------------------

// Apply one streamed JSON line to the per-round `state`, mutating its
// `content`, `thinking`, and `toolCalls` fields and firing the callbacks.
//
// `state` only needs those three fields here; the orchestrator also keeps
// requestId/finalContent/error/resolve on the same object but those are
// managed by the done/error listeners, not here.
//
// Only a NON-EMPTY `tool_calls` array overwrites `state.toolCalls` — some
// models/Ollama emit a trailing chunk with `tool_calls: []`, which would
// otherwise wipe calls captured earlier in the round and end it with zero
// tool calls so the loop finalizes early (and the tool never runs).
export function applyStreamLine(line, state, { onToken, onThinking, signal }) {
  const text = line?.message?.content;
  if (typeof text === "string" && text.length > 0) {
    state.content += text;
    if (!signal?.aborted) onToken?.(text, state.content);
  }

  const thinking = line?.message?.thinking;
  if (typeof thinking === "string" && thinking.length > 0) {
    state.thinking += thinking;
    if (!signal?.aborted) onThinking?.(thinking, state.thinking);
  }

  if (
    Array.isArray(line?.message?.tool_calls) &&
    line.message.tool_calls.length > 0
  ) {
    state.toolCalls = normalizeToolCalls(line.message.tool_calls);
  }
}

// -----------------------------------------------------------------------------
// Round-limit policy
// -----------------------------------------------------------------------------

const FORCE_FINAL_MSG =
  "You have reached the tool-use limit and can no longer call tools. Write your final answer now using only the information gathered from the tool results above. Do not claim you lack access to real-time or live data — base your answer on what was already retrieved.";

const WRAP_UP_MSG =
  "You have done extensive research. Write your final answer now based on everything gathered above. You may make one more tool call if truly necessary, but aim to conclude.";

const WEB_SEARCH_NUDGE_MSG =
  "You have made many web searches. The search provider (DuckDuckGo) rate-limits heavy use, so stop searching now and write your final answer from what you have already gathered. Do not call web_search or web_fetch again.";

// Returns the system messages to inject before the round-`round` call,
// given the configured limits. May return more than one (e.g. wrap-up +
// nudge are mutually exclusive in practice, but force-final + nudge are
// not — except force-final suppresses the nudge, mirroring the original).
//
// `hardCap` is null for unlimited; otherwise once `round >= hardCap` the
// force-final message is emitted (and tools are stripped for that round
// by the orchestrator).
export function systemMessagesForRound(round, { hardCap, maxToolRounds, webSearchNudgeAt }) {
  const forceFinal = hardCap !== null && round >= hardCap;
  const msgs = [];
  if (forceFinal) {
    msgs.push({ role: "system", content: FORCE_FINAL_MSG });
  } else if (round === maxToolRounds) {
    msgs.push({ role: "system", content: WRAP_UP_MSG });
  }
  if (!forceFinal && round === webSearchNudgeAt) {
    msgs.push({ role: "system", content: WEB_SEARCH_NUDGE_MSG });
  }
  return msgs;
}

// -----------------------------------------------------------------------------
// Request body construction
// -----------------------------------------------------------------------------

// Build the Ollama `/api/chat` request body for one round. `includeTools`
// is false on the forced-final round (and when no tools are configured).
export function buildRequestBody(model, messages, { tools, think, includeTools }) {
  const body = {
    model,
    messages,
    stream: true,
    options: { temperature: 0.7, num_ctx: 8192 },
  };
  if (includeTools && tools && tools.length > 0) body.tools = tools;
  if (think !== undefined) body.think = think;
  return body;
}

// -----------------------------------------------------------------------------
// Content post-processing
// -----------------------------------------------------------------------------

const LEAKED_TOOL_CALL_RE = buildLeakedToolCallRegex();

// Some models echo their tool calls back as inline XML in the text content.
// Strip those blocks so they never reach the rendered answer.
function buildLeakedToolCallRegex() {
  const open = String.fromCharCode(60) + "tool_call" + String.fromCharCode(62);
  const close =
    String.fromCharCode(60) + "/tool_call" + String.fromCharCode(62);
  return new RegExp(
    open.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
      "[\\s\\S]*?" +
      close.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    "g",
  );
}

export function stripLeakedToolCallXml(content) {
  return content.replace(LEAKED_TOOL_CALL_RE, "").trim();
}

// -----------------------------------------------------------------------------
// Tool-call execution
// -----------------------------------------------------------------------------

const NO_EXECUTOR_MSG = "Error: no tool executor registered";

// Execute a batch of tool calls, appending each result to `workingMessages`
// as a `role: "tool"` message and firing the onToolCall/onToolResult
// callbacks. Returns `{ allFailed, quotaError }` so the orchestrator can
// decide whether to short-circuit.
//
// - `allFailed`: every result was an `Error: …` string (or the executor
//   threw / was missing). The orchestrator uses this to force a wrap-up.
// - `quotaError`: some result was an `Error: QUOTA: …` string. The
//   orchestrator stops the whole stream — quota/auth failures won't recover
//   on retry, so re-prompting for a final answer would just fail again.
export async function runToolCalls(toolCalls, executeTool, workingMessages, { onToolCall, onToolResult }) {
  let allFailed = true;
  let quotaError = false;

  for (const call of toolCalls) {
    const name = call.function.name;
    const args = call.function.arguments || {};
    onToolCall?.(name, args);

    let result;
    if (call.parseError) {
      // The model emitted malformed JSON arguments. Tell it so, instead of
      // silently running the tool with empty args (which yields a confusing
      // "empty query" result the model can't recover from).
      result = `Error: could not parse arguments for ${name} (${call.parseError}). Please retry the tool call with valid JSON arguments.`;
    } else {
      try {
        result = executeTool
          ? await executeTool(name, args)
          : NO_EXECUTOR_MSG;
      } catch (err) {
        result = `Error executing ${name}: ${err.message || err}`;
      }
    }

    if (typeof result !== "string" || !result.startsWith("Error")) {
      allFailed = false;
    }
    if (typeof result === "string" && result.startsWith("Error: QUOTA:")) {
      quotaError = true;
    }

    onToolResult?.(name, result);
    workingMessages.push({
      role: "tool",
      content: typeof result === "string" ? result : JSON.stringify(result),
    });
  }

  return { allFailed, quotaError };
}
