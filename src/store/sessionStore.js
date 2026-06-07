import { create } from "zustand";
import { v4 as uuidv4 } from "uuid";
import { db } from "../lib/db";
import { getSideChatStore } from "./chatStore";

export const useSessionStore = create((set, get) => ({
  chatSessions: [],
  activeChatId: null,

  setSessionsFromDb: (sessions) => set({ chatSessions: sessions }),

  // Fetch messages for a session that was loaded with empty messages at startup.
  // Stores them in the session object so subsequent opens are instant.
  hydrateSession: async (sessionId) => {
    const data = await db.loadSessionMessages(sessionId);
    set((s) => ({
      chatSessions: s.chatSessions.map((sess) => {
        if (sess.id !== sessionId) return sess;
        // Merge fetched side chat messages into existing side chat stubs
        const sideChats = sess.sideChats.map((sc) => {
          const fresh = data.sideChats.find((f) => f.id === sc.id);
          if (fresh)
            getSideChatStore(sc.id)
              .getState()
              .loadMessages(fresh.messages, sc.model);
          return fresh ? { ...sc, messages: fresh.messages } : sc;
        });
        return { ...sess, messages: data.messages, sideChats };
      }),
    }));
    return data;
  },
  setActiveChatId: (id) => set({ activeChatId: id }),

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

  removeChatSession: (id) => {
    db.deleteSession(id);
    set((s) => {
      const wasActive = s.activeChatId === id;
      return {
        chatSessions: s.chatSessions.filter((c) => c.id !== id),
        activeChatId: wasActive ? null : s.activeChatId,
      };
    });
  },

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

  removeSideChat: (sessionId, sideChatId) => {
    db.deleteSideChat(sideChatId);
    set((s) => ({
      chatSessions: s.chatSessions.map((sess) => {
        if (sess.id !== sessionId) return sess;
        const remaining = sess.sideChats.filter((sc) => sc.id !== sideChatId);
        if (remaining.length === 0)
          return { ...sess, sideChats: [], activeSideChatId: null };
        const wasActive = sess.activeSideChatId === sideChatId;
        return {
          ...sess,
          sideChats: remaining,
          activeSideChatId: wasActive ? remaining[0].id : sess.activeSideChatId,
        };
      }),
    }));
  },
}));
