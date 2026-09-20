import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createAgentLogger,
  contextChars,
  summarize,
  summarizeToolResult,
} from "./agentLog";

// `flush` is injected, so these tests never touch Tauri IPC.
function makeLogger({ enabled = true, flush = vi.fn().mockResolvedValue(undefined), echo = false } = {}) {
  return { log: createAgentLogger({ enabled, flush, echo }), flush };
}

const parse = (lines) => lines.map((l) => JSON.parse(l));

describe("createAgentLogger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is a total no-op when disabled", async () => {
    const flush = vi.fn();
    const log = createAgentLogger({ enabled: false, flush, echo: false });

    expect(log.enabled).toBe(false);
    log.event("stream.start", { model: "m" });
    await log.flush();

    expect(flush).not.toHaveBeenCalled();
  });

  it("buffers events and writes them as JSON lines on flush", async () => {
    const { log, flush } = makeLogger();
    log.event("round.start", { round: 0, injected: [] });
    log.event("tool", { name: "read_file", kind: "ok" });
    expect(flush).not.toHaveBeenCalled(); // nothing written until a flush

    await log.flush();

    expect(flush).toHaveBeenCalledTimes(1);
    const [lines] = flush.mock.calls[0];
    expect(lines).toHaveLength(2);
    const events = parse(lines);
    expect(events[0]).toMatchObject({ t: "round.start", round: 0 });
    expect(events[1]).toMatchObject({ t: "tool", name: "read_file" });
    expect(typeof events[0].ts).toBe("number");
  });

  it("flushes on its own once the buffer reaches the batch size", async () => {
    const { log, flush } = makeLogger();
    for (let i = 0; i < 39; i++) log.event("tool", { i });
    expect(flush).not.toHaveBeenCalled();

    log.event("tool", { i: 39 });
    await log.flush();

    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush.mock.calls[0][0]).toHaveLength(40);
  });

  it("keeps events buffered until flushed (a run can be flushed per round)", async () => {
    const { log, flush } = makeLogger();
    log.event("round.start", { round: 0 });
    await log.flush();
    log.event("round.start", { round: 1 });
    await log.flush();

    expect(flush).toHaveBeenCalledTimes(2);
    expect(parse(flush.mock.calls[0][0])[0].round).toBe(0);
    expect(parse(flush.mock.calls[1][0])[0].round).toBe(1);
  });

  it("flushing twice with nothing new does not re-write", async () => {
    const { log, flush } = makeLogger();
    log.event("stream.end", { reason: "final" });
    await log.flush();
    await log.flush();
    expect(flush).toHaveBeenCalledTimes(1);
  });

  // `subtopics` fires after `stream.end`, from a fire-and-forget call. Nothing
  // else would ever flush it: it would sit in the buffer until a *later* run
  // filled the batch, then land appended to that run's lines, out of order.
  it("writes a post-run event immediately instead of stranding it", async () => {
    const { log, flush } = makeLogger();
    log.event("stream.end", { reason: "final" });
    await log.flush();
    flush.mockClear();

    log.event("subtopics", { ok: true, count: 3, ms: 1200 });
    await log.flush();

    expect(flush).toHaveBeenCalledTimes(1);
    expect(parse(flush.mock.calls[0][0])[0]).toMatchObject({ t: "subtopics" });
  });

  // Logging must never be able to break a chat turn.
  it("swallows a failing write instead of rejecting", async () => {
    const flush = vi.fn().mockRejectedValue(new Error("disk full"));
    const log = createAgentLogger({ enabled: true, flush, echo: false });

    log.event("tool", { name: "read_file" });
    await expect(log.flush()).resolves.toBeUndefined();
  });

  it("drops an event whose payload cannot be serialized", async () => {
    const { log, flush } = makeLogger();
    const circular = {};
    circular.self = circular;

    expect(() => log.event("tool", { circular })).not.toThrow();
    log.event("tool", { name: "ok" });
    await log.flush();

    const lines = flush.mock.calls[0][0];
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).name).toBe("ok");
  });
});

describe("summarize", () => {
  it("keeps short text whole", () => {
    expect(summarize("hello", 10)).toEqual({ chars: 5, head: "hello" });
  });

  it("adds a tail only when the tail carries information", () => {
    // A read_file result puts its "continue with offset=N" notice at the END,
    // which is exactly why result summaries keep a tail.
    const long = "a".repeat(700) + "CONTINUE-WITH-OFFSET";
    const out = summarizeToolResult(long);
    expect(out.chars).toBe(long.length);
    expect(out.head).toHaveLength(400);
    expect(out.tail).toContain("CONTINUE-WITH-OFFSET");
  });

  it("does not duplicate a body that is barely longer than head + tail", () => {
    const out = summarizeToolResult("x".repeat(401));
    expect(out.tail).toBeUndefined();
  });

  it("handles non-string results without throwing", () => {
    expect(summarize(null).chars).toBe(0);
    expect(summarize(undefined).head).toBe("");
    expect(summarize({ a: 1 }).head).toBe("[object Object]");
  });
});

describe("contextChars", () => {
  it("counts message content and tool-call arguments", () => {
    const messages = [
      { role: "system", content: "12345" }, // 5
      { role: "user", content: "123" }, // 3
      {
        role: "assistant",
        content: "",
        tool_calls: [{ function: { name: "read_file", arguments: { path: "a" } } }],
      },
    ];
    const expected = 5 + 3 + JSON.stringify({ path: "a" }).length;
    expect(contextChars(messages)).toBe(expected);
  });

  it("is 0 for an empty or missing array", () => {
    expect(contextChars([])).toBe(0);
    expect(contextChars(undefined)).toBe(0);
  });
});
