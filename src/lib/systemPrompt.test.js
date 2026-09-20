import { buildMainChatSystemPrompt, buildSideChatSystemPrompt } from "./systemPrompt";

const FIXED_DATE = new Date("2026-06-12T10:00:00Z");

describe("buildMainChatSystemPrompt", () => {
  it("includes web tool names when web search is enabled", () => {
    const prompt = buildMainChatSystemPrompt({
      webSearchEnabled: true,
      now: FIXED_DATE,
    });
    expect(prompt).toContain("web_search");
    expect(prompt).toContain("web_fetch");
  });

  it("does not invite the model to use web tools when disabled", () => {
    const prompt = buildMainChatSystemPrompt({
      webSearchEnabled: false,
      now: FIXED_DATE,
    });
    expect(prompt).not.toContain(
      "use your tools (get_current_time, web_search, web_fetch)",
    );
  });

  it("explicitly forbids web tools when disabled", () => {
    const prompt = buildMainChatSystemPrompt({
      webSearchEnabled: false,
      now: FIXED_DATE,
    });
    expect(prompt).toContain("Do not call web_search or web_fetch");
  });

  it("defaults to web search enabled", () => {
    const prompt = buildMainChatSystemPrompt({ now: FIXED_DATE });
    expect(prompt).toContain("web_search");
  });

  it("injects the current date", () => {
    const prompt = buildMainChatSystemPrompt({
      webSearchEnabled: true,
      now: FIXED_DATE,
    });
    expect(prompt).toContain("2026-06-12");
  });

  it("does not mention file tools in ordinary chat mode", () => {
    const prompt = buildMainChatSystemPrompt({ now: FIXED_DATE });
    expect(prompt).not.toContain("read_file");
    expect(prompt).not.toContain("search_code");
  });
});

describe("both prompts in codebase mode", () => {
  // The chat-mode wording would actively fight repository exploration if it
  // leaked into codebase mode: it forbids mentioning failures and caps the
  // response at 8 tool calls.
  const cases = [
    ["main", (options) => buildMainChatSystemPrompt(options)],
    ["side", (options) => buildSideChatSystemPrompt(options)],
  ];

  for (const [label, build] of cases) {
    it(`${label}: names the file tools and keeps paths relative`, () => {
      const prompt = build({ codebase: true, now: FIXED_DATE });
      expect(prompt).toContain("read_file");
      expect(prompt).toContain("search_code");
      expect(prompt).toContain("list_dir");
      expect(prompt).toContain("relative to the project root");
    });

    it(`${label}: drops the chat-mode failure-hiding and call-cap wording`, () => {
      const prompt = build({ codebase: true, now: FIXED_DATE });
      expect(prompt).not.toContain("Never mention tool failures");
      expect(prompt).not.toContain("no more than 8 tool calls");
      expect(prompt).toContain("try a different path or query");
    });

    it(`${label}: still applies those clauses in chat mode`, () => {
      const prompt = build({ codebase: false, now: FIXED_DATE });
      expect(prompt).toContain("Never mention tool failures");
      expect(prompt).not.toContain("relative to the project root");
    });
  }
});

describe("buildSideChatSystemPrompt", () => {
  it("includes web tool guidance when web search is enabled", () => {
    const prompt = buildSideChatSystemPrompt({
      webSearchEnabled: true,
      now: FIXED_DATE,
    });
    expect(prompt).toContain("use your tools");
    expect(prompt).not.toContain("Do not call web_search");
  });

  it("explicitly forbids web tools when disabled", () => {
    const prompt = buildSideChatSystemPrompt({
      webSearchEnabled: false,
      now: FIXED_DATE,
    });
    expect(prompt).toContain("Do not call web_search or web_fetch");
  });

  it("defaults to web search enabled", () => {
    const prompt = buildSideChatSystemPrompt({ now: FIXED_DATE });
    expect(prompt).not.toContain("Do not call web_search");
  });

  it("injects the current date", () => {
    const prompt = buildSideChatSystemPrompt({
      webSearchEnabled: true,
      now: FIXED_DATE,
    });
    expect(prompt).toContain("2026-06-12");
  });
});
