// Ollama API wrapper with streaming + cloud model support
// Cloud models (e.g. minimax-m3:cloud) route via Ollama Pro subscription

const OLLAMA_BASE = "http://localhost:11434";

/**
 * Check if the Ollama server is reachable.
 * Uses /api/version which returns 200 regardless of whether any
 * models are pulled locally — /api/tags returns an empty list in
 * that case, which used to cause a false "offline" status.
 */
export async function isOllamaReachable() {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/version`);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * List model names currently pulled into the local Ollama instance.
 * Hits GET /api/tags and returns an array of bare model name strings
 * (e.g. ["llama3.2:3b", "qwen2.5-coder:7b"]), sorted alphabetically.
 * Returns an empty array on any error — callers should not treat that
 * as a hard failure (Ollama may be offline or simply have no models).
 */
export async function listLocalModels() {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`);
    if (!res.ok) return [];
    const data = await res.json();
    const names = (data.models ?? [])
      .map((m) => m?.name)
      .filter((n) => typeof n === "string" && n.length > 0);
    names.sort((a, b) => a.localeCompare(b));
    return names;
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
 * @param {number}  [params.maxToolRounds=3]
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
  maxToolRounds = 5,
  signal,
}) {
  const workingMessages = [...messages];
  let round = 0;

  while (true) {
    const forcedFinal = round >= maxToolRounds;

    const messages = forcedFinal
      ? [
          ...workingMessages,
          {
            role: "system",
            content:
              "Research complete. Write your final answer now based on everything gathered above. Do not call any more tools.",
          },
        ]
      : workingMessages;

    const body = {
      model,
      messages,
      stream: true,
      options: { temperature: 0.7 },
    };

    if (tools && tools.length > 0 && !forcedFinal) {
      body.tools = tools;
    }

    const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Ollama error: ${err}`);
    }

    const { toolCalls, content } = await consumeStream(res, {
      onToken,
      signal,
    });

    // No tool calls (or forced final round) — this is the final answer.
    if (toolCalls.length === 0 || forcedFinal) {
      onDone?.(content);
      return;
    }

    workingMessages.push({ role: "assistant", content, tool_calls: toolCalls });

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

      onToolResult?.(name, result);

      workingMessages.push({
        role: "tool",
        content: typeof result === "string" ? result : JSON.stringify(result),
      });
    }

    round++;
  }
}

/**
 * Consume the SSE-style newline-delimited JSON stream from Ollama.
 *
 * Text tokens are forwarded to onToken as they arrive (eagerly), giving
 * the user a live streaming experience even during tool-decision rounds.
 * For a research workbench, seeing the model's "let me search for..."
 * narration is useful — it shows the research process in action.
 *
 * Returns { content, toolCalls } for the caller to decide what to do
 * (loop on tool calls, finalize, etc.).
 */
async function consumeStream(res, { onToken, signal }) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let content = "";
  let toolCalls = [];

  const onAbort = () => reader.cancel();
  signal?.addEventListener("abort", onAbort);

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split("\n").filter(Boolean);

      for (const line of lines) {
        try {
          const json = JSON.parse(line);

          if (json.message?.tool_calls) {
            // tool_calls is an array of { function: { name, arguments } }
            // Arguments may be string or object depending on Ollama version.
            toolCalls = json.message.tool_calls.map((tc) => ({
              function: {
                name: tc.function.name,
                arguments:
                  typeof tc.function.arguments === "string"
                    ? safeJsonParse(tc.function.arguments)
                    : tc.function.arguments,
              },
            }));
          }

          if (json.message?.content) {
            content += json.message.content;
            onToken?.(json.message.content, content);
          }
        } catch {
          // skip malformed chunks
        }
      }
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }

  // Some models (e.g. minimax) leak their internal tool-call XML into the text
  // content instead of emitting structured tool_calls. Strip it before returning.
  content = content.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "").trim();

  return { content, toolCalls };
}

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
