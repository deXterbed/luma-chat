import { create } from "zustand";
import { v4 as uuidv4 } from "uuid"; // used by addMessage / addStreamingMessage
import { useSettingsStore } from "./settingsStore";

// Factory to create an independent chat store
// Both main chat and side chat use this same factory — fully isolated state
export const createChatStore = (id) => {
  const store = create((set, get) => ({
    id,
    // New chats start with no model — the user's default is applied once
    // `useSettingsStore` has finished hydrating from SQLite (see subscribe
    // block below). This avoids reading the setting at module-init time,
    // which would always return the in-memory default before the DB is open.
    model: "",
    messages: [], // { id, role, content, images?, isStreaming? }
    isStreaming: false,
    abortController: null,
    error: null,
    // Bumped on every new-chat/load-session reset so panes can re-derive
    // per-chat defaults (e.g. the thinking toggle) even when the model
    // string is unchanged.
    chatNonce: 0,
    // Bumped only on "user started a brand-new chat" actions (clearMessages,
    // addSideChat). Distinct from chatNonce because we don't want to steal
    // focus when loading an existing session from the sidebar — that's a
    // different intent. InputArea watches this and focuses the textarea
    // when it changes.
    focusNonce: 0,

    setModel: (model) => set({ model }),

    addMessage: (role, content, images = []) => {
      const msg = {
        id: uuidv4(),
        role,
        content,
        images,
        isStreaming: false,
        toolCalls: [],
        // Transient follow-up suggestion chips (not persisted to SQLite —
        // regenerate per answer, vanish on reload, like `thinking`).
        subtopics: [],
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
        thinking: "",
        isStreaming: true,
        toolCalls: [],
        subtopics: [],
      };
      set((s) => ({ messages: [...s.messages, msg], isStreaming: true }));
      return id;
    },

    updateStreamingMessage: (id, content) => {
      set((s) => ({
        messages: s.messages.map((m) => (m.id === id ? { ...m, content } : m)),
      }));
    },

    // Live reasoning text (transient; not persisted to SQLite).
    updateThinking: (id, thinking) => {
      set((s) => ({
        messages: s.messages.map((m) => (m.id === id ? { ...m, thinking } : m)),
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

    // Attach follow-up subtopic chips to a finished assistant message. Set by
    // the dedicated follow-up call fired after `onDone` (see useStreamingChat).
    // Transient — not persisted to SQLite, so cleared on reload.
    setSubtopics: (id, subtopics) => {
      if (!Array.isArray(subtopics) || subtopics.length === 0) return;
      set((s) => ({
        messages: s.messages.map((m) =>
          m.id === id ? { ...m, subtopics } : m,
        ),
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

    // Reset a chat back to a fresh slate: clear messages, abort any in-flight
    // stream, and drop the user-picked model so the new chat starts on the
    // user's default. The settings store's `defaultModel` is the source of
    // truth here, so we read it directly rather than relying on the
    // hydration subscription (which only fires once per store).
    clearMessages: () =>
      set((s) => ({
        messages: [],
        error: null,
        model: useSettingsStore.getState().defaultModel || "",
        chatNonce: s.chatNonce + 1,
        focusNonce: s.focusNonce + 1,
      })),

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
      set((s) => ({
        messages,
        model,
        error: null,
        isStreaming: false,
        abortController: null,
        chatNonce: s.chatNonce + 1,
      })),

    // Bump the focus signal without touching anything else. Used by
    // addSideChat so a freshly created side chat's input auto-focuses.
    bumpFocus: () => set((s) => ({ focusNonce: s.focusNonce + 1 })),

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

  // Once settings have loaded from SQLite, seed the chat's `model` with the
  // user's preferred default — but only if the user hasn't already picked
  // one (either explicitly via the ModelPicker, or via `loadMessages`
  // restoring a persisted model). We track that with a sentinel: if `model`
  // is still empty at hydration time, we apply the default.
  let appliedDefault = store.getState().model !== "";
  useSettingsStore.subscribe((s, prev) => {
    if (appliedDefault) return;
    if (!s.hydrated) return;
    if (prev && prev.hydrated) return;
    if (store.getState().model !== "") {
      appliedDefault = true;
      return;
    }
    if (s.defaultModel) {
      store.getState().setModel(s.defaultModel);
      appliedDefault = true;
    }
  });

  return store;
};

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
