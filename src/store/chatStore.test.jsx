import { act } from "react";
import {
  createChatStore,
  useMainChat,
  getSideChatStore,
  deleteSideChatStore,
} from "./chatStore";
import { useSettingsStore } from "./settingsStore";

describe("chatStore", () => {
  let store;

  beforeEach(() => {
    store = createChatStore("test");
    // Clear any existing state
    store.getState().clearMessages();
    store.getState().setError(null);
  });

  describe("addMessage", () => {
    it("adds a user message", () => {
      const id = store.getState().addMessage("user", "Hello");
      const messages = store.getState().messages;

      expect(messages).toHaveLength(1);
      expect(messages[0].id).toBe(id);
      expect(messages[0].role).toBe("user");
      expect(messages[0].content).toBe("Hello");
      expect(messages[0].images).toEqual([]);
      expect(messages[0].isStreaming).toBe(false);
    });

    it("adds a message with images", () => {
      const images = ["base64image1", "base64image2"];
      store.getState().addMessage("user", "Look at this", images);
      const messages = store.getState().messages;

      expect(messages[0].images).toEqual(images);
    });

    it("adds an assistant message", () => {
      store.getState().addMessage("assistant", "Hi there!");
      expect(store.getState().messages[0].role).toBe("assistant");
    });
  });

  describe("addStreamingMessage", () => {
    it("adds a streaming assistant message", () => {
      const id = store.getState().addStreamingMessage();
      const messages = store.getState().messages;

      expect(messages).toHaveLength(1);
      expect(messages[0].id).toBe(id);
      expect(messages[0].role).toBe("assistant");
      expect(messages[0].content).toBe("");
      expect(messages[0].isStreaming).toBe(true);
      expect(store.getState().isStreaming).toBe(true);
    });
  });

  describe("updateStreamingMessage", () => {
    it("updates streaming message content", () => {
      const id = store.getState().addStreamingMessage();
      store.getState().updateStreamingMessage(id, "Hello");
      store.getState().updateStreamingMessage(id, "Hello world");

      expect(store.getState().messages[0].content).toBe("Hello world");
    });

    it("does not affect non-streaming messages", () => {
      const id1 = store.getState().addMessage("assistant", "Static");
      const id2 = store.getState().addStreamingMessage();
      store.getState().updateStreamingMessage(id2, "Streaming");

      expect(store.getState().messages[0].content).toBe("Static");
      expect(store.getState().messages[1].content).toBe("Streaming");
    });
  });

  describe("tool calls", () => {
    it("adds a tool call to a message", () => {
      const msgId = store.getState().addMessage("assistant", "I'll search");
      const callId = store
        .getState()
        .addToolCall(msgId, "web_search", { query: "test" });

      const messages = store.getState().messages;
      expect(messages[0].toolCalls).toHaveLength(1);
      expect(messages[0].toolCalls[0].id).toBe(callId);
      expect(messages[0].toolCalls[0].name).toBe("web_search");
      expect(messages[0].toolCalls[0].args).toEqual({ query: "test" });
      expect(messages[0].toolCalls[0].status).toBe("pending");
    });

    it("completes a tool call with result", () => {
      const msgId = store.getState().addMessage("assistant", "I'll search");
      const callId = store
        .getState()
        .addToolCall(msgId, "web_search", { query: "test" });

      store
        .getState()
        .completeToolCall(msgId, callId, { result: "Search results" });

      const call = store.getState().messages[0].toolCalls[0];
      expect(call.status).toBe("done");
      expect(call.resultPreview).toBe("Search results");
      expect(call.completedAt).toBeDefined();
    });

    it("completes a tool call with error", () => {
      const msgId = store.getState().addMessage("assistant", "I'll search");
      const callId = store
        .getState()
        .addToolCall(msgId, "web_search", { query: "test" });

      store
        .getState()
        .completeToolCall(msgId, callId, { error: "Network error" });

      const call = store.getState().messages[0].toolCalls[0];
      expect(call.status).toBe("error");
      expect(call.error).toBe("Network error");
    });

    it("handles multiple tool calls on same message", () => {
      const msgId = store.getState().addMessage("assistant", "I'll search");
      const callId1 = store
        .getState()
        .addToolCall(msgId, "web_search", { query: "test1" });
      const callId2 = store
        .getState()
        .addToolCall(msgId, "web_fetch", { url: "http://example.com" });

      store.getState().completeToolCall(msgId, callId1, { result: "Result 1" });
      store.getState().completeToolCall(msgId, callId2, { result: "Result 2" });

      const calls = store.getState().messages[0].toolCalls;
      expect(calls).toHaveLength(2);
      expect(calls[0].status).toBe("done");
      expect(calls[1].status).toBe("done");
    });
  });

  describe("finalizeMessage", () => {
    it("finalizes a streaming message", () => {
      const id = store.getState().addStreamingMessage();
      store.getState().updateStreamingMessage(id, "Hello world");
      store.getState().finalizeMessage(id, "Final content");

      const messages = store.getState().messages;
      expect(messages[0].content).toBe("Final content");
      expect(messages[0].isStreaming).toBe(false);
      expect(store.getState().isStreaming).toBe(false);
      expect(store.getState().abortController).toBeNull();
    });
  });

  describe("setError / clearError", () => {
    it("sets and clears error", () => {
      store.getState().setError("Something went wrong");
      expect(store.getState().error).toBe("Something went wrong");
      expect(store.getState().isStreaming).toBe(false);

      store.getState().clearError();
      expect(store.getState().error).toBeNull();
    });
  });

  describe("stopStreaming", () => {
    it("stops streaming and clears abort controller", () => {
      const ctrl = { abort: vi.fn() };
      store.getState().setAbortController(ctrl);
      store.getState().addStreamingMessage();

      store.getState().stopStreaming();

      expect(ctrl.abort).toHaveBeenCalled();
      expect(store.getState().isStreaming).toBe(false);
      expect(store.getState().abortController).toBeNull();
      expect(store.getState().messages[0].isStreaming).toBe(false);
    });

    it("handles missing abort controller", () => {
      store.getState().addStreamingMessage();
      store.getState().stopStreaming(); // Should not throw
      expect(store.getState().isStreaming).toBe(false);
    });
  });

  describe("clearMessages", () => {
    it("clears all messages and error", () => {
      store.getState().addMessage("user", "Hello");
      store.getState().setError("Error");
      store.getState().clearMessages();

      expect(store.getState().messages).toHaveLength(0);
      expect(store.getState().error).toBeNull();
    });

    it("bumps focusNonce so the input auto-focuses", () => {
      const start = store.getState().focusNonce;
      store.getState().clearMessages();
      expect(store.getState().focusNonce).toBe(start + 1);
      store.getState().clearMessages();
      expect(store.getState().focusNonce).toBe(start + 2);
    });
  });

  describe("bumpFocus", () => {
    it("increments focusNonce without touching other state", () => {
      store.getState().addMessage("user", "Hello");
      const before = {
        focusNonce: store.getState().focusNonce,
        messages: store.getState().messages,
        model: store.getState().model,
      };
      store.getState().bumpFocus();
      const after = store.getState();
      expect(after.focusNonce).toBe(before.focusNonce + 1);
      expect(after.messages).toEqual(before.messages);
      expect(after.model).toBe(before.model);
    });
  });

  describe("editMessage", () => {
    it("edits a message content", () => {
      const id = store.getState().addMessage("user", "Original");
      store.getState().editMessage(id, "Edited");

      expect(store.getState().messages[0].content).toBe("Edited");
    });

    it("does not affect other messages", () => {
      const id1 = store.getState().addMessage("user", "First");
      const id2 = store.getState().addMessage("user", "Second");
      store.getState().editMessage(id1, "Edited first");

      expect(store.getState().messages[0].content).toBe("Edited first");
      expect(store.getState().messages[1].content).toBe("Second");
    });
  });

  describe("truncateAfter", () => {
    it("removes messages after the given id", () => {
      const id1 = store.getState().addMessage("user", "First");
      const id2 = store.getState().addMessage("assistant", "Second");
      const id3 = store.getState().addMessage("user", "Third");
      const id4 = store.getState().addMessage("assistant", "Fourth");

      store.getState().truncateAfter(id2);

      const messages = store.getState().messages;
      expect(messages).toHaveLength(2);
      expect(messages[0].id).toBe(id1);
      expect(messages[1].id).toBe(id2);
    });

    it("keeps all messages if id not found", () => {
      store.getState().addMessage("user", "First");
      store.getState().addMessage("assistant", "Second");
      store.getState().truncateAfter("non-existent");

      expect(store.getState().messages).toHaveLength(2);
    });
  });

  describe("loadMessages", () => {
    it("loads messages and model", () => {
      const messages = [
        {
          id: "1",
          role: "user",
          content: "Hello",
          isStreaming: false,
          toolCalls: [],
        },
        {
          id: "2",
          role: "assistant",
          content: "Hi!",
          isStreaming: false,
          toolCalls: [],
        },
      ];
      store.getState().loadMessages(messages, "test-model");

      expect(store.getState().messages).toEqual(messages);
      expect(store.getState().model).toBe("test-model");
      expect(store.getState().error).toBeNull();
      expect(store.getState().isStreaming).toBe(false);
      expect(store.getState().abortController).toBeNull();
    });
  });

  describe("getApiMessages", () => {
    it("returns messages formatted for API", () => {
      store.getState().addMessage("user", "Hello", ["img1"]);
      store.getState().addMessage("assistant", "Hi there");

      const apiMessages = store.getState().getApiMessages();

      expect(apiMessages).toHaveLength(2);
      expect(apiMessages[0]).toEqual({
        role: "user",
        content: "Hello",
        images: ["img1"],
      });
      expect(apiMessages[1]).toEqual({
        role: "assistant",
        content: "Hi there",
      });
    });

    it("filters out empty streaming messages", () => {
      store.getState().addMessage("user", "Hello");
      store.getState().addStreamingMessage(); // Empty streaming message

      const apiMessages = store.getState().getApiMessages();

      expect(apiMessages).toHaveLength(1);
      expect(apiMessages[0].role).toBe("user");
    });

    it("includes streaming messages with content", () => {
      store.getState().addMessage("user", "Hello");
      const id = store.getState().addStreamingMessage();
      store.getState().updateStreamingMessage(id, "Partial response");

      const apiMessages = store.getState().getApiMessages();

      expect(apiMessages).toHaveLength(2);
      expect(apiMessages[1].content).toBe("Partial response");
    });
  });
});

