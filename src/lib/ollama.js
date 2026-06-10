// Ollama API wrapper. In production builds the WebView2 origin is
// `http://tauri.localhost`, which the browser treats as a separate origin
// from `http://localhost:11434` and enforces CORS on. Ollama does not return
// CORS headers, so all calls are proxied through Rust Tauri commands instead.
//
// Cloud models (e.g. `minimax-m3:cloud`) route via Ollama Pro subscription;
// they're just model tags as far as the proxy is concerned.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/**
 * Check if the Ollama server is reachable.
 * Returns true if /api/version responds 2xx, false on any error.
 */
export async function isOllamaReachable() {
  try {
    return await invoke("ollama_reachable");
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
    const names = await invoke("ollama_list_models");
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
 * @param {AbortSignal} [params.signal]
 */
export async function streamChat({
  model,
  messages,
  tools,
  executeTool,
  onToken,
  onToolCall,
  onToolResult,
  onDone,
  maxToolRounds = 10,
  signal,
}) {
  const workingMessages = [...messages];
  let round = 0;
  const HARD_CAP = 15;

  // Per-stream state. Mutated by the event listeners and read on completion.
  const state = {
    requestId: null,
    content: "",
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
        onToken?.(text, state.content);
      }

      if (Array.isArray(line?.message?.tool_calls)) {
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
      if (round >= HARD_CAP) {
        throw new Error(
          `Model called tools ${HARD_CAP} times without producing a final answer.`,
        );
      }

      if (round === maxToolRounds) {
        workingMessages.push({
          role: "system",
          content:
            "You have done extensive research. Write your final answer now based on everything gathered above. You may make one more tool call if truly necessary, but aim to conclude.",
        });
      }

      const body = {
        model,
        messages: workingMessages,
        stream: true,
        options: { temperature: 0.7 },
      };
      if (tools && tools.length > 0) body.tools = tools;

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
        await invoke("ollama_chat_stream", {
          requestId: state.requestId,
          body,
        });
      } catch (err) {
        throw new Error(`Ollama error: ${err?.message || err}`);
      }

      const result = await completionPromise;
      if (!result.ok) throw new Error(`Ollama error: ${result.error}`);

      // Strip leaked tool_call XML some models emit in the text content
      const content = state.finalContent
        .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "")
        .trim();

      const toolCalls = state.toolCalls;
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
        onToolResult?.(name, result);
        workingMessages.push({
          role: "tool",
          content: typeof result === "string" ? result : JSON.stringify(result),
        });
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
