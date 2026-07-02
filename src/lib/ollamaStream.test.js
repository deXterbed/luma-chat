import { describe, it, expect } from "vitest";
import {
  applyStreamLine,
  normalizeToolCalls,
  systemMessagesForRound,
  buildRequestBody,
  stripLeakedToolCallXml,
  runToolCalls,
  safeJsonParse,
} from "./ollamaStream";

// Build the leaked-tool-call XML marker via concatenation so the literal
// sequence never appears in this source file (it would confuse tooling).
const OPEN = String.fromCharCode(60) + "tool_call" + String.fromCharCode(62);
const CLOSE = String.fromCharCode(60) + "/tool_call" + String.fromCharCode(62);
function leaked(inner) {
  return OPEN + inner + CLOSE;
}

describe("safeJsonParse", () => {
  it("parses valid JSON", () => {
    expect(safeJsonParse('{"a":1}')).toEqual({ a: 1 });
  });
  it("returns empty object on invalid JSON", () => {
    expect(safeJsonParse("not json")).toEqual({});
  });
});

describe("normalizeToolCalls", () => {
  it("passes through object arguments unchanged", () => {
    const calls = [{ function: { name: "t", arguments: { q: "x" } } }];
    expect(normalizeToolCalls(calls)).toEqual([
      { function: { name: "t", arguments: { q: "x" } } },
    ]);
  });
  it("parses string arguments as JSON", () => {
    const calls = [{ function: { name: "t", arguments: '{"q":"x"}' } }];
    expect(normalizeToolCalls(calls)).toEqual([
      { function: { name: "t", arguments: { q: "x" } } },
    ]);
  });
  it("falls back to {} when string arguments are invalid JSON", () => {
    const calls = [{ function: { name: "t", arguments: "broken" } }];
    expect(normalizeToolCalls(calls)).toEqual([
      { function: { name: "t", arguments: {} } },
    ]);
  });
  it("falls back to {} when arguments are missing", () => {
    const calls = [{ function: { name: "t" } }];
    expect(normalizeToolCalls(calls)).toEqual([
      { function: { name: "t", arguments: {} } },
    ]);
  });

  // Captured from a real Ollama stream (ornith:9b): tool_calls carry extra
  // `id` and `function.index` fields and arguments is an OBJECT, not a JSON
  // string. We must drop the extras and keep name + arguments only.
  it("drops id/index fields from a real-shape tool_calls chunk", () => {
    const calls = [
      {
        id: "call_ol0ij4zn",
        function: { index: 0, name: "get_current_time", arguments: {} },
      },
    ];
    expect(normalizeToolCalls(calls)).toEqual([
      { function: { name: "get_current_time", arguments: {} } },
    ]);
  });
});

