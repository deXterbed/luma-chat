import { db } from "./db";
import { invoke } from "@tauri-apps/api/core";

describe("db (frontend wrapper)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("loadSessions", () => {
    it("invokes load_sessions command", async () => {
      const mockSessions = [{ id: "1", title: "Test", model: "model" }];
      invoke.mockResolvedValue(mockSessions);

      const result = await db.loadSessions();

      expect(invoke).toHaveBeenCalledWith("load_sessions", {});
      expect(result).toEqual(mockSessions);
    });
  });

  describe("loadSessionMessages", () => {
    it("invokes load_session_messages command", async () => {
      const mockData = { messages: [], sideChats: [] };
      invoke.mockResolvedValue(mockData);

      const result = await db.loadSessionMessages("session-1");

      expect(invoke).toHaveBeenCalledWith("load_session_messages", {
        sessionId: "session-1",
      });
      expect(result).toEqual(mockData);
    });
  });

  describe("saveSession", () => {
    it("invokes save_session command", async () => {
      invoke.mockResolvedValue(undefined);

      await db.saveSession({ id: "1", title: "Test", model: "model" });

      expect(invoke).toHaveBeenCalledWith("save_session", {
        id: "1",
        title: "Test",
        model: "model",
      });
    });
  });

  describe("saveMessages", () => {
    it("invokes save_messages command", async () => {
      const messages = [{ id: "m1", role: "user", content: "Hi" }];
      invoke.mockResolvedValue(undefined);

      await db.saveMessages("session-1", messages);

      expect(invoke).toHaveBeenCalledWith("save_messages", {
        sessionId: "session-1",
        messages,
      });
    });
  });

  describe("deleteSession", () => {
    it("invokes delete_session command", async () => {
      invoke.mockResolvedValue(undefined);

      await db.deleteSession("session-1");

      expect(invoke).toHaveBeenCalledWith("delete_session", {
        id: "session-1",
      });
    });
  });

  describe("upsertSideChat", () => {
    it("invokes upsert_side_chat command", async () => {
      invoke.mockResolvedValue(undefined);

      await db.upsertSideChat("session-1", { id: "sc1", model: "model" }, 0);

      expect(invoke).toHaveBeenCalledWith("upsert_side_chat", {
        sessionId: "session-1",
        sideChat: { id: "sc1", model: "model" },
        position: 0,
      });
    });
  });

  describe("saveSideChatMessages", () => {
    it("invokes save_side_chat_messages command", async () => {
      const messages = [{ id: "m1", role: "user", content: "Hi" }];
      invoke.mockResolvedValue(undefined);

      await db.saveSideChatMessages("sc1", messages);

      expect(invoke).toHaveBeenCalledWith("save_side_chat_messages", {
        sideChatId: "sc1",
        messages,
      });
    });
  });

  describe("setActiveSideChat", () => {
    it("invokes set_active_side_chat command", async () => {
      invoke.mockResolvedValue(undefined);

      await db.setActiveSideChat("session-1", "sc1");

      expect(invoke).toHaveBeenCalledWith("set_active_side_chat", {
        sessionId: "session-1",
        sideChatId: "sc1",
      });
    });

    it("passes null for sideChatId when clearing", async () => {
      invoke.mockResolvedValue(undefined);

      await db.setActiveSideChat("session-1", null);

      expect(invoke).toHaveBeenCalledWith("set_active_side_chat", {
        sessionId: "session-1",
        sideChatId: null,
      });
    });
  });

  describe("deleteSideChat", () => {
    it("invokes delete_side_chat command", async () => {
      invoke.mockResolvedValue(undefined);

      await db.deleteSideChat("sc1");

      expect(invoke).toHaveBeenCalledWith("delete_side_chat", { id: "sc1" });
    });
  });

  describe("loadCustomModels", () => {
    it("invokes load_custom_models command", async () => {
      const models = ["model1", "model2"];
      invoke.mockResolvedValue(models);

      const result = await db.loadCustomModels();

      expect(invoke).toHaveBeenCalledWith("load_custom_models", {});
      expect(result).toEqual(models);
    });
  });

  describe("addCustomModel", () => {
    it("invokes add_custom_model command", async () => {
      invoke.mockResolvedValue(undefined);

      await db.addCustomModel("new-model");

      expect(invoke).toHaveBeenCalledWith("add_custom_model", {
        name: "new-model",
      });
    });
  });

  describe("removeCustomModel", () => {
    it("invokes remove_custom_model command", async () => {
      invoke.mockResolvedValue(undefined);

      await db.removeCustomModel("model1");

      expect(invoke).toHaveBeenCalledWith("remove_custom_model", {
        name: "model1",
      });
    });
  });
});

describe("settings", () => {
  describe("loadSettings", () => {
    it("invokes load_settings and returns the result", async () => {
      const stored = { theme: "light", defaultModel: "llama3.1:8b" };
      invoke.mockResolvedValue(stored);

      const result = await db.loadSettings();

      expect(invoke).toHaveBeenCalledWith("load_settings", {});
      expect(result).toEqual(stored);
    });

    it("returns an empty object when the invoke returns null", async () => {
      // db.loadSettings is called in environments where Tauri isn't
      // available (e.g. browser-only dev mode). The wrapper normalizes
      // the null to {} so callers don't have to.
      invoke.mockResolvedValue(null);

      const result = await db.loadSettings();

      expect(result).toEqual({});
    });
  });

  describe("saveSetting", () => {
    it("invokes save_setting with key and value", async () => {
      invoke.mockResolvedValue(undefined);

      await db.saveSetting("theme", "dark");

      expect(invoke).toHaveBeenCalledWith("save_setting", {
        key: "theme",
        value: "dark",
      });
    });

    it("swallows errors so callers don't have to", async () => {
      // The settings store calls saveSetting on every change and would
      // rather skip persistence than break the UI on a transient Tauri
      // error. The .catch(noop) in the wrapper is the contract.
      invoke.mockRejectedValue(new Error("ipc gone"));

      await expect(db.saveSetting("theme", "dark")).resolves.toBeUndefined();
    });
  });
});
