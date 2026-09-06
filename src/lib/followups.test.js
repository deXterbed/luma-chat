import { describe, it, expect } from "vitest";
import { buildFollowUpMessages, parseSubtopics } from "./followups";

describe("buildFollowUpMessages", () => {
  it("builds a system + user pair with a JSON-only instruction", () => {
    const msgs = buildFollowUpMessages([
      { role: "user", content: "What is new in AI?" },
      { role: "assistant", content: "GPT-6 launched…" },
    ]);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("system");
    expect(msgs[0].content).toMatch(/JSON/);
    expect(msgs[0].content).toMatch(/1.*3/);
    expect(msgs[1].role).toBe("user");
    expect(msgs[1].content).toContain("What is new in AI?");
    expect(msgs[1].content).toContain("GPT-6 launched");
  });

  it("labels roles as User/Assistant in the transcript", () => {
    const msgs = buildFollowUpMessages([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]);
    expect(msgs[1].content).toMatch(/User: hi/);
    expect(msgs[1].content).toMatch(/Assistant: hello/);
  });

  it("truncates long content to keep the call small", () => {
    const long = "x".repeat(2000);
    const msgs = buildFollowUpMessages([{ role: "assistant", content: long }]);
    expect(msgs[1].content).not.toContain("x".repeat(900));
  });
});

describe("parseSubtopics", () => {
  it("parses a clean JSON object", () => {
    const raw = JSON.stringify({
      subtopics: [
        { title: "A", prompt: "Ask A?" },
        { title: "B", prompt: "Ask B?" },
      ],
    });
    expect(parseSubtopics(raw)).toEqual([
      { title: "A", prompt: "Ask A?" },
      { title: "B", prompt: "Ask B?" },
    ]);
  });

  it("extracts JSON from a ```json fence", () => {
    const raw = 'Here you go:\n```json\n{"subtopics":[{"title":"A","prompt":"Ask A?"}]}\n```\n';
    expect(parseSubtopics(raw)).toEqual([{ title: "A", prompt: "Ask A?" }]);
  });

  it("extracts JSON embedded in prose (first { to last })", () => {
    const raw = 'Sure! {"subtopics":[{"title":"A","prompt":"Ask A?"}]} hope that helps';
    expect(parseSubtopics(raw)).toEqual([{ title: "A", prompt: "Ask A?" }]);
  });

  it("returns [] for non-JSON / empty input", () => {
    expect(parseSubtopics("")).toEqual([]);
    expect(parseSubtopics("no json here at all")).toEqual([]);
    expect(parseSubtopics(null)).toEqual([]);
  });

  it("returns [] for invalid JSON", () => {
    expect(parseSubtopics("{not valid json")).toEqual([]);
  });

  it("filters out items missing title or prompt", () => {
    const raw = JSON.stringify({
      subtopics: [
        { title: "A", prompt: "Ask A?" },
        { title: "B" },
        { prompt: "no title" },
        { title: "  ", prompt: "blank title" },
      ],
    });
    expect(parseSubtopics(raw)).toEqual([{ title: "A", prompt: "Ask A?" }]);
  });

  it("caps at 3 items", () => {
    const raw = JSON.stringify({
      subtopics: [1, 2, 3, 4, 5].map((n) => ({
        title: `T${n}`,
        prompt: `P${n}?`,
      })),
    });
    expect(parseSubtopics(raw)).toHaveLength(3);
  });

  it("trims title and prompt whitespace", () => {
    const raw = JSON.stringify({
      subtopics: [{ title: "  A  ", prompt: "  Ask A?  " }],
    });
    expect(parseSubtopics(raw)).toEqual([{ title: "A", prompt: "Ask A?" }]);
  });
});