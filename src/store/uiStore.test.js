import { useUiStore } from "./uiStore";
import { db } from "../lib/db";
import { act } from "react";

// Mock db
vi.mock("../lib/db", () => ({
  db: {
    addCustomModel: vi.fn(),
    removeCustomModel: vi.fn(),
  },
}));

describe("uiStore", () => {
  let store;

  beforeEach(() => {
    store = useUiStore;
    // Reset to defaults
    store.setState({
      sideChatOpen: false,
      ollamaConnected: false,
      availableModels: [],
      customModels: [],
      theme: "dark",
      sideChatPrefill: null,
    });
    vi.clearAllMocks();
  });

  describe("theme", () => {
    it("has default theme dark", () => {
      expect(store.getState().theme).toBe("dark");
    });

    it("sets theme", () => {
      store.getState().setTheme("light");
      expect(store.getState().theme).toBe("light");
    });

    it("toggles theme", () => {
      store.getState().setTheme("dark");
      store.getState().toggleTheme();
      expect(store.getState().theme).toBe("light");

      store.getState().toggleTheme();
      expect(store.getState().theme).toBe("dark");
    });
  });

  describe("sideChatOpen", () => {
    it("has default sideChatOpen false", () => {
      expect(store.getState().sideChatOpen).toBe(false);
    });

    it("sets side chat open state", () => {
      store.getState().setSideChatOpen(true);
      expect(store.getState().sideChatOpen).toBe(true);

      store.getState().setSideChatOpen(false);
      expect(store.getState().sideChatOpen).toBe(false);
    });

    it("toggles side chat", () => {
      store.getState().toggleSideChat();
      expect(store.getState().sideChatOpen).toBe(true);

      store.getState().toggleSideChat();
      expect(store.getState().sideChatOpen).toBe(false);
    });
  });

  describe("ollamaConnected", () => {
    it("has default ollamaConnected false", () => {
      expect(store.getState().ollamaConnected).toBe(false);
    });

    it("sets ollama connected state", () => {
      store.getState().setOllamaConnected(true);
      expect(store.getState().ollamaConnected).toBe(true);

      store.getState().setOllamaConnected(false);
      expect(store.getState().ollamaConnected).toBe(false);
    });
  });

  describe("availableModels", () => {
    it("has default empty array", () => {
      expect(store.getState().availableModels).toEqual([]);
    });

    it("sets available models", () => {
      const models = ["model1", "model2"];
      store.getState().setAvailableModels(models);
      expect(store.getState().availableModels).toEqual(models);
      expect(store.getState().ollamaConnected).toBe(true);
    });
  });

  describe("customModels", () => {
    it("has default empty array", () => {
      expect(store.getState().customModels).toEqual([]);
    });

    it("adds custom model", () => {
      act(() => {
        store.getState().addCustomModel("custom-model");
      });
      expect(store.getState().customModels).toContain("custom-model");
      expect(db.addCustomModel).toHaveBeenCalledWith("custom-model");
    });

    it("does not add empty custom model", () => {
      act(() => {
        store.getState().addCustomModel("   ");
      });
      expect(store.getState().customModels).toEqual([]);
    });

    it("does not add duplicate custom model", () => {
      act(() => {
        store.getState().addCustomModel("model1");
        store.getState().addCustomModel("model1");
      });
      expect(store.getState().customModels.filter(m => m === "model1")).toHaveLength(1);
    });

    it("removes custom model", () => {
      store.setState({ customModels: ["model1", "model2"] });
      act(() => {
        store.getState().removeCustomModel("model1");
      });
      expect(store.getState().customModels).toEqual(["model2"]);
      expect(db.removeCustomModel).toHaveBeenCalledWith("model1");
    });
  });

  describe("sideChatPrefill", () => {
    it("has default null", () => {
      expect(store.getState().sideChatPrefill).toBeNull();
    });

    it("sets side chat prefill", () => {
      store.getState().setSideChatPrefill("prefill text");
      expect(store.getState().sideChatPrefill).toBe("prefill text");
    });

    it("clears side chat prefill", () => {
      store.getState().setSideChatPrefill("text");
      store.getState().clearSideChatPrefill();
      expect(store.getState().sideChatPrefill).toBeNull();
    });
  });
});
