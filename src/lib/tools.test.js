import { TOOLS, executeTool } from "./tools";
import { invoke } from "@tauri-apps/api/core";

describe("tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("TOOLS definitions", () => {
    it("has three tools defined", () => {
      expect(TOOLS).toHaveLength(3);
    });

    it("has get_current_time tool", () => {
      const tool = TOOLS.find((t) => t.function.name === "get_current_time");
      expect(tool).toBeDefined();
      expect(tool.type).toBe("function");
      expect(tool.function.description).toContain("current date and time");
      expect(tool.function.parameters.properties.timezone).toBeDefined();
    });

    it("has web_search tool", () => {
      const tool = TOOLS.find((t) => t.function.name === "web_search");
      expect(tool).toBeDefined();
      expect(tool.function.description).toContain("Search the web");
      expect(tool.function.parameters.required).toContain("query");
      expect(tool.function.parameters.properties.max_results).toBeDefined();
    });

    it("has web_fetch tool", () => {
      const tool = TOOLS.find((t) => t.function.name === "web_fetch");
      expect(tool).toBeDefined();
      expect(tool.function.description).toContain("Fetch the contents");
      expect(tool.function.parameters.required).toContain("url");
    });
  });

  describe("executeTool", () => {
    it("executes get_current_time with default timezone", async () => {
      const result = await executeTool("get_current_time", {});

      const parsed = JSON.parse(result);
      expect(parsed.timezone).toBeDefined();
      expect(parsed.iso_utc).toBeDefined();
      expect(parsed.local_time).toBeDefined();
      // Validate ISO format
      expect(new Date(parsed.iso_utc).toISOString()).toBe(parsed.iso_utc);
    });

    it("executes get_current_time with specified timezone", async () => {
      const result = await executeTool("get_current_time", {
        timezone: "America/New_York",
      });

      const parsed = JSON.parse(result);
      expect(parsed.timezone).toBe("America/New_York");
      expect(parsed.iso_utc).toBeDefined();
      expect(parsed.local_time).toBeDefined();
    });

    it("returns error for web_search when tauri not available", async () => {
      invoke.mockRejectedValue(new Error("Tauri not available"));
      const result = await executeTool("web_search", { query: "test" });
      expect(result).toBe(
        "Error: web tools are not available in this environment",
      );
    });

    it("returns error for web_fetch when tauri not available", async () => {
      invoke.mockRejectedValue(new Error("Tauri not available"));
      const result = await executeTool("web_fetch", {
        url: "http://example.com",
      });
      expect(result).toBe(
        "Error: web tools are not available in this environment",
      );
    });

    it("returns error for unknown tool", async () => {
      const result = await executeTool("unknown_tool", {});
      expect(result).toBe('Error: unknown tool "unknown_tool"');
    });
  });
});
