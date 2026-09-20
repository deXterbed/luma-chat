import { TOOLS, FILE_TOOL_NAMES, WEB_TOOL_NAMES, executeTool } from "./tools";
import { invoke } from "@tauri-apps/api/core";

describe("tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("TOOLS definitions", () => {
    it("has the six tools defined", () => {
      expect(TOOLS).toHaveLength(6);
    });

    it("names every file tool in FILE_TOOL_NAMES so the loop can filter them", () => {
      for (const name of FILE_TOOL_NAMES) {
        expect(TOOLS.some((t) => t.function.name === name)).toBe(true);
      }
      for (const name of WEB_TOOL_NAMES) {
        expect(TOOLS.some((t) => t.function.name === name)).toBe(true);
      }
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

    it("has the file tools, with no `root` parameter", () => {
      const read = TOOLS.find((t) => t.function.name === "read_file");
      expect(read.function.parameters.required).toContain("path");
      expect(read.function.parameters.properties.offset).toBeDefined();
      expect(read.function.parameters.properties.limit).toBeDefined();

      const search = TOOLS.find((t) => t.function.name === "search_code");
      expect(search.function.parameters.required).toContain("query");
      expect(search.function.parameters.properties.regex).toBeDefined();
      expect(search.function.parameters.properties.no_ignore).toBeDefined();

      expect(TOOLS.some((t) => t.function.name === "list_dir")).toBe(true);

      // `root` stays out of the model-facing schemas until the add-folder UI
      // lands: with one root there is nothing to select, and every extra
      // parameter costs tool-calling reliability.
      for (const name of FILE_TOOL_NAMES) {
        const tool = TOOLS.find((t) => t.function.name === name);
        expect(tool.function.parameters.properties.root).toBeUndefined();
      }
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

    describe("file tools", () => {
      const ROOTS = ["/tmp/project"];

      it("refuses to run with no attached folder instead of invoking Rust", async () => {
        const result = await executeTool("read_file", { path: "a.rs" }, { roots: [] });
        expect(result).toContain("No project folder is attached");
        expect(result.startsWith("Error")).toBe(false);
        expect(invoke).not.toHaveBeenCalled();
      });

      it("passes the roots and the path through to the Rust command", async () => {
        invoke.mockResolvedValue("1→code\n");
        const result = await executeTool(
          "read_file",
          { path: "src/a.rs", offset: 5, limit: 10 },
          { roots: ROOTS },
        );
        expect(result).toBe("1→code\n");
        expect(invoke).toHaveBeenCalledWith("read_file", {
          roots: ROOTS,
          path: "src/a.rs",
          offset: 5,
          limit: 10,
        });
      });

      // A weak model sends strings; a type mismatch would fail the whole invoke
      // and a failed call counts as a failed tool round in the loop policy.
      it("coerces stringly-typed args from weak models", async () => {
        invoke.mockResolvedValue("ok");
        await executeTool(
          "search_code",
          { query: "needle", output: "FILES", regex: "true", limit: "50" },
          { roots: ROOTS },
        );
        expect(invoke).toHaveBeenCalledWith("search_code", {
          roots: ROOTS,
          query: "needle",
          path: undefined,
          glob: undefined,
          output: "files",
          regex: true,
          noIgnore: false,
        });
      });

      it("rejects an unknown output mode and a missing query without invoking", async () => {
        const badMode = await executeTool(
          "search_code",
          { query: "x", output: "nope" },
          { roots: ROOTS },
        );
        expect(invoke).toHaveBeenCalledWith(
          "search_code",
          expect.objectContaining({ output: undefined }),
        );
        expect(badMode).toBe("ok");

        invoke.mockClear();
        const noQuery = await executeTool("search_code", {}, { roots: ROOTS });
        expect(noQuery).toContain("No query given");
        expect(invoke).not.toHaveBeenCalled();

        const noPath = await executeTool("read_file", {}, { roots: ROOTS });
        expect(noPath).toContain("No path given");
        expect(invoke).not.toHaveBeenCalled();
      });

      it("reports an IPC failure as an infrastructure error", async () => {
        invoke.mockRejectedValue(new Error("boom"));
        const result = await executeTool(
          "list_dir",
          { path: "src" },
          { roots: ROOTS },
        );
        expect(result).toContain("Error: file tools unavailable");
      });
    });
  });
});
