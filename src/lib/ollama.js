// Ollama API wrapper. In production builds the WebView2 origin is
// `http://tauri.localhost`, which the browser treats as a separate origin
// from `http://localhost:11434` and enforces CORS on. Ollama does not return
// CORS headers, so all calls are proxied through Rust Tauri commands instead.
//
// Cloud models (e.g. `minimax-m3:cloud`) route via Ollama Pro subscription;
// they're just model tags as far as the proxy is concerned.

import { listen } from "@tauri-apps/api/event";
import { useSettingsStore } from "../store/settingsStore";

let _invoke;
async function getInvoke() {
  if (!_invoke) {
    const tauri = await import("@tauri-apps/api/core");
    _invoke = tauri.invoke;
  }
  return _invoke;
}
import {
  applyStreamLine,
  buildRequestBody,
  runToolCalls,
  stripLeakedToolCallXml,
  systemMessagesForRound,
} from "./ollamaStream";

/**
 * Check if the Ollama server is reachable.
 * Returns true if /api/version responds 2xx, false on any error.
 */
export async function isOllamaReachable() {
  try {
    const invoke = await getInvoke();
    const { ollamaUrl, ollamaApiKey } = useSettingsStore.getState();
    return await invoke("ollama_reachable", {
      ollamaUrl: ollamaUrl || null,
      apiKey: ollamaApiKey || null,
    });
  } catch {
    return false;
  }
}

/**
 * List model names currently pulled into the local Ollama instance.
 * Returns an empty array on any error (Ollama may be offline or simply
 * have no models pulled).
 */
export async function listLocalModels() {
  try {
    const invoke = await getInvoke();
    const { ollamaUrl, ollamaApiKey } = useSettingsStore.getState();
    const names = await invoke("ollama_list_models", {
      ollamaUrl: ollamaUrl || null,
      apiKey: ollamaApiKey || null,
    });
    return Array.isArray(names) ? names : [];
  } catch {
    return [];
  }
}

// Convert File to base64 for vision models
export async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Check if model supports vision
export function isVisionModel(modelName) {
  const visionModels = [
    "minimax",
    "qwen2.5vl",
    "qwen2-vl",
    "llava",
    "llava-phi3",
    "moondream",
    "bakllava",
    "minicpm-v",
    "cogvlm",
    "internvl",
    "gemma3",
    "phi3.5-vision",
    "pixtral",
  ];
  const lower = modelName.toLowerCase();
  return visionModels.some((v) => lower.includes(v));
}

// =============================================================================
// Tool-calling streaming chat
// =============================================================================
//
// `streamChat` is the coordinator (Controller stereotype) for the tool-calling
// loop. The per-responsibility collaborators live in `ollamaStream.js`:
//   - applyStreamLine        parses one streamed JSON line
//   - systemMessagesForRound  decides which system messages to inject per round
//   - buildRequestBody         builds the Ollama request body for a round
//   - stripLeakedToolCallXml   cleans leaked tool-call XML from final content
//   - runToolCalls            executes a batch of tool calls
//
// Callbacks:
//   onToken(chunk, full)    — text chunk in any round (model narration + answer)
//   onThinking(chunk, full) — reasoning chunk (think: true); `full` spans rounds
//   onToolCall(name, args)  — model invoked a tool
//   onToolResult(name, res) — a tool returned
//   onDone(full)            — whole loop completed with the final answer text
//   signal                  — AbortSignal to cancel mid-flight
// =============================================================================

let _requestCounter = 0;
function nextRequestId() {
  _requestCounter += 1;
  return `ollama-${Date.now()}-${_requestCounter}`;
}

const WEB_SEARCH_NUDGE_AT = 15;

// ponytail: hard ceiling on total web_search + web_fetch calls across a whole
// stream. Bounds the cost of the model repeatedly deciding "not enough, search
// again"; 0 = unlimited. Overshoots by at most one round's batch (≤3 calls)
// since it's checked after each round, not per call. Surface as a setting later.
const DEFAULT_MAX_SEARCHES = 15;
const WEB_TOOL_NAMES = new Set(["web_search", "web_fetch"]);