describe("applyStreamLine", () => {
  function makeState() {
    return { content: "", thinking: "", toolCalls: [] };
  }

  it("accumulates content text and fires onToken with the running full text", () => {
    const state = makeState();
    const tokens = [];
    applyStreamLine({ message: { content: "hello " } }, state, {
      onToken: (chunk, full) => tokens.push([chunk, full]),
    });
    applyStreamLine({ message: { content: "world" } }, state, {
      onToken: (chunk, full) => tokens.push([chunk, full]),
    });
    expect(state.content).toBe("hello world");
    expect(tokens).toEqual([
      ["hello ", "hello "],
      ["world", "hello world"],
    ]);
  });

  it("ignores empty/non-string content", () => {
    const state = makeState();
    applyStreamLine({ message: { content: "" } }, state, {});
    applyStreamLine({ message: {} }, state, {});
    applyStreamLine({}, state, {});
    expect(state.content).toBe("");
  });

  it("accumulates thinking across lines and fires onThinking with full", () => {
    const state = makeState();
    const thoughts = [];
    applyStreamLine({ message: { thinking: "step1 " } }, state, {
      onThinking: (c, f) => thoughts.push([c, f]),
    });
    applyStreamLine({ message: { thinking: "step2" } }, state, {
      onThinking: (c, f) => thoughts.push([c, f]),
    });
    expect(state.thinking).toBe("step1 step2");
    expect(thoughts).toEqual([
      ["step1 ", "step1 "],
      ["step2", "step1 step2"],
    ]);
  });

  it("captures a non-empty tool_calls array (normalized)", () => {
    const state = makeState();
    applyStreamLine(
      {
        message: {
          tool_calls: [
            { function: { name: "web_search", arguments: { query: "x" } } },
          ],
        },
      },
      state,
      {},
    );
    expect(state.toolCalls).toEqual([
      { function: { name: "web_search", arguments: { query: "x" } } },
    ]);
  });

  it("does NOT wipe captured tool_calls when a trailing chunk carries an empty array", () => {
    const state = makeState();
    applyStreamLine(
      {
        message: {
          tool_calls: [{ function: { name: "t", arguments: {} } }],
        },
      },
      state,
      {},
    );
    applyStreamLine({ message: { tool_calls: [] } }, state, {});
    expect(state.toolCalls).toHaveLength(1);
  });

  it("does not fire onToken when signal is aborted", () => {
    const state = makeState();
    const controller = new AbortController();
    controller.abort();
    let fired = false;
    applyStreamLine({ message: { content: "x" } }, state, {
      onToken: () => (fired = true),
      signal: controller.signal,
    });
    // content still accumulates, but the callback is suppressed
    expect(state.content).toBe("x");
    expect(fired).toBe(false);
  });

  // Captured from a real Ollama stream: during reasoning, content is "" and
  // only `thinking` is filled, token by token.
  it("handles a real thinking chunk (empty content, non-empty thinking)", () => {
    const state = makeState();
    const thoughts = [];
    applyStreamLine(
      {
        message: { role: "assistant", content: "", thinking: "The" },
        done: false,
      },
      state,
      { onThinking: (c, f) => thoughts.push(f) },
    );
    expect(state.content).toBe("");
    expect(state.thinking).toBe("The");
    expect(thoughts).toEqual(["The"]);
  });

  // Captured from a real Ollama stream: the tool_calls chunk carries empty
  // content, an `id`, and `function.index` + object arguments. We must capture
  // the normalized calls and leave content untouched (empty).
  it("handles a real tool_calls chunk (empty content, id/index, object args)", () => {
    const state = makeState();
    applyStreamLine(
      {
        model: "ornith:9b",
        message: {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "call_ol0ij4zn",
              function: { index: 0, name: "get_current_time", arguments: {} },
            },
          ],
        },
        done: false,
      },
      state,
      {},
    );
    expect(state.content).toBe("");
    expect(state.toolCalls).toEqual([
      { function: { name: "get_current_time", arguments: {} } },
    ]);
  });

  // Captured from a real Ollama stream: the final `done:true` line has an
  // empty-content message and no tool_calls. It must not wipe captured calls
  // (there are none here) and must not fire onToken for empty content.
  it("ignores the real final done line (empty content, no tool_calls)", () => {
    const state = makeState();
    let tokens = 0;
    applyStreamLine(
      {
        model: "ornith:9b",
        message: { role: "assistant", content: "" },
        done: true,
        done_reason: "stop",
        total_duration: 7180585167,
      },
      state,
      { onToken: () => tokens++ },
    );
    expect(state.content).toBe("");
    expect(state.toolCalls).toEqual([]);
    expect(tokens).toBe(0);
  });
});

describe("systemMessagesForRound", () => {
  const limits = { hardCap: null, maxToolRounds: 10, webSearchNudgeAt: 15 };

  it("returns no messages for an ordinary round", () => {
    expect(systemMessagesForRound(0, limits)).toEqual([]);
    expect(systemMessagesForRound(5, limits)).toEqual([]);
  });

  it("returns the web-search nudge at the nudge round (when unlimited)", () => {
    const msgs = systemMessagesForRound(15, limits);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe("system");
    expect(msgs[0].content).toMatch(/stop searching/i);
  });

  it("returns the wrap-up message at maxToolRounds (when unlimited)", () => {
    const msgs = systemMessagesForRound(10, limits);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toMatch(/final answer/i);
  });

  it("returns the force-final message when round >= hardCap", () => {
    const capped = { hardCap: 3, maxToolRounds: 10, webSearchNudgeAt: 15 };
    const at = systemMessagesForRound(3, capped);
    const over = systemMessagesForRound(5, capped);
    expect(at).toHaveLength(1);
    expect(at[0].content).toMatch(/tool-use limit/i);
    expect(over).toHaveLength(1);
    expect(over[0].content).toMatch(/tool-use limit/i);
  });

  it("does not also push the web-search nudge on a force-final round", () => {
    const capped = { hardCap: 15, maxToolRounds: 10, webSearchNudgeAt: 15 };
    const msgs = systemMessagesForRound(15, capped);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toMatch(/tool-use limit/i);
  });
});

