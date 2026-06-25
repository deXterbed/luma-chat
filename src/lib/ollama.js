// Ollama API wrapper. In production builds the WebView2 origin is
// `http://tauri.localhost`, which the browser treats as a separate origin
// from `http://localhost:11434` and enforces CORS on. Ollama does not return
// CORS headers, so all calls are proxied through Rust Tauri commands instead.
//
// Cloud models (e.g. `minimax-m3:cloud`) route via Ollama Pro subscription;
// they're just model tags as far as the proxy is concerned.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useSettingsStore } from "../store/settingsStore";

/**
 * Check if the Ollama server is reachable.
 * Returns true if /api/version responds 2xx, false on any error.
 */
export async function isOllamaReachable() {
  try {
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
// Tool-calling support
// =============================================================================
//
// When the model decides to use a tool, we execute it, append the result
// as a `role: "tool"` message, and re-call the model. The loop runs up to
// `maxToolRounds` times (default 5) to prevent runaway iteration.
//
// Callbacks:
//   onToken(chunk, full)    — called for every text chunk in every round.
//                             For a research workbench, the model's
//                             "let me search for..." narration in tool-
//                             decision rounds is useful — it shows the
//                             research process in action.
//   onThinking(chunk, full) — called for every reasoning chunk (think: true);
//                             `full` is the reasoning accumulated across rounds.
//   onToolCall(name, args)  — called when the model invokes a tool
//                             (use this to show "🔍 Searching for..." UI)
//   onToolResult(name, res) — called after a tool returns
//                             (use this to show "✓ Got N results" UI)
//   onDone(full)            — called when the whole loop completes
//                             with the final answer text
//   signal                  — AbortSignal to cancel mid-flight
// =============================================================================

let _requestCounter = 0;
function nextRequestId() {
  _requestCounter += 1;
  return `ollama-${Date.now()}-${_requestCounter}`;
}

/**
 * Run a chat completion with optional tool-calling support.
 *
 * @param {object} params
 * @param {string} params.model
 * @param {Array}  params.messages            - initial messages array
 * @param {Array}  [params.tools]            - Ollama-format tool definitions
 * @param {function} [params.executeTool]    - (name, args) => Promise<string>
 * @param {function} [params.onToken]
 * @param {function} [params.onToolCall]
 * @param {function} [params.onToolResult]
 * @param {function} [params.onDone]
 * @param {number}  [params.maxToolRounds=10]
 * @param {number}  [params.toolCallLimit=0]   - max tool rounds before a forced tools-disabled final answer; 0 = unlimited
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
  signal,
  think,
}) {
  const workingMessages = [...messages];
  let round = 0;
  // 0 = unlimited. Otherwise, once the model has used this many tool rounds
  // without finishing, we make one last tools-disabled call to force an answer.
  const hardCap = toolCallLimit > 0 ? toolCallLimit : null;
  // Fires regardless of `hardCap` (even when unlimited): DuckDuckGo rate-limits
  // heavy use, so urge the model to wrap up once it's made this many rounds.
  const WEB_SEARCH_NUDGE_AT = 15;

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

  unlisteners.push(
    await listen("ollama://chunk", (event) => {
      const { request_id, line } = event.payload || {};
      if (request_id !== state.requestId) return;
      if (!line) return;

      const text = line?.message?.content;
      if (typeof text === "string" && text.length > 0) {
        state.content += text;
        if (!signal?.aborted) onToken?.(text, state.content);
      }

      // When `think: true`, Ollama streams the model's reasoning in a separate
      // `thinking` field, distinct from the final-answer `content`.
      const thinking = line?.message?.thinking;
      if (typeof thinking === "string" && thinking.length > 0) {
        state.thinking += thinking;
        if (!signal?.aborted) onThinking?.(thinking, state.thinking);
      }

      // Only capture a non-empty tool_calls array. Some models/Ollama emit a
      // trailing chunk with `tool_calls: []`, which would otherwise wipe the
      // calls captured earlier in the round — ending the round with zero tool
      // calls, so the loop finalizes early (Stop button flips to Send) and the
      // tool never runs.
      if (
        Array.isArray(line?.message?.tool_calls) &&
        line.message.tool_calls.length > 0
      ) {
        state.toolCalls = line.message.tool_calls.map((tc) => ({
          function: {
            name: tc.function?.name,
            arguments:
              typeof tc.function?.arguments === "string"
                ? safeJsonParse(tc.function.arguments)
                : tc.function?.arguments || {},
          },
        }));
      }
    }),
  );

  unlisteners.push(
    await listen("ollama://done", (event) => {
      const { request_id, content } = event.payload || {};
      if (request_id !== state.requestId) return;
      state.finalContent = content ?? state.content;
      state.resolve?.({ ok: true });
    }),
  );

  unlisteners.push(
    await listen("ollama://error", (event) => {
      const { request_id, error } = event.payload || {};
      if (request_id !== state.requestId) return;
      state.error = error || "Ollama stream error";
      state.resolve?.({ ok: false, error: state.error });
    }),
  );

  try {
    while (true) {
      if (signal?.aborted) throw new Error("aborted");

      // Budget exhausted: make one final call with NO tools, but keep every
      // tool result gathered so far so the model answers from what it actually
      // found — not from training data. (Previously this re-prompted with a
      // tool-free prompt and discarded the gathered context, producing "I
      // don't have live access…" answers even after successful searches.)
      const forceFinal = hardCap !== null && round >= hardCap;

      if (forceFinal) {
        workingMessages.push({
          role: "system",
          content:
            "You have reached the tool-use limit and can no longer call tools. Write your final answer now using only the information gathered from the tool results above. Do not claim you lack access to real-time or live data — base your answer on what was already retrieved.",
        });
      } else if (round === maxToolRounds) {
        workingMessages.push({
          role: "system",
          content:
            "You have done extensive research. Write your final answer now based on everything gathered above. You may make one more tool call if truly necessary, but aim to conclude.",
        });
      }

      if (!forceFinal && round === WEB_SEARCH_NUDGE_AT) {
        workingMessages.push({
          role: "system",
          content:
            "You have made many web searches. The search provider (DuckDuckGo) rate-limits heavy use, so stop searching now and write your final answer from what you have already gathered. Do not call web_search or web_fetch again.",
        });
      }

      const body = {
        model,
        messages: workingMessages,
        stream: true,
        options: { temperature: 0.7, num_ctx: 8192 },
      };
      if (!forceFinal && tools && tools.length > 0) body.tools = tools;
      if (think !== undefined) body.think = think;

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
      const content = state.finalContent
        .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "")
        .trim();

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

      let allFailed = true;
      let quotaError = false;
      for (const call of toolCalls) {
        const name = call.function.name;
        const args = call.function.arguments || {};
        onToolCall?.(name, args);

        let result;
        try {
          result = executeTool
            ? await executeTool(name, args)
            : "Error: no tool executor registered";
        } catch (err) {
          result = `Error executing ${name}: ${err.message || err}`;
        }
        if (typeof result !== "string" || !result.startsWith("Error")) {
          allFailed = false;
        }
        // A QUOTA/auth failure (bad or exhausted Ollama key) won't recover on
        // retry — every further web call fails too. Stop the whole stream
        // rather than re-prompting for a final answer; the UI banner explains.
        if (typeof result === "string" && result.startsWith("Error: QUOTA:")) {
          quotaError = true;
        }
        onToolResult?.(name, result);
        workingMessages.push({
          role: "tool",
          content: typeof result === "string" ? result : JSON.stringify(result),
        });
      }

      if (quotaError) {
        onDone?.(content);
        return;
      }

      if (allFailed && round < maxToolRounds) {
        workingMessages.push({
          role: "system",
          content:
            "All tool calls in the last round failed. Write your final answer now based on everything gathered so far.",
        });
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
  }
}

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
