import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { streamChat } from "./ollama";

// Harness that simulates the Rust streaming layer. Each `invoke("ollama_chat_stream")`
// plays back a scripted round (chunks + done) for that request_id via the
// captured `listen` callbacks, mirroring how the Tauri backend emits events.
function installStreamHarness(rounds) {
  const handlers = {};
  listen.mockImplementation((name, cb) => {
    handlers[name] = cb;
    return Promise.resolve(() => {});
  });

  let roundIdx = 0;
  invoke.mockImplementation(async (cmd, args) => {
    if (cmd !== "ollama_chat_stream") return undefined;
    const { requestId } = args;
    const script = rounds[roundIdx++] || { chunks: [], content: "" };
    // Emit chunks, then done — asynchronously, like real events.
    await Promise.resolve();
    for (const line of script.chunks) {
      handlers["ollama://chunk"]?.({ payload: { request_id: requestId, line } });
    }
    handlers["ollama://done"]?.({
      payload: { request_id: requestId, content: script.content },
    });
    return undefined;
  });
}

describe("streamChat tool-loop onDone timing", () => {
  beforeEach(() => {
    invoke.mockReset();
    listen.mockReset();
  });

  it("calls onDone exactly once, after the final answer (not after a tool round)", async () => {
    // Round 1: model narrates + requests a tool. Round 2: final answer.
    installStreamHarness([
      {
        chunks: [
          { message: { content: "Let me search. " } },
          {
            message: {
              tool_calls: [
                { function: { name: "web_search", arguments: { query: "x" } } },
              ],
            },
          },
        ],
        content: "Let me search. ",
      },
      {
        chunks: [{ message: { content: "The answer is 42." } }],
        content: "The answer is 42.",
      },
    ]);

    const events = [];
    await streamChat({
      model: "m",
      messages: [{ role: "user", content: "q" }],
      tools: [{ type: "function", function: { name: "web_search" } }],
      executeTool: async () => {
        events.push("toolExec");
        return "results";
      },
      onToolCall: () => events.push("toolCall"),
      onToolResult: () => events.push("toolResult"),
      onDone: () => events.push("done"),
    });

    // onDone must fire exactly once, and only after the tool round completed.
    expect(events.filter((e) => e === "done")).toHaveLength(1);
    expect(events).toEqual(["toolCall", "toolExec", "toolResult", "done"]);
    // Two model rounds: the tool round + the final answer.
    const streamCalls = invoke.mock.calls.filter(
      (c) => c[0] === "ollama_chat_stream",
    );
    expect(streamCalls).toHaveLength(2);
  });

  it("still executes the tool when a trailing chunk carries an empty tool_calls array", async () => {
    installStreamHarness([
      {
        chunks: [
          {
            message: {
              content: "Searching… ",
              tool_calls: [
                { function: { name: "web_search", arguments: { query: "x" } } },
              ],
            },
          },
          // Trailing chunk some models/Ollama emit: empty tool_calls + content.
          { message: { content: "", tool_calls: [] } },
        ],
        content: "Searching… ",
      },
      {
        chunks: [{ message: { content: "Final answer." } }],
        content: "Final answer.",
      },
    ]);

    const events = [];
    await streamChat({
      model: "m",
      messages: [{ role: "user", content: "q" }],
      tools: [{ type: "function", function: { name: "web_search" } }],
      executeTool: async () => {
        events.push("toolExec");
        return "results";
      },
      onToolCall: () => events.push("toolCall"),
      onToolResult: () => events.push("toolResult"),
      onDone: () => events.push("done"),
    });

    // The tool must still run; onDone must come only after the final answer.
    expect(events).toEqual(["toolCall", "toolExec", "toolResult", "done"]);
  });
});
