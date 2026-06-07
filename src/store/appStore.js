import { create } from "zustand";
import { v4 as uuidv4 } from "uuid";
import { db } from "../lib/db";
import { applyTheme } from "../theme";

const STORAGE_KEY = "luma:theme";

function readStoredTheme() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "dark" || stored === "light") return stored;
  } catch {}
  if (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: light)").matches
  ) {
    return "light";
  }
  return "dark";
}

const initialTheme = readStoredTheme();
applyTheme(initialTheme);

export const useAppStore = create((set, get) => ({
  sideChatOpen: false,
  ollamaConnected: false,
  chatSessions: [],
  activeChatId: null,
  theme: initialTheme,

  setTheme: (name) => {
    applyTheme(name);
    try {
      localStorage.setItem(STORAGE_KEY, name);
    } catch {}
    set({ theme: name });
  },
  toggleTheme: () => {
    const next = get().theme === "dark" ? "light" : "dark";
    get().setTheme(next);
  },

  setSideChatOpen: (open) => set({ sideChatOpen: open }),
  toggleSideChat: () => set((s) => ({ sideChatOpen: !s.sideChatOpen })),

  setOllamaConnected: (v) => set({ ollamaConnected: v }),

  // Load all sessions from DB on startup (replaces in-memory state)
  setSessionsFromDb: (sessions) => set({ chatSessions: sessions }),

  removeChatSession: (id) => {
    // Persist the deletion to SQLite. The ON DELETE CASCADE on
    // messages / side_chats / side_chat_messages cleans up the rest.
    db.deleteSession(id);
    set((s) => {
      const wasActive = s.activeChatId === id;
      return {
        chatSessions: s.chatSessions.filter((c) => c.id !== id),
        // If we just deleted the active session, clear the pointer so
        // the main pane doesn't try to keep its stale messages around.
        // The caller is responsible for clearing the chat store too.
        activeChatId: wasActive ? null : s.activeChatId,
      };
    });
  },

  addChatSession: (session) => {
    const full = { ...session, sideChats: [], activeSideChatId: null };
    set((s) => ({ chatSessions: [full, ...s.chatSessions] }));
    db.saveSession({
      id: session.id,
      title: session.title,
      model: session.model,
    });
  },

  updateChatSession: (id, updates) => {
    set((s) => ({
      chatSessions: s.chatSessions.map((c) =>
        c.id === id ? { ...c, ...updates } : c,
      ),
    }));
    if (updates.messages) db.saveMessages(id, updates.messages);
    if (updates.model || updates.title) {
      const session = get().chatSessions.find((c) => c.id === id);
      if (session)
        db.saveSession({
          id,
          title: updates.title ?? session.title,
          model: updates.model ?? session.model,
        });
    }
  },

  setActiveChatId: (id) => set({ activeChatId: id }),

  addSideChat: (sessionId, model = "minimax-m3:cloud") => {
    const id = uuidv4();
    set((s) => ({
      chatSessions: s.chatSessions.map((sess) => {
        if (sess.id !== sessionId) return sess;
        const position = (sess.sideChats || []).length;
        db.upsertSideChat(sessionId, { id, model }, position);
        db.setActiveSideChat(sessionId, id);
        return {
          ...sess,
          sideChats: [...(sess.sideChats || []), { id, model, messages: [] }],
          activeSideChatId: id,
        };
      }),
    }));
  },

  updateSideChat: (sessionId, sideChatId, updates) => {
    set((s) => ({
      chatSessions: s.chatSessions.map((sess) =>
        sess.id === sessionId
          ? {
              ...sess,
              sideChats: sess.sideChats.map((sc) =>
                sc.id === sideChatId ? { ...sc, ...updates } : sc,
              ),
            }
          : sess,
      ),
    }));
    if (updates.messages) db.saveSideChatMessages(sideChatId, updates.messages);
    if (updates.model)
      db.upsertSideChat(sessionId, { id: sideChatId, model: updates.model }, 0);
  },

  setActiveSideChatId: (sessionId, sideChatId) => {
    set((s) => ({
      chatSessions: s.chatSessions.map((sess) =>
        sess.id === sessionId
          ? { ...sess, activeSideChatId: sideChatId }
          : sess,
      ),
    }));
    db.setActiveSideChat(sessionId, sideChatId);
  },
}));