const ALL_FAILED_MSG =
  "All tool calls in the last round failed. Write your final answer now based on everything gathered so far.";

/**
 * Run a chat completion with optional tool-calling support.
 *
 * @param {object} params
 * @param {string} params.model
 * @param {Array}  params.messages            - initial messages array
 * @param {Array}  [params.tools]            - Ollama-format tool definitions
 * @param {function} [params.executeTool]    - (name, args) => Promise<string>
 * @param {function} [params.onToken]
 * @param {function} [params.onThinking]
 * @param {function} [params.onToolCall]
 * @param {function} [params.onToolResult]
 * @param {function} [params.onDone]
 * @param {number}  [params.maxToolRounds=10]
 * @param {number}  [params.toolCallLimit=0]   - max tool rounds before a forced tools-disabled final answer; 0 = unlimited
 * @param {number}  [params.maxSearches=15]    - max web_search + web_fetch calls across the whole stream before a forced final answer; 0 = unlimited
 * @param {AbortSignal} [params.signal]
 */
export async function streamChat({
  model,
  messages,
  tools,
  executeTool,
  onToken,
  onThinking,
  onToolCall,
  onToolResult,
  onDone,
  maxToolRounds = 10,
  toolCallLimit = 0,
  maxSearches = DEFAULT_MAX_SEARCHES,
  signal,
  think,
}) {
  const workingMessages = [...messages];
  let round = 0;
  // 0 = unlimited. Otherwise, once the model has used this many tool rounds
  // without finishing, we make one last tools-disabled call to force an answer.
  const hardCap = toolCallLimit > 0 ? toolCallLimit : null;
  const limits = {
    hardCap,
    maxToolRounds,
    webSearchNudgeAt: WEB_SEARCH_NUDGE_AT,
    // Set to true once `searchCount` reaches `maxSearches`; the next round
    // becomes a tools-disabled force-final (same path as the hardCap limit).
    budgetExhausted: false,
  };
  // Counts web_search + web_fetch calls across all rounds (success or fail —
  // a failed call still cost a network request and a round).
  let searchCount = 0;

  // Per-stream state. Mutated by the event listeners and read on completion.
  const state = {
    requestId: null,
    content: "",
    // Accumulated across ALL rounds (unlike `content`, which resets each
    // round) so the displayed reasoning spans the whole tool-calling loop.
    thinking: "",
    toolCalls: [],
    finalContent: "",
    error: null,
    resolve: null,
  };

  const unlisteners = [];

  // When the UI aborts (Stop button), tell the Rust stream to stop reading
  // from Ollama too. Without this, the Rust task keeps draining the Ollama
  // connection (burning GPU / cloud quota) until the round finishes, while
  // we're stuck awaiting `completionPromise`. The Rust command emits
  // `ollama://done` with the partial content, which resolves the promise and
  // lets the loop throw on the `signal.aborted` check below.
  let onAbort = null;
  if (signal) {
    onAbort = async () => {
      const id = state.requestId;
      if (id) {
        const invoke = await getInvoke();
        invoke("ollama_cancel", { requestId: id }).catch(() => {});
      }
    };
    // No pre-check for signal.aborted here: at setup time state.requestId is
    // null, so there is no Rust stream to cancel yet. An already-aborted
    // signal is caught by the signal?.aborted check at the top of the loop
    // below, which throws before any round starts.
    signal.addEventListener("abort", onAbort);
  }

  unlisteners.push(
    await listen("ollama://chunk", (event) => {
      const { request_id, line } = event.payload || {};
      if (request_id !== state.requestId) return;
      if (!line) return;
      applyStreamLine(line, state, { onToken, onThinking, signal });
    }),
  );

  unlisteners.push(
    await listen("ollama://done", (event) => {
      const { request_id, content } = event.payload || {};
      if (request_id !== state.requestId) return;
      state.finalContent = content ?? state.content;
      state.resolve?.({ ok: true });
      // Null the id so a Stop that lands right as the round completes
      // (Rust emitted done, CancelGuard removed the slot, but abort fires
      // before the loop clears state.requestId) doesn't insert a tombstone
      // for a dead id in ollama_cancel — those never get removed.
      state.requestId = null;
    }),
  );

  unlisteners.push(
    await listen("ollama://error", (event) => {
      const { request_id, error } = event.payload || {};
      if (request_id !== state.requestId) return;
      state.error = error || "Ollama stream error";
      state.resolve?.({ ok: false, error: state.error });
      // Null the id: same tombstone-leak mitigation as the done listener.
      state.requestId = null;
    }),
  );

  try {
    while (true) {
      if (signal?.aborted) throw new Error("aborted");

      // Budget / wrap-up / rate-limit policy. The force-final round also
      // strips tools (see includeTools below) and ignores any tool calls the
      // model still emits, finalizing with whatever text it produced.
      const forceFinal = (hardCap !== null && round >= hardCap) || limits.budgetExhausted;
      for (const msg of systemMessagesForRound(round, limits)) {
        workingMessages.push(msg);
      }

      const body = buildRequestBody(model, workingMessages, {
        tools,
        think,
        includeTools: !forceFinal,
      });

      // Reset per-round state
      state.requestId = nextRequestId();
      state.content = "";
      state.toolCalls = [];
      state.finalContent = "";
      state.error = null;

      const completionPromise = new Promise((resolve) => {
        state.resolve = resolve;
      });

      try {
        const invoke = await getInvoke();
        const { ollamaUrl, ollamaApiKey } = useSettingsStore.getState();
        await invoke("ollama_chat_stream", {
          requestId: state.requestId,
          body,
          ollamaUrl: ollamaUrl || null,
          apiKey: ollamaApiKey || null,
        });
      } catch (err) {
        throw new Error(`Ollama error: ${err?.message || err}`);
      }

      const result = await completionPromise;
      if (!result.ok) throw new Error(`Ollama error: ${result.error}`);
      if (signal?.aborted) throw new Error("aborted");

      // Strip leaked tool_call XML some models emit in the text content
      const content = stripLeakedToolCallXml(state.finalContent);

      // On the forced-final round we ignore any tool calls the model still
      // emitted and finalize with whatever text it produced.
      const toolCalls = forceFinal ? [] : state.toolCalls;
      if (toolCalls.length === 0) {
        onDone?.(content);
        return;
      }

      workingMessages.push({
        role: "assistant",
        content,
        tool_calls: toolCalls,
      });

      const { allFailed, quotaError } = await runToolCalls(
        toolCalls,
        executeTool,
        workingMessages,
        { onToolCall, onToolResult },
      );

      // Count this round's web calls against the search budget. Failed calls
      // count too — they still cost a network request. Once the budget is hit,
      // the next round becomes a tools-disabled force-final (limits.budgetExhausted
      // is read by both the forceFinal check above and systemMessagesForRound).
      if (maxSearches > 0) {
        searchCount += toolCalls.filter(
          (tc) => WEB_TOOL_NAMES.has(tc.function.name),
        ).length;
        if (searchCount >= maxSearches) limits.budgetExhausted = true;
      }

      // A QUOTA/auth failure (bad or exhausted Ollama key) won't recover on
      // retry — every further web call fails too. Stop the whole stream
      // rather than re-prompting for a final answer; the UI banner explains.
      if (quotaError) {
        onDone?.(content);
        return;
      }

      if (allFailed && round < maxToolRounds) {
        workingMessages.push({ role: "system", content: ALL_FAILED_MSG });
        round = maxToolRounds;
      }
      round++;
    }
  } finally {
    for (const un of unlisteners) {
      try {
        un();
      } catch {}
    }
    if (onAbort && signal) {
      try {
        signal.removeEventListener("abort", onAbort);
      } catch {}
    }
  }
}
