import { isOllamaReachable, listLocalModels, fileToBase64, streamChat } from "./ollama";

describe("ollama utilities", () => {
  describe("fileToBase64", () => {
    it("converts file to base64", async () => {
      const content = "test file content";
      const file = new File([content], "test.txt", { type: "text/plain" });

      const result = await fileToBase64(file);
      expect(result).toBeDefined();
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });

    it("handles empty file", async () => {
      const file = new File([""], "empty.txt", { type: "text/plain" });
      const result = await fileToBase64(file);
      expect(result).toBeDefined();
    });
  });

  describe("isOllamaReachable and listLocalModels", () => {
    it("are async functions", () => {
      expect(typeof isOllamaReachable).toBe("function");
      expect(typeof listLocalModels).toBe("function");
      expect(isOllamaReachable.constructor.name).toBe("AsyncFunction");
      expect(listLocalModels.constructor.name).toBe("AsyncFunction");
    });
  });

  describe("streamChat", () => {
    it("is an async function", () => {
      expect(typeof streamChat).toBe("function");
      expect(streamChat.constructor.name).toBe("AsyncFunction");
    });
  });
});
