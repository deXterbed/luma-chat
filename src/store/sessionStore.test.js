import { useSessionStore } from "./sessionStore";
import { db } from "../lib/db";
import { getSideChatStore, deleteSideChatStore } from "./chatStore";
import { useSettingsStore } from "./settingsStore";

// Mock the db module
vi.mock("../lib/db", () => ({
  db: {
    loadSessions: vi.fn().mockResolvedValue([]),
    loadSessionMessages: vi
      .fn()
      .mockResolvedValue({ messages: [], sideChats: [] }),
    saveSession: vi.fn().mockResolvedValue(undefined),
    updateSessionActivity: vi.fn().mockResolvedValue(undefined),
    saveMessages: vi.fn().mockResolvedValue(undefined),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    upsertSideChat: vi.fn().mockResolvedValue(undefined),
    saveSideChatMessages: vi.fn().mockResolvedValue(undefined),
    setActiveSideChat: vi.fn().mockResolvedValue(undefined),
    deleteSideChat: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock chatStore
vi.mock("./chatStore", () => ({
  getSideChatStore: vi.fn(),
  deleteSideChatStore: vi.fn(),
}));

describe("sessionStore", () => {
  let store;

  beforeEach(() => {
    store = useSessionStore;
    store.setState({ chatSessions: [], activeChatId: null });
    vi.clearAllMocks();
  });

  describe("setSessionsFromDb", () => {
    it("sets sessions from database", () => {
      const sessions = [
        { id: "1", title: "Session 1", model: "model1", updated_at: 1000 },
        { id: "2", title: "Session 2", model: "model2", updated_at: 2000 },
      ];

      store.getState().setSessionsFromDb(sessions);

      expect(store.getState().chatSessions).toEqual(sessions);
    });
  });

  describe("hydrateSession", () => {
    it("loads messages and side chats for a session", async () => {
      const mockData = {
        messages: [{ id: "m1", role: "user", content: "Hello" }],
        sideChats: [{ id: "sc1", model: "model1", messages: [] }],
      };

      db.loadSessionMessages.mockResolvedValue(mockData);

      const mockLoadMessages = vi.fn();
      const mockSideStore = {
        getState: () => ({ loadMessages: mockLoadMessages }),
      };
      getSideChatStore.mockReturnValue(mockSideStore);

      // Pre-populate a session with a matching side-chat stub
      store.setState({
        chatSessions: [
          {
            id: "session-1",
            title: "Test",
            model: "m",
            sideChats: [{ id: "sc1", model: "model1", messages: [] }],
            activeSideChatId: "sc1",
            updated_at: 1000,
          },
        ],
      });

      await store.getState().hydrateSession("session-1");

      expect(db.loadSessionMessages).toHaveBeenCalledWith("session-1");
      expect(getSideChatStore).toHaveBeenCalledWith("sc1");
      expect(mockLoadMessages).toHaveBeenCalledWith([], "model1");
    });
  });

  describe("setActiveChatId", () => {
    it("sets the active chat id", () => {
      store.getState().setActiveChatId("session-123");
      expect(store.getState().activeChatId).toBe("session-123");
    });
  });

  describe("bumpSessionActivity", () => {
    it("updates session timestamp and reorders", () => {
      const sessions = [
        { id: "1", title: "Old", model: "m", updated_at: 1000 },
        { id: "2", title: "New", model: "m", updated_at: 2000 },
      ];
      store.setState({ chatSessions: sessions });

      store.getState().bumpSessionActivity("1");

      const updated = store.getState().chatSessions;
      expect(updated[0].id).toBe("1");
      expect(updated[0].updated_at).toBeGreaterThan(2000);
    });

    it("does nothing for null/undefined id", () => {
      store.getState().bumpSessionActivity(null);
      store.getState().bumpSessionActivity(undefined);
      // Should not throw
    });
  });

  describe("addChatSession", () => {
    it("adds a new session and saves to db", () => {
      const session = {
        id: "new-1",
        title: "New Session",
        model: "test-model",
      };

      store.getState().addChatSession(session);

      const sessions = store.getState().chatSessions;
      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe("new-1");
      expect(sessions[0].sideChats).toEqual([]);
      expect(sessions[0].activeSideChatId).toBeNull();
      expect(db.saveSession).toHaveBeenCalled();
    });
  });

  describe("updateChatSession", () => {
    it("updates session properties", () => {
      store.setState({
        chatSessions: [
          { id: "1", title: "Old", model: "old-model", updated_at: 1000 },
        ],
      });

      store
        .getState()
        .updateChatSession("1", { title: "New Title", model: "new-model" });

      const session = store.getState().chatSessions[0];
      expect(session.title).toBe("New Title");
      expect(session.model).toBe("new-model");
      expect(db.saveSession).toHaveBeenCalled();
    });

    it("saves messages when provided", () => {
      const messages = [{ id: "m1", role: "user", content: "Hi" }];
      store.setState({
        chatSessions: [
          { id: "1", title: "Test", model: "model", updated_at: 1000 },
        ],
      });

      store.getState().updateChatSession("1", { messages });

      expect(db.saveMessages).toHaveBeenCalledWith("1", messages);
    });
  });

  describe("removeChatSession", () => {
    it("removes session and deletes from db", () => {
      store.setState({
        chatSessions: [
          { id: "1", title: "One", model: "m", sideChats: [{ id: "sc1" }] },
          { id: "2", title: "Two", model: "m", sideChats: [] },
        ],
        activeChatId: "1",
      });

      store.getState().removeChatSession("1");

      expect(store.getState().chatSessions).toHaveLength(1);
      expect(store.getState().chatSessions[0].id).toBe("2");
      expect(store.getState().activeChatId).toBeNull();
      expect(db.deleteSession).toHaveBeenCalledWith("1");
      expect(deleteSideChatStore).toHaveBeenCalledWith("sc1");
    });

    it("keeps activeChatId if removing different session", () => {
      store.setState({
        chatSessions: [
          { id: "1", title: "One", model: "m", sideChats: [] },
          { id: "2", title: "Two", model: "m", sideChats: [] },
        ],
        activeChatId: "2",
      });

      store.getState().removeChatSession("1");

      expect(store.getState().activeChatId).toBe("2");
    });
  });

  describe("addSideChat", () => {
    let mockSetModel;

    beforeEach(() => {
      mockSetModel = vi.fn();
      getSideChatStore.mockReturnValue({
        getState: () => ({ setModel: mockSetModel }),
      });
    });

    it("adds side chat to session", () => {
      store.setState({
        chatSessions: [
          {
            id: "sess-1",
            title: "Test",
            model: "m",
            sideChats: [],
            updated_at: 1000,
          },
        ],
      });

      store.getState().addSideChat("sess-1", "side-model");

      const session = store.getState().chatSessions[0];
      expect(session.sideChats).toHaveLength(1);
      expect(session.sideChats[0].model).toBe("side-model");
      expect(session.activeSideChatId).toBe(session.sideChats[0].id);
      expect(db.upsertSideChat).toHaveBeenCalled();
      expect(db.setActiveSideChat).toHaveBeenCalled();
    });

    it("seeds the chat store model immediately", () => {
      store.setState({
        chatSessions: [
          { id: "sess-1", title: "Test", model: "m", sideChats: [], updated_at: 1000 },
        ],
      });

      store.getState().addSideChat("sess-1", "llama3");

      expect(mockSetModel).toHaveBeenCalledWith("llama3");
    });

    it("falls back to settingsStore defaultModel when no model passed", () => {
      useSettingsStore.setState({ defaultModel: "default-model", hydrated: true });

      store.setState({
        chatSessions: [
          { id: "sess-1", title: "Test", model: "m", sideChats: [], updated_at: 1000 },
        ],
      });

      store.getState().addSideChat("sess-1");

      expect(mockSetModel).toHaveBeenCalledWith("default-model");
    });
  });

  describe("updateSideChat", () => {
    it("updates side chat properties", () => {
      store.setState({
        chatSessions: [
          {
            id: "sess-1",
            title: "Test",
            model: "m",
            sideChats: [{ id: "sc1", model: "old-model", messages: [] }],
            updated_at: 1000,
          },
        ],
      });

      store.getState().updateSideChat("sess-1", "sc1", { model: "new-model" });

      expect(store.getState().chatSessions[0].sideChats[0].model).toBe(
        "new-model",
      );
      expect(db.upsertSideChat).toHaveBeenCalled();
    });

    it("saves messages when provided", () => {
      const messages = [{ id: "m1", role: "user", content: "Hi" }];
      store.setState({
        chatSessions: [
          {
            id: "sess-1",
            title: "Test",
            model: "m",
            sideChats: [{ id: "sc1", model: "model", messages: [] }],
            updated_at: 1000,
          },
        ],
      });

      store.getState().updateSideChat("sess-1", "sc1", { messages });

      expect(db.saveSideChatMessages).toHaveBeenCalledWith("sc1", messages);
    });
  });

  describe("setActiveSideChatId", () => {
    it("sets active side chat id", () => {
      store.setState({
        chatSessions: [
          {
            id: "sess-1",
            title: "Test",
            model: "m",
            sideChats: [{ id: "sc1" }, { id: "sc2" }],
            activeSideChatId: "sc1",
          },
        ],
      });

      store.getState().setActiveSideChatId("sess-1", "sc2");

      expect(store.getState().chatSessions[0].activeSideChatId).toBe("sc2");
      expect(db.setActiveSideChat).toHaveBeenCalledWith("sess-1", "sc2");
    });
  });

  describe("removeSideChat", () => {
    it("removes side chat and updates active if needed", () => {
      store.setState({
        chatSessions: [
          {
            id: "sess-1",
            title: "Test",
            model: "m",
            sideChats: [{ id: "sc1" }, { id: "sc2" }],
            activeSideChatId: "sc1",
          },
        ],
      });

      store.getState().removeSideChat("sess-1", "sc1");

      const session = store.getState().chatSessions[0];
      expect(session.sideChats).toHaveLength(1);
      expect(session.sideChats[0].id).toBe("sc2");
      expect(session.activeSideChatId).toBe("sc2");
      expect(db.deleteSideChat).toHaveBeenCalledWith("sc1");
    });

    it("clears activeSideChatId when removing last side chat", () => {
      store.setState({
        chatSessions: [
          {
            id: "sess-1",
            title: "Test",
            model: "m",
            sideChats: [{ id: "sc1" }],
            activeSideChatId: "sc1",
          },
        ],
      });

      store.getState().removeSideChat("sess-1", "sc1");

      const session = store.getState().chatSessions[0];
      expect(session.sideChats).toHaveLength(0);
      expect(session.activeSideChatId).toBeNull();
    });
  });
});
