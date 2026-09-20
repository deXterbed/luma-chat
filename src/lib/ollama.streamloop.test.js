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
      handlers["ollama://chunk"]?.({
        payload: { request_id: requestId, line },
      });
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

  it("forces a tools-disabled final round once toolCallLimit is reached, instead of looping forever", async () => {
    installStreamHarness([
      // Round 0: normal — model requests a tool.
      {
        chunks: [
          {
            message: {
              tool_calls: [
                { function: { name: "web_search", arguments: { query: "x" } } },
              ],
            },
          },
        ],
        content: "",
      },
      // Round 1 (= hardCap): force-final. Even if the model still emits a
      // tool call here, the orchestrator must ignore it and finalize.
      {
        chunks: [
          { message: { content: "Here is what I found." } },
          {
            message: {
              tool_calls: [
                { function: { name: "web_search", arguments: { query: "y" } } },
              ],
            },
          },
        ],
        content: "Here is what I found.",
      },
    ]);

    const events = [];
    let doneText = null;
    await streamChat({
      model: "m",
      messages: [{ role: "user", content: "q" }],
      tools: [{ type: "function", function: { name: "web_search" } }],
      toolCallLimit: 1,
      executeTool: async () => {
        events.push("toolExec");
        return "results";
      },
      onToolCall: () => events.push("toolCall"),
      onDone: (full) => {
        doneText = full;
        events.push("done");
      },
    });

    // Only one tool round ran; the force-final round's tool call is ignored.
    expect(events).toEqual(["toolCall", "toolExec", "done"]);
    expect(doneText).toBe("Here is what I found.");

    const streamCalls = invoke.mock.calls.filter(
      (c) => c[0] === "ollama_chat_stream",
    );
    expect(streamCalls).toHaveLength(2);
    // The force-final round must not offer tools to the model.
    expect(streamCalls[1][1].body).not.toHaveProperty("tools");
  });

  it("forces a tools-disabled final round once maxSearches is reached, even with unlimited toolCallLimit", async () => {
    installStreamHarness([
      // Round 0: model requests two web searches in one round.
      {
        chunks: [
          {
            message: {
              tool_calls: [
                { function: { name: "web_search", arguments: { query: "a" } } },
                { function: { name: "web_search", arguments: { query: "b" } } },
              ],
            },
          },
        ],
        content: "",
      },
      // Round 1: budget exhausted (2 searches, maxSearches=2) → force-final,
      // tools stripped. Model answers from gathered results.
      {
        chunks: [{ message: { content: "Here is what I found." } }],
        content: "Here is what I found.",
      },
    ]);

    const events = [];
    let doneText = null;
    await streamChat({
      model: "m",
      messages: [{ role: "user", content: "q" }],
      tools: [{ type: "function", function: { name: "web_search" } }],
      maxSearches: 2,
      executeTool: async () => {
        events.push("toolExec");
        return "results";
      },
      onToolCall: () => events.push("toolCall"),
      onDone: (full) => {
        doneText = full;
        events.push("done");
      },
    });

    // Both searches ran in round 0; round 1 is the forced final answer.
    expect(events).toEqual(["toolCall", "toolCall", "toolExec", "toolExec", "done"]);
    expect(doneText).toBe("Here is what I found.");

    const streamCalls = invoke.mock.calls.filter(
      (c) => c[0] === "ollama_chat_stream",
    );
    expect(streamCalls).toHaveLength(2);
    // The force-final round must not offer tools to the model.
    expect(streamCalls[1][1].body).not.toHaveProperty("tools");
    // And must carry the force-final system message.
    const round1Messages = streamCalls[1][1].body.messages;
    expect(
      round1Messages.some(
        (m) => m.role === "system" && /tool-use limit/i.test(m.content),
      ),
    ).toBe(true);
  });

  it("stops the stream immediately on a QUOTA tool error, without a further round", async () => {
    installStreamHarness([
      {
        chunks: [
          {
            message: {
              content: "Searching…",
              tool_calls: [
                { function: { name: "web_search", arguments: { query: "x" } } },
              ],
            },
          },
        ],
        content: "Searching…",
      },
    ]);

    const events = [];
    let doneText = null;
    await streamChat({
      model: "m",
      messages: [{ role: "user", content: "q" }],
      tools: [{ type: "function", function: { name: "web_search" } }],
      executeTool: async () => "Error: QUOTA: usage limit reached",
      onToolCall: () => events.push("toolCall"),
      onToolResult: () => events.push("toolResult"),
      onDone: (full) => {
        doneText = full;
        events.push("done");
      },
    });

    expect(events).toEqual(["toolCall", "toolResult", "done"]);
    expect(doneText).toBe("Searching…");
    const streamCalls = invoke.mock.calls.filter(
      (c) => c[0] === "ollama_chat_stream",
    );
    expect(streamCalls).toHaveLength(1);
  });

  it("jumps to the wrap-up round after every tool call in a round fails, and still finalizes", async () => {
    installStreamHarness([
      // Round 0: tool call that fails (non-quota error).
      {
        chunks: [
          {
            message: {
              tool_calls: [
                { function: { name: "web_search", arguments: { query: "x" } } },
              ],
            },
          },
        ],
        content: "",
      },
      // Next round (jumped ahead to maxToolRounds): model gives up and answers.
      {
        chunks: [{ message: { content: "I could not find results, but…" } }],
        content: "I could not find results, but…",
      },
    ]);

    const events = [];
    let doneText = null;
    await streamChat({
      model: "m",
      messages: [{ role: "user", content: "q" }],
      tools: [{ type: "function", function: { name: "web_search" } }],
      maxToolRounds: 3,
      executeTool: async () => "Error: search failed",
      onToolCall: () => events.push("toolCall"),
      onToolResult: () => events.push("toolResult"),
      onDone: (full) => {
        doneText = full;
        events.push("done");
      },
    });

    expect(events).toEqual(["toolCall", "toolResult", "done"]);
    expect(doneText).toBe("I could not find results, but…");

    const streamCalls = invoke.mock.calls.filter(
      (c) => c[0] === "ollama_chat_stream",
    );
    expect(streamCalls).toHaveLength(2);
    // The round-1 request must carry the "all tool calls failed" nudge.
    const round1Messages = streamCalls[1][1].body.messages;
    expect(
      round1Messages.some(
        (m) => m.role === "system" && /all tool calls.*failed/i.test(m.content),
      ),
    ).toBe(true);
  });
});

