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
  it("falls back to {} and sets parseError when string arguments are invalid JSON", () => {
    const calls = [{ function: { name: "t", arguments: "broken" } }];
    const result = normalizeToolCalls(calls);
    expect(result[0].function).toEqual({ name: "t", arguments: {} });
    expect(typeof result[0].parseError).toBe("string");
    expect(result[0].parseError.length).toBeGreaterThan(0);
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

  it("does not set parseError for valid object arguments", () => {
    const calls = [{ function: { name: "t", arguments: { q: "x" } } }];
    const result = normalizeToolCalls(calls);
    expect(result[0].parseError).toBeUndefined();
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

  it("emits the force-final message when budgetExhausted is true (even with no hardCap)", () => {
    const unlimited = {
      hardCap: null,
      maxToolRounds: 10,
      webSearchNudgeAt: 15,
      budgetExhausted: true,
    };
    const msgs = systemMessagesForRound(0, unlimited);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toMatch(/tool-use limit/i);
  });

  it("suppresses the web-search nudge when budgetExhausted", () => {
    const at = {
      hardCap: null,
      maxToolRounds: 10,
      webSearchNudgeAt: 15,
      budgetExhausted: true,
    };
    const msgs = systemMessagesForRound(15, at);
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
  it("short-circuits to a descriptive error result when a call has parseError, without invoking executeTool", async () => {
    const workingMessages = [];
    const toolCalls = [
      { function: { name: "web_search", arguments: {} }, parseError: "Unexpected token b" },
    ];
    let executed = false;
    const executeTool = async () => {
      executed = true;
      return "should-not-happen";
    };
    const { allFailed } = await runToolCalls(toolCalls, executeTool, workingMessages, {});
    expect(executed).toBe(false);
    expect(allFailed).toBe(true);
    expect(workingMessages[0].role).toBe("tool");
    expect(workingMessages[0].content).toMatch(/could not parse arguments for web_search/);
    expect(workingMessages[0].content).toMatch(/Unexpected token b/);
  });

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
    // All onToolCall callbacks fire upfront in issue order (so every in-flight
    // indicator shows immediately), then onToolResult + workingMessages append
    // in issue order after the batch settles.
    expect(events).toEqual([
      ["call", "web_search", { query: "x" }],
      ["call", "get_current_time", {}],
      ["result", "web_search", "result-for-web_search"],
      ["result", "get_current_time", "result-for-get_current_time"],
    ]);
    expect(workingMessages).toEqual([
      { role: "tool", content: "result-for-web_search" },
      { role: "tool", content: "result-for-get_current_time" },
    ]);
  });

  it("runs a round's calls concurrently (latency ~max, not sum)", async () => {
    const toolCalls = [
      { function: { name: "web_search", arguments: {} } },
      { function: { name: "web_search", arguments: {} } },
      { function: { name: "web_search", arguments: {} } },
    ];
    const delay = 60; // ms per call
    const executeTool = () =>
      new Promise((resolve) => setTimeout(() => resolve("ok"), delay));
    const start = Date.now();
    await runToolCalls(toolCalls, executeTool, [], {});
    const elapsed = Date.now() - start;
    // Serial would take ~3*delay; parallel (cap 3) ~1*delay. Allow scheduler
    // slack but stay well under the serial bound.
    expect(elapsed).toBeLessThan(delay * 2);
  });

  it("appends results in issue order even when a later call resolves first", async () => {
    const workingMessages = [];
    const toolCalls = [
      { function: { name: "slow", arguments: {} } },
      { function: { name: "fast", arguments: {} } },
    ];
    // "slow" resolves after "fast", but results must append in issue order.
    const executeTool = (name) =>
      new Promise((resolve) =>
        setTimeout(
          () => resolve(name === "slow" ? "S" : "F"),
          name === "slow" ? 40 : 5,
        ),
      );
    await runToolCalls(toolCalls, executeTool, workingMessages, {});
    expect(workingMessages).toEqual([
      { role: "tool", content: "S" },
      { role: "tool", content: "F" },
    ]);
  });

  it("passes the call index to onToolCall and onToolResult", async () => {
    const toolCalls = [
      { function: { name: "a", arguments: {} } },
      { function: { name: "b", arguments: {} } },
    ];
    const calls = [];
    const results = [];
    await runToolCalls(toolCalls, async (n) => "r-" + n, [], {
      onToolCall: (n, a, i) => calls.push([n, i]),
      onToolResult: (n, r, i) => results.push([n, i]),
    });
    expect(calls).toEqual([
      ["a", 0],
      ["b", 1],
    ]);
    expect(results).toEqual([
      ["a", 0],
      ["b", 1],
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
