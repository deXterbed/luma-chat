import { buildMainChatSystemPrompt, buildSideChatSystemPrompt } from "./systemPrompt";

const FIXED_DATE = new Date("2026-06-12T10:00:00Z");

describe("buildMainChatSystemPrompt", () => {
  it("includes web tool names when web search is enabled", () => {
    const prompt = buildMainChatSystemPrompt(true, FIXED_DATE);
    expect(prompt).toContain("web_search");
    expect(prompt).toContain("web_fetch");
  });

  it("does not invite the model to use web tools when disabled", () => {
    const prompt = buildMainChatSystemPrompt(false, FIXED_DATE);
    expect(prompt).not.toContain("use your tools (get_current_time, web_search, web_fetch)");
  });

  it("explicitly forbids web tools when disabled", () => {
    const prompt = buildMainChatSystemPrompt(false, FIXED_DATE);
    expect(prompt).toContain("Do not call web_search or web_fetch");
  });

  it("defaults to web search enabled", () => {
    const prompt = buildMainChatSystemPrompt(undefined, FIXED_DATE);
    expect(prompt).toContain("web_search");
  });

  it("injects the current date", () => {
    const prompt = buildMainChatSystemPrompt(true, FIXED_DATE);
    expect(prompt).toContain("2026-06-12");
  });
});

describe("buildSideChatSystemPrompt", () => {
  it("includes web tool guidance when web search is enabled", () => {
    const prompt = buildSideChatSystemPrompt(true, FIXED_DATE);
    expect(prompt).toContain("use your tools");
    expect(prompt).not.toContain("Do not call web_search");
  });

  it("explicitly forbids web tools when disabled", () => {
    const prompt = buildSideChatSystemPrompt(false, FIXED_DATE);
    expect(prompt).toContain("Do not call web_search or web_fetch");
  });

  it("defaults to web search enabled", () => {
    const prompt = buildSideChatSystemPrompt(undefined, FIXED_DATE);
    expect(prompt).not.toContain("Do not call web_search");
  });

  it("injects the current date", () => {
    const prompt = buildSideChatSystemPrompt(true, FIXED_DATE);
    expect(prompt).toContain("2026-06-12");
  });
});