describe("buildRequestBody", () => {
  const base = { model: "m", think: true };

  it("includes tools only when includeTools is true and tools are present", () => {
    const tools = [{ type: "function", function: { name: "t" } }];
    const withTools = buildRequestBody("m", [{ role: "user", content: "q" }], {
      ...base,
      tools,
      includeTools: true,
    });
    expect(withTools.tools).toEqual(tools);
  });

  it("omits tools when includeTools is false (force-final round)", () => {
    const tools = [{ type: "function", function: { name: "t" } }];
    const body = buildRequestBody("m", [{ role: "user", content: "q" }], {
      ...base,
      tools,
      includeTools: false,
    });
    expect(body).not.toHaveProperty("tools");
  });

  it("omits tools when the tools array is empty", () => {
    const body = buildRequestBody("m", [], { tools: [], includeTools: true });
    expect(body).not.toHaveProperty("tools");
  });

  it("omits think when think is undefined", () => {
    const body = buildRequestBody("m", [], { includeTools: true });
    expect(body).not.toHaveProperty("think");
  });

  it("always sets stream:true and the fixed options", () => {
    const body = buildRequestBody("m", [], { includeTools: true });
    expect(body.stream).toBe(true);
    expect(body.options).toEqual({ temperature: 0.7, num_ctx: 8192 });
    expect(body.model).toBe("m");
  });
});

describe("stripLeakedToolCallXml", () => {
  it("removes leaked blocks and trims", () => {
    // The marker sits in the middle; only the ends get trimmed, so the
    // surrounding whitespace is preserved (concatenated together).
    const input = "pre " + leaked('{"name":"x"}') + " post";
    expect(stripLeakedToolCallXml(input)).toBe("pre  post");
  });
  it("removes multiline leaked blocks", () => {
    const inner = "\n" + '{"name":"x"}' + "\n";
    const input = "a\n" + leaked(inner) + "\nb";
    // The regex is non-greedy across the marker block, then trims.
    expect(stripLeakedToolCallXml(input)).toBe("a\n\nb".replace(/\s+$/, ""));
  });
  it("leaves content without leaked blocks unchanged (modulo trim)", () => {
    expect(stripLeakedToolCallXml("hello world")).toBe("hello world");
  });
});

describe("runToolCalls", () => {
  it("executes each call, fires onToolCall/onToolResult, and appends tool messages", async () => {
    const workingMessages = [];
    const events = [];
    const toolCalls = [
      { function: { name: "web_search", arguments: { query: "x" } } },
      { function: { name: "get_current_time", arguments: {} } },
    ];
    const executeTool = async (name) => "result-for-" + name;
    const { allFailed, quotaError } = await runToolCalls(
      toolCalls,
      executeTool,
      workingMessages,
      {
        onToolCall: (n, a) => events.push(["call", n, a]),
        onToolResult: (n, r) => events.push(["result", n, r]),
      },
    );
    expect(allFailed).toBe(false);
    expect(quotaError).toBe(false);
    expect(events).toEqual([
      ["call", "web_search", { query: "x" }],
      ["result", "web_search", "result-for-web_search"],
      ["call", "get_current_time", {}],
      ["result", "get_current_time", "result-for-get_current_time"],
    ]);
    expect(workingMessages).toEqual([
      { role: "tool", content: "result-for-web_search" },
      { role: "tool", content: "result-for-get_current_time" },
    ]);
  });

  it("defaults missing arguments to {}", async () => {
    const workingMessages = [];
    let received;
    await runToolCalls(
      [{ function: { name: "t" } }],
      async (n, a) => {
        received = a;
        return "ok";
      },
      workingMessages,
      {},
    );
    expect(received).toEqual({});
  });

  it("uses a placeholder string when no executeTool is registered", async () => {
    const workingMessages = [];
    const { allFailed } = await runToolCalls(
      [{ function: { name: "t", arguments: {} } }],
      undefined,
      workingMessages,
      {},
    );
    expect(allFailed).toBe(true);
    expect(workingMessages[0].content).toMatch(/no tool executor/i);
  });

  it("catches a throwing executeTool and records the error string", async () => {
    const workingMessages = [];
    const { allFailed } = await runToolCalls(
      [{ function: { name: "t", arguments: {} } }],
      async () => {
        throw new Error("boom");
      },
      workingMessages,
      {},
    );
    expect(allFailed).toBe(true);
    expect(workingMessages[0].content).toMatch(/boom/);
  });

  it("stringifies non-string results when appending to messages", async () => {
    const workingMessages = [];
    await runToolCalls(
      [{ function: { name: "t", arguments: {} } }],
      async () => ({ rows: [1, 2] }),
      workingMessages,
      {},
    );
    expect(workingMessages[0]).toEqual({
      role: "tool",
      content: JSON.stringify({ rows: [1, 2] }),
    });
  });

  it("detects a QUOTA error and sets quotaError", async () => {
    const workingMessages = [];
    const { quotaError } = await runToolCalls(
      [{ function: { name: "web_search", arguments: {} } }],
      async () => "Error: QUOTA: usage limit reached",
      workingMessages,
      {},
    );
    expect(quotaError).toBe(true);
  });

  it("treats an Error-prefixed string result as a failure", async () => {
    const { allFailed } = await runToolCalls(
      [{ function: { name: "t", arguments: {} } }],
      async () => "Error: something broke",
      [],
      {},
    );
    expect(allFailed).toBe(true);
  });
});