describe("Side chat stores", () => {
  beforeEach(() => {
    // Clear the side chat stores map
    // We need to access internal state - let's test through the public API
  });

  it("creates independent stores for different side chat IDs", () => {
    const store1 = getSideChatStore("side-1");
    const store2 = getSideChatStore("side-2");

    act(() => {
      store1.getState().addMessage("user", "Message in store 1");
      store2.getState().addMessage("user", "Message in store 2");
    });

    expect(store1.getState().messages).toHaveLength(1);
    expect(store1.getState().messages[0].content).toBe("Message in store 1");
    expect(store2.getState().messages).toHaveLength(1);
    expect(store2.getState().messages[0].content).toBe("Message in store 2");
  });

  it("returns same store for same side chat ID", () => {
    const store1 = getSideChatStore("side-1");
    const store2 = getSideChatStore("side-1");

    expect(store1).toBe(store2);
  });

  it("returns fallback store for null/undefined ID", () => {
    const store1 = getSideChatStore(null);
    const store2 = getSideChatStore(undefined);
    const store3 = getSideChatStore("");

    expect(store1).toBe(store2);
    expect(store2).toBe(store3);
  });

  it("deletes side chat store", () => {
    const store1 = getSideChatStore("side-to-delete");
    store1.getState().addMessage("user", "Test");

    deleteSideChatStore("side-to-delete");

    const store2 = getSideChatStore("side-to-delete");
    expect(store2.getState().messages).toHaveLength(0);
    expect(store2).not.toBe(store1);
  });
});

