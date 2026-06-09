import { create } from "zustand";
import { v4 as uuidv4 } from "uuid"; // used by addMessage / addStreamingMessage

// Factory to create an independent chat store
// Both main chat and side chat use this same factory — fully isolated state
export const createChatStore = (id) =>
  create((set, get) => ({
    id,
    model: "minimax-m3:cloud",
    messages: [], // { id, role, content, images?, isStreaming? }
    isStreaming: false,
    abortController: null,
    error: null,

    setModel: (model) => set({ model }),

    addMessage: (role, content, images = []) => {
      const msg = {
        id: uuidv4(),
        role,
        content,
        images,
        isStreaming: false,
        toolCalls: [],
      };
      set((s) => ({ messages: [...s.messages, msg] }));
      return msg.id;
    },

    addStreamingMessage: () => {
      const id = uuidv4();
      const msg = {
        id,
        role: "assistant",
        content: "",
        isStreaming: true,
        toolCalls: [],
      };
      set((s) => ({ messages: [...s.messages, msg], isStreaming: true }));
      return id;
    },

    updateStreamingMessage: (id, content) => {
      set((s) => ({
        messages: s.messages.map((m) => (m.id === id ? { ...m, content } : m)),
      }));
    },

    // Add a tool call record to a message (in-flight). Status is 'pending'.
    // Returns the new call's id so the caller can match a later result
    // back to this specific call.
    addToolCall: (messageId, name, args) => {
      const call = {
        id: uuidv4(),
        name,
        args: args || {},
        status: "pending",
        resultPreview: null,
        error: null,
        startedAt: Date.now(),
      };
      set((s) => ({
        messages: s.messages.map((m) =>
          m.id === messageId
            ? { ...m, toolCalls: [...(m.toolCalls || []), call] }
            : m,
        ),
      }));
      return call.id;
    },

    // Update an in-flight tool call with its result. status becomes 'done' or 'error'.
    completeToolCall: (messageId, callId, { result, error } = {}) => {
      set((s) => ({
        messages: s.messages.map((m) => {
          if (m.id !== messageId) return m;
          return {
            ...m,
            toolCalls: (m.toolCalls || []).map((tc) =>
              tc.id === callId
                ? {
                    ...tc,
                    status: error ? "error" : "done",
                    resultPreview: result ? String(result).slice(0, 200) : null,
                    error: error ? String(error) : null,
                    completedAt: Date.now(),
                  }
                : tc,
            ),
          };
        }),
      }));
    },

    finalizeMessage: (id, content) => {
      set((s) => ({
        messages: s.messages.map((m) =>
          m.id === id ? { ...m, content, isStreaming: false } : m,
        ),
        isStreaming: false,
        abortController: null,
      }));
    },

    setError: (error) => set({ error, isStreaming: false }),
    clearError: () => set({ error: null }),

    setAbortController: (ctrl) => set({ abortController: ctrl }),

    stopStreaming: () => {
      const { abortController } = get();
      if (abortController) abortController.abort();
      set((s) => ({
        isStreaming: false,
        abortController: null,
        messages: s.messages.map((m) =>
          m.isStreaming ? { ...m, isStreaming: false } : m,
        ),
      }));
    },

    clearMessages: () => set({ messages: [], error: null }),

    // Replace a message's content. Used by inline-edit on user messages.
    editMessage: (id, content) =>
      set((s) => ({
        messages: s.messages.map((m) => (m.id === id ? { ...m, content } : m)),
      })),

    // Drop the message with `id` and everything after it. Used when re-sending
    // an edited user message — we want the assistant reply to start fresh.
    truncateAfter: (id) =>
      set((s) => {
        const idx = s.messages.findIndex((m) => m.id === id);
        if (idx === -1) return s;
        return { messages: s.messages.slice(0, idx + 1) };
      }),

    loadMessages: (messages, model) =>
      set({
        messages,
        model,
        error: null,
        isStreaming: false,
        abortController: null,
      }),

    // Build messages array for Ollama API (includes image data)
    getApiMessages: () => {
      return get()
        .messages.filter((m) => !m.isStreaming || m.content)
        .map((m) => {
          const msg = { role: m.role, content: m.content };
          if (m.images && m.images.length > 0) {
            msg.images = m.images;
          }
          return msg;
        });
    },
  }));

// Singleton store for the main pane
export const useMainChat = createChatStore("main");

// One independent store per side chat tab (keyed by sideChatId).
// Tab switching never calls loadMessages — each tab owns its store permanently.
const _fallbackSideChat = createChatStore("side");
const _sideChatStores = new Map();

export function getSideChatStore(sideChatId) {
  if (!sideChatId) return _fallbackSideChat;
  if (!_sideChatStores.has(sideChatId))
    _sideChatStores.set(sideChatId, createChatStore(sideChatId));
  return _sideChatStores.get(sideChatId);
}

export function deleteSideChatStore(sideChatId) {
  _sideChatStores.delete(sideChatId);
}