describe("Codebase mode loop policy", () => {
  beforeEach(() => {
    invoke.mockReset();
    listen.mockReset();
  });

  const streamCalls = () =>
    invoke.mock.calls.filter((c) => c[0] === "ollama_chat_stream");
  const readFileRound = (path) => ({
    chunks: [
      {
        message: {
          tool_calls: [{ function: { name: "read_file", arguments: { path } } }],
        },
      },
    ],
    content: "",
  });
  const roundMessages = (call) => call[1].body.messages;
  const hasSystem = (call, pattern) =>
    roundMessages(call).some(
      (m) => m.role === "system" && pattern.test(m.content),
    );

  // A wrong path is normal while exploring a repo. Rust returns those as plain
  // observations ("Not found: …"), which must NOT trip `allFailed` — that would
  // jump the session to its wrap-up round after one guessed path.
  it("keeps exploring after a round of not-found observations", async () => {
    installStreamHarness([
      readFileRound("nope.rs"),
      { chunks: [{ message: { content: "Found it elsewhere." } }], content: "Found it elsewhere." },
    ]);

    let doneText = null;
    await streamChat({
      model: "m",
      messages: [{ role: "user", content: "q" }],
      tools: [{ type: "function", function: { name: "read_file" } }],
      maxToolRounds: 20,
      maxFileCalls: 40,
      maxFileBytes: 150000,
      executeTool: async () =>
        "Not found: nope.rs (relative to the project root). Use list_dir to see what is there.",
      onDone: (full) => {
        doneText = full;
      },
    });

    const calls = streamCalls();
    expect(calls).toHaveLength(2);
    expect(doneText).toBe("Found it elsewhere.");
    expect(hasSystem(calls[1], /all tool calls.*failed/i)).toBe(false);
  });

  it("exhausts the file budget on bytes and forces the tools-disabled final round", async () => {
    installStreamHarness([
      readFileRound("big.rs"),
      { chunks: [{ message: { content: "Answer from what I read." } }], content: "Answer from what I read." },
    ]);

    await streamChat({
      model: "m",
      messages: [{ role: "user", content: "q" }],
      tools: [{ type: "function", function: { name: "read_file" } }],
      maxFileBytes: 100,
      executeTool: async () => "x".repeat(500),
    });

    const calls = streamCalls();
    expect(calls).toHaveLength(2);
    expect(hasSystem(calls[1], /reached the tool-use limit/i)).toBe(true);
    expect(calls[1][1].body).not.toHaveProperty("tools");
  });

  it("exhausts the file budget on call count", async () => {
    installStreamHarness([
      {
        chunks: [
          {
            message: {
              tool_calls: [
                { function: { name: "read_file", arguments: { path: "a.rs" } } },
              ],
            },
          },
        ],
        content: "",
      },
      { chunks: [{ message: { content: "done" } }], content: "done" },
    ]);

    await streamChat({
      model: "m",
      messages: [{ role: "user", content: "q" }],
      tools: [{ type: "function", function: { name: "read_file" } }],
      maxFileCalls: 1,
      executeTool: async () => "short",
    });

    const calls = streamCalls();
    expect(calls).toHaveLength(2);
    expect(hasSystem(calls[1], /reached the tool-use limit/i)).toBe(true);
  });

  // `WEB_SEARCH_NUDGE_AT = 15` fires on the round number alone, never checking
  // which tools ran — so in Codebase mode it would tell the model to stop and
  // write its final answer in the middle of reading a repo that made no web
  // searches at all. `webSearchNudgeAt: null` is how the mode turns it off.
  it("injects the DuckDuckGo nudge at round 15 by default, and never when suppressed", async () => {
    const manyRounds = [
      ...Array.from({ length: 16 }, (_, i) => readFileRound(`f${i}.rs`)),
      { chunks: [{ message: { content: "final" } }], content: "final" },
    ];

    installStreamHarness(manyRounds);
    await streamChat({
      model: "m",
      messages: [{ role: "user", content: "q" }],
      tools: [{ type: "function", function: { name: "read_file" } }],
      maxToolRounds: 40,
      executeTool: async () => "1→code\n",
    });
    let calls = streamCalls();
    expect(calls.length).toBeGreaterThan(15);
    expect(hasSystem(calls[15], /DuckDuckGo/i)).toBe(true);

    invoke.mockReset();
    listen.mockReset();
    installStreamHarness(manyRounds);
    await streamChat({
      model: "m",
      messages: [{ role: "user", content: "q" }],
      tools: [{ type: "function", function: { name: "read_file" } }],
      maxToolRounds: 40,
      webSearchNudgeAt: null,
      executeTool: async () => "1→code\n",
    });
    calls = streamCalls();
    expect(calls.length).toBeGreaterThan(15);
    expect(hasSystem(calls[15], /DuckDuckGo/i)).toBe(false);
  });
});

