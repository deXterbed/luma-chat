import { isOllamaReachable, listLocalModels, isVisionModel, fileToBase64, streamChat } from "./ollama";

describe("ollama utilities", () => {
  describe("isVisionModel", () => {
    it("returns true for known vision models", () => {
      expect(isVisionModel("minimax")).toBe(true);
      expect(isVisionModel("qwen2.5vl")).toBe(true);
      expect(isVisionModel("llava")).toBe(true);
      expect(isVisionModel("gemma3")).toBe(true);
      expect(isVisionModel("phi3.5-vision")).toBe(true);
      expect(isVisionModel("pixtral")).toBe(true);
    });

    it("returns true for vision models with version suffixes", () => {
      expect(isVisionModel("llava:latest")).toBe(true);
      expect(isVisionModel("qwen2-vl:7b")).toBe(true);
      expect(isVisionModel("minimax-m3:cloud")).toBe(true);
    });

    it("returns false for non-vision models", () => {
      expect(isVisionModel("llama3")).toBe(false);
      expect(isVisionModel("mistral")).toBe(false);
      expect(isVisionModel("codellama")).toBe(false);
      expect(isVisionModel("unknown-model")).toBe(false);
    });

    it("is case insensitive", () => {
      expect(isVisionModel("LLAVA")).toBe(true);
      expect(isVisionModel("Llama3")).toBe(false);
    });
  });

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