describe("default model lazy-seed from settings", () => {
  // Each test needs a fresh chat store so the subscription it registers
  // at creation time is independent. We also reset the settings store
  // back to pre-hydration to mimic a real app boot.
  beforeEach(() => {
    useSettingsStore.setState({
      hydrated: false,
      theme: "dark",
      defaultModel: "minimax-m3:cloud",
      webSearchDefault: false,
    });
  });

  it("starts with model = '' (no eager read of defaultModel)", () => {
    const s = createChatStore(`seed-${Math.random()}`);
    expect(s.getState().model).toBe("");
  });

  it("applies defaultModel once settings hydrate", () => {
    const s = createChatStore(`seed-${Math.random()}`);
    expect(s.getState().model).toBe("");

    act(() => {
      useSettingsStore.setState({
        hydrated: true,
        defaultModel: "qwen2.5:7b",
      });
    });

    expect(s.getState().model).toBe("qwen2.5:7b");
  });

  it("does not clobber a model the user already picked", () => {
    const s = createChatStore(`seed-${Math.random()}`);

    // Simulate the user picking a model BEFORE hydration finishes.
    act(() => {
      s.getState().setModel("user-picked-model");
    });

    act(() => {
      useSettingsStore.setState({
        hydrated: true,
        defaultModel: "settings-default",
      });
    });

    // The user's pick survives; we don't overwrite it with the default.
    expect(s.getState().model).toBe("user-picked-model");
  });

  it("does not apply a default of '' (guards against empty/missing default)", () => {
    const s = createChatStore(`seed-${Math.random()}`);
    act(() => {
      useSettingsStore.setState({ hydrated: true, defaultModel: "" });
    });
    expect(s.getState().model).toBe("");
  });

  it("re-applying the default after clearMessages works for new chats", () => {
    // `clearMessages` is called by the sidebar's "New Chat" button. It
    // also resets `model` to the current settings default, so the next
    // message goes out on the default model.
    const s = createChatStore(`seed-${Math.random()}`);

    act(() => {
      useSettingsStore.setState({
        hydrated: true,
        defaultModel: "settings-default",
      });
    });
    expect(s.getState().model).toBe("settings-default");

    // User picks a different model for this chat.
    act(() => {
      s.getState().setModel("chat-specific-model");
    });
    expect(s.getState().model).toBe("chat-specific-model");

    // Click "New Chat" — model should snap back to the settings default.
    act(() => {
      s.getState().clearMessages();
    });
    expect(s.getState().model).toBe("settings-default");
  });
});