// The log is the only reason the harness can be tuned from evidence rather than
// guesswork, so its wiring is asserted here: if an event stops being emitted,
// the log goes quiet and looks like "nothing happened" instead of breaking.
describe("agent log instrumentation", () => {
  beforeEach(() => {
    invoke.mockReset();
    listen.mockReset();
  });

  function recordingLogger() {
    const events = [];
    return {
      events,
      log: {
        enabled: true,
        event: (t, d) => events.push({ t, ...d }),
        flush: async () => {},
      },
      types: () => events.map((e) => e.t),
      find: (t) => events.find((e) => e.t === t),
    };
  }

  it("records the run's policy, each round, and every tool call", async () => {
    installStreamHarness([
      {
        chunks: [
          { message: { content: "Let me look. " } },
          {
            message: {
              tool_calls: [
                { function: { name: "read_file", arguments: { path: "a.rs" } } },
              ],
            },
          },
        ],
        content: "Let me look. ",
      },
      { chunks: [{ message: { content: "The answer." } }], content: "The answer." },
    ]);

    const rec = recordingLogger();
    await streamChat({
      model: "m",
      messages: [{ role: "user", content: "q" }],
      tools: [{ type: "function", function: { name: "read_file" } }],
      log: rec.log,
      numCtx: 32768,
      webSearchNudgeAt: null,
      maxFileCalls: 40,
      maxFileBytes: 150000,
      executeTool: async () => "1→code\n",
    });

    const types = rec.types();
    for (const expected of [
      "limits",
      "round.start",
      "round.reply",
      "tool",
      "round.end",
      "stream.end",
    ]) {
      expect(types).toContain(expected);
    }

    // The resolved policy, not the params: this is what makes a log
    // self-explanatory a week later.
    expect(rec.find("limits")).toMatchObject({
      numCtx: 32768,
      webSearchNudgeAt: null,
      maxFileCalls: 40,
      maxFileBytes: 150000,
      toolCount: 1,
    });

    // Where the model's plan for the round lands — the decision, not just its
    // consequence.
    expect(rec.find("round.reply").contentHead).toContain("Let me look.");

    // The call, its args, its verdict, and its size.
    const tool = rec.find("tool");
    expect(tool).toMatchObject({ round: 0, index: 0, name: "read_file", kind: "ok" });
    expect(tool.args).toEqual({ path: "a.rs" });
    expect(tool.chars).toBeGreaterThan(0);
    expect(typeof tool.ms).toBe("number");

    expect(rec.find("stream.end")).toMatchObject({ reason: "final" });
  });

  it("names the policy message that was injected, so a cut-off run is explainable", async () => {
    installStreamHarness([
      {
        chunks: [
          {
            message: {
              tool_calls: [
                { function: { name: "read_file", arguments: { path: "a.rs" } } },
              ],
            },
          },
        ],
        content: "",
      },
      { chunks: [{ message: { content: "final" } }], content: "final" },
    ]);

    const rec = recordingLogger();
    await streamChat({
      model: "m",
      messages: [{ role: "user", content: "q" }],
      tools: [{ type: "function", function: { name: "read_file" } }],
      maxToolRounds: 1,
      log: rec.log,
      executeTool: async () => "1→code\n",
    });

    const starts = rec.events.filter((e) => e.t === "round.start");
    expect(starts[0].injected).toEqual([]);
    // Round 1 is maxToolRounds, so the wrap-up fires — and the log says which
    // policy message it was, not merely that a system message appeared.
    expect(starts[1].injected).toContain("WRAP_UP");
  });

  it("records why the run ended when the model's calls all fail", async () => {
    installStreamHarness([
      {
        chunks: [
          {
            message: {
              tool_calls: [
                { function: { name: "read_file", arguments: { path: "missing.rs" } } },
              ],
            },
          },
        ],
        content: "",
      },
      { chunks: [{ message: { content: "gave up" } }], content: "gave up" },
    ]);

    const rec = recordingLogger();
    await streamChat({
      model: "m",
      messages: [{ role: "user", content: "q" }],
      tools: [{ type: "function", function: { name: "read_file" } }],
      maxToolRounds: 20,
      log: rec.log,
      executeTool: async () => "Error: could not read the file",
    });

    expect(rec.find("tool")).toMatchObject({ kind: "error" });
    expect(rec.find("round.end")).toMatchObject({ allFailed: true });
  });
});

describe("streamChat abort -> ollama_cancel contract", () => {
  beforeEach(() => {
    invoke.mockReset();
    listen.mockReset();
  });

  // Drain the microtask queue so an un-awaited streamChat can run its sync
  // prefix (register listeners, set state.requestId, reach the first
  // `await invoke("ollama_chat_stream")`) up to a pending state.
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it("invokes ollama_cancel with the active requestId when the abort signal fires", async () => {
    const handlers = {};
    listen.mockImplementation((name, cb) => {
      handlers[name] = cb;
      return Promise.resolve(() => {});
    });

    // Hold the stream open: emit a chunk, then block on a gate the test
    // releases. This mirrors a real mid-generation abort where Rust hasn't
    // emitted ollama://done yet.
    let releaseDone;
    const doneGate = new Promise((r) => {
      releaseDone = r;
    });
    invoke.mockImplementation(async (cmd, args) => {
      if (cmd === "ollama_cancel") return true;
      if (cmd !== "ollama_chat_stream") return undefined;
      const { requestId } = args;
      handlers["ollama://chunk"]?.({
        payload: {
          request_id: requestId,
          line: { message: { content: "partial" } },
        },
      });
      await doneGate;
      handlers["ollama://done"]?.({
        payload: { request_id: requestId, content: "partial" },
      });
      return undefined;
    });

    const ctrl = new AbortController();
    const onDone = vi.fn();
    const onToken = vi.fn();
    const streamPromise = streamChat({
      model: "m",
      messages: [{ role: "user", content: "q" }],
      onToken,
      onDone,
      signal: ctrl.signal,
    });

    // Let streamChat reach the pending `await invoke("ollama_chat_stream")`.
    await flush();

    // Stop — should fire ollama_cancel on the Rust side for the active id.
    ctrl.abort();
    await flush();

    // Release the Rust side; it emits done with the partial, the loop's
    // signal?.aborted check then throws and streamChat rejects.
    releaseDone();
    await expect(streamPromise).rejects.toThrow("aborted");

    const cancelCalls = invoke.mock.calls.filter(
      (c) => c[0] === "ollama_cancel",
    );
    expect(cancelCalls).toHaveLength(1);
    expect(cancelCalls[0][1]).toMatchObject({ requestId: expect.any(String) });
    // The canceled requestId must match the one passed to ollama_chat_stream.
    const streamCall = invoke.mock.calls.find(
      (c) => c[0] === "ollama_chat_stream",
    );
    expect(cancelCalls[0][1].requestId).toBe(streamCall[1].requestId);
    // Aborted before finalize, so onDone must not fire.
    expect(onDone).not.toHaveBeenCalled();
  });

  it("does not invoke ollama_cancel after the round completes (requestId nulled in the done listener)", async () => {
    const handlers = {};
    listen.mockImplementation((name, cb) => {
      handlers[name] = cb;
      return Promise.resolve(() => {});
    });

    invoke.mockImplementation(async (cmd, args) => {
      if (cmd === "ollama_cancel") return true;
      if (cmd !== "ollama_chat_stream") return undefined;
      const { requestId } = args;
      await Promise.resolve();
      handlers["ollama://done"]?.({
        payload: { request_id: requestId, content: "final answer" },
      });
      return undefined;
    });

    const ctrl = new AbortController();
    const onDone = vi.fn();
    await streamChat({
      model: "m",
      messages: [{ role: "user", content: "q" }],
      onDone,
      signal: ctrl.signal,
    });

    // Now abort AFTER the stream finished. The done listener nulled
    // state.requestId, so onAbort's `if (id)` guard skips the cancel invoke —
    // no tombstone is inserted for the dead id.
    ctrl.abort();
    await flush();

    const cancelCalls = invoke.mock.calls.filter(
      (c) => c[0] === "ollama_cancel",
    );
    expect(cancelCalls).toHaveLength(0);
  });
});
